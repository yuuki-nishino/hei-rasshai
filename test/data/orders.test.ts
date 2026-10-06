// 注文の確定と「やめる」（testing.md §4 #1〜8・#12、order-confirm.md §5、ADR-0004）
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { disableNetwork, Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asUser, closeUsers, createEnv, emailOf, setUnreachableUser, setUser, waitFor } from './helpers';

// lib/data が使う db を、setUser で作った利用者の db に差し替える
vi.mock('../../src/lib/firebase/staff', async () => {
  const { holder } = await import('./helpers');
  return {
    get db() {
      return holder.db;
    },
  };
});

const { changePayment, confirmOrder, findOrderOnServer, newOrderId, transitionOrder, voidExistsOnServer, voidOrFind, watchActiveOrders, watchOrdersOfDay } =
  await import('../../src/lib/data/orders');
type ConfirmContext = import('../../src/lib/domain/confirmFlow').ConfirmContext;

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
afterEach(() => closeUsers());

const OWNER = 'owner';
const ALICE = 'alice';
const DAY = '2026-08-01';
const old = Timestamp.fromMillis(Date.now() - 48 * 3600 * 1000);

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('events/e1').set({ name: 'e1', startDate: DAY, endDate: DAY, floatCash: 0, ownerUid: OWNER, deleting: false, createdAt: old });
    for (const uid of [OWNER, ALICE]) {
      await db.doc(`events/e1/members/${uid}`).set({ uid, role: uid === OWNER ? 'owner' : 'member', displayName: uid, email: emailOf(uid), joinedAt: old });
    }
  });
});

const ctxOf = (orderId: string, patch: Partial<ConfirmContext> = {}): ConfirmContext => ({
  orderId,
  day: DAY,
  draft: { items: [{ menuId: 'y', name: '焼きそば', price: 500, qty: 2 }], total: 1000, payment: 'cash', qr: true },
  tendered: 0,
  ...patch,
});

async function serverState(orderId: string, day = DAY) {
  let r = { order: false, void: false, counter: 0, orders: 0 };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    r = {
      order: (await db.doc(`events/e1/orders/${orderId}`).get()).exists,
      void: (await db.doc(`events/e1/voids/${orderId}`).get()).exists,
      counter: ((await db.doc(`events/e1/counters/${day}`).get()).data()?.n as number) ?? 0,
      orders: (await db.collection('events/e1/orders').get()).size,
    };
  });
  return r;
}

describe('confirmOrder', () => {
  it('#1：同じ orderId で2回呼んでも、注文は1件、番号は同じ、カウンターは1だけ進む（冪等）', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    const a = await confirmOrder('e1', ctxOf(id), ALICE);
    const b = await confirmOrder('e1', ctxOf(id), ALICE);
    expect(a.number).toBe(1);
    expect(b.number).toBe(1);
    expect(await serverState(id)).toMatchObject({ order: true, counter: 1, orders: 1 });
  });

  it('#2：連続して10件確定すると、番号は 1〜10（重複・欠番なし）', async () => {
    setUser(ALICE);
    const numbers: number[] = [];
    for (let k = 0; k < 10; k++) numbers.push((await confirmOrder('e1', ctxOf(newOrderId('e1')), ALICE)).number);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('#3：日が変わると、新しい日は1番から', async () => {
    setUser(ALICE);
    await confirmOrder('e1', ctxOf(newOrderId('e1')), ALICE);
    await confirmOrder('e1', ctxOf(newOrderId('e1')), ALICE);
    expect((await confirmOrder('e1', ctxOf(newOrderId('e1'), { day: '2026-08-02' }), ALICE)).number).toBe(1);
  });

  it('#4：2つの端末から並行して確定しても、番号は重複しない', async () => {
    const alice = setUser(ALICE);
    const owner = setUser(OWNER);
    // 端末ごとに db が違う。asUser で、それぞれの処理に、その端末の db を持たせて並行に走らせる
    const run = (db: typeof alice, uid: string) => asUser(db, () => confirmOrder('e1', ctxOf(newOrderId('e1')), uid));
    const results = await Promise.all(Array.from({ length: 6 }, (_, k) => (k % 2 === 0 ? run(alice, ALICE) : run(owner, OWNER))));
    expect(results.map((o) => o.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('QR なし → 確定と同時にお渡し済み（done）。QR あり → 調理中（preparing）', async () => {
    setUser(ALICE);
    const noQr = newOrderId('e1');
    await confirmOrder('e1', ctxOf(noQr, { draft: { ...ctxOf('x').draft, qr: false } }), ALICE);
    expect((await findOrderOnServer('e1', noQr))?.status).toBe('done');
    const withQr = newOrderId('e1');
    await confirmOrder('e1', ctxOf(withQr), ALICE);
    expect(await findOrderOnServer('e1', withQr)).toMatchObject({ status: 'preparing', number: 2, total: 1000, createdBy: ALICE });
  });

  it('#12：オフラインでは、失敗する（offline）。注文は作られない', async () => {
    // disableNetwork はトランザクションの通信を止めないため、つながらない宛先で試す（helpers.ts の setUnreachableUser）
    setUnreachableUser(ALICE);
    const id = newOrderId('e1');
    await expect(confirmOrder('e1', ctxOf(id), ALICE)).rejects.toMatchObject({ code: 'offline' });
    expect(await serverState(id)).toMatchObject({ order: false, counter: 0 });
  });
});

describe('voidOrFind', () => {
  it('#5：注文が無ければ、墓標を作り voided。以後、同じ orderId の確定は permission で失敗する', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    expect(await voidOrFind('e1', id, ALICE)).toEqual({ result: 'voided' });
    expect(await voidExistsOnServer('e1', id)).toBe(true);
    await expect(confirmOrder('e1', ctxOf(id), ALICE)).rejects.toMatchObject({ code: 'permission' });
    expect(await serverState(id)).toMatchObject({ order: false, counter: 0 });
  });

  it('#6：注文が既にあれば found（墓標は作らない）', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    await confirmOrder('e1', ctxOf(id), ALICE);
    const r = await voidOrFind('e1', id, ALICE);
    expect(r).toMatchObject({ result: 'found', order: { id, number: 1 } });
    expect(await serverState(id)).toMatchObject({ order: true, void: false });
  });

  it('2回目の voidOrFind も voided（墓標は作り直さない）', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    await voidOrFind('e1', id, ALICE);
    expect(await voidOrFind('e1', id, ALICE)).toEqual({ result: 'voided' });
  });

  it('#7：確定と「やめる」を、同じ orderId で並行して実行しても、注文と墓標が並存しない（★R8 の補助）', async () => {
    const a = setUser(ALICE);
    const b = setUser(OWNER);
    for (let k = 0; k < 5; k++) {
      const id = newOrderId('e1');
      const confirming = asUser(a, () => confirmOrder('e1', ctxOf(id, { day: `2026-08-${String(10 + k)}` }), ALICE)).then(
        () => 'confirmed',
        (e: { code: string }) => e.code,
      );
      const voiding = asUser(b, () => voidOrFind('e1', id, OWNER)).then((r) => r.result);
      const [c, v] = await Promise.all([confirming, voiding]);
      const s = await serverState(id, `2026-08-${String(10 + k)}`);
      expect(s.order && s.void).toBe(false); // 並存しない
      if (s.order) expect(v).toBe('found'); // 注文がある → やめるは found（成功扱い）
      else expect([c, v]).toEqual(['permission', 'voided']); // 墓標がある → 確定は拒否
    }
  });
});

describe('voidOrFind：メンバーでない（PR #39 のレビュー C3・再レビュー R1）', () => {
  it('注文が無ければ permission（サーバーで無いと確かめた上で、墓標を作れない）', async () => {
    setUser('stranger');
    await expect(voidOrFind('e1', newOrderId('e1'), 'stranger')).rejects.toMatchObject({ code: 'permission' });
  });

  it('注文があれば found（注文は誰でも1件読めるため、メンバーでなくても確かめられる）', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    await confirmOrder('e1', ctxOf(id), ALICE);
    setUser('stranger');
    expect(await voidOrFind('e1', id, 'stranger')).toMatchObject({ result: 'found', order: { id, number: 1 } });
  });
});

describe('findOrderOnServer', () => {
  it('#8：存在すれば注文、なければ null', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    expect(await findOrderOnServer('e1', id)).toBeNull();
    await confirmOrder('e1', ctxOf(id), ALICE);
    expect(await findOrderOnServer('e1', id)).toMatchObject({ id, number: 1 });
  });

  it('オフラインでは offline', async () => {
    const db = setUser(ALICE);
    await disableNetwork(db);
    await expect(findOrderOnServer('e1', 'x')).rejects.toMatchObject({ code: 'offline' });
  });
});

// ---- #15：調理画面の操作（testing.md §4 #9、data-model.md §3） ----
type Order = import('../../src/lib/data/types').Order;

const BOB = 'bob'; // events/e1 の、ただのメンバー

async function rawOrder(orderId: string): Promise<Record<string, unknown>> {
  let data: Record<string, unknown> = {};
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await ctx.firestore().doc(`events/e1/orders/${orderId}`).get()).data() ?? {};
  });
  return data;
}

const isTs = (v: unknown) => typeof (v as { toMillis?: unknown })?.toMillis === 'function';

describe('transitionOrder（#9）', () => {
  it('完成 → 渡した → 渡したを戻す → 調理中に戻す：データ設計の項目が、そのとおりに書かれる（ルールも通る）', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    await confirmOrder('e1', ctxOf(id), ALICE);
    const get = async () => (await findOrderOnServer('e1', id))!;

    await transitionOrder('e1', await get(), 'ready', ALICE);
    let d = await rawOrder(id);
    expect(d).toMatchObject({ status: 'ready', doneAt: null, cancelledAt: null, cancelledFrom: null, updatedBy: ALICE });
    expect(isTs(d.readyAt)).toBe(true);

    await transitionOrder('e1', await get(), 'done', ALICE);
    d = await rawOrder(id);
    expect(d.status).toBe('done');
    expect(isTs(d.readyAt) && isTs(d.doneAt)).toBe(true);

    await transitionOrder('e1', await get(), 'backToReady', ALICE);
    d = await rawOrder(id);
    expect(d).toMatchObject({ status: 'ready', doneAt: null });
    expect(isTs(d.readyAt)).toBe(true); // 完成の時刻は残る

    await transitionOrder('e1', await get(), 'backToPreparing', ALICE);
    d = await rawOrder(id);
    expect(d).toMatchObject({ status: 'preparing', readyAt: null });
  });

  it('取り消し → 取り消しを戻す：取り消し前の状態（cancelledFrom）に戻る。時刻は取り消し前のまま', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    await confirmOrder('e1', ctxOf(id), ALICE);
    const get = async () => (await findOrderOnServer('e1', id))!;
    await transitionOrder('e1', await get(), 'ready', ALICE);
    await transitionOrder('e1', await get(), 'cancel', ALICE);
    let d = await rawOrder(id);
    expect(d).toMatchObject({ status: 'cancelled', cancelledFrom: 'ready' });
    expect(isTs(d.cancelledAt) && isTs(d.readyAt)).toBe(true);

    await transitionOrder('e1', await get(), 'restore', ALICE);
    d = await rawOrder(id);
    expect(d).toMatchObject({ status: 'ready', cancelledFrom: null, cancelledAt: null });
    expect(isTs(d.readyAt)).toBe(true);
  });

  it('お渡し済み（QRなしの確定）も、取り消せる。取り消しを戻すと、お渡し済みに戻る', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    await confirmOrder('e1', ctxOf(id, { draft: { ...ctxOf('x').draft, qr: false } }), ALICE);
    const get = async () => (await findOrderOnServer('e1', id))!;
    expect((await get()).status).toBe('done');
    await transitionOrder('e1', await get(), 'cancel', ALICE);
    await transitionOrder('e1', await get(), 'restore', ALICE);
    expect(await rawOrder(id)).toMatchObject({ status: 'done', cancelledFrom: null });
  });

  it('できない遷移は、書く前に validation（サーバーには、何も書かない）', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    const o = await confirmOrder('e1', ctxOf(id), ALICE);
    for (const action of ['done', 'backToReady', 'backToPreparing', 'restore'] as const) {
      await expect(transitionOrder('e1', o, action, ALICE)).rejects.toMatchObject({ code: 'validation' });
    }
    expect(await rawOrder(id)).toMatchObject({ status: 'preparing', updatedBy: ALICE });
  });

  it('他のメンバーが先に取り消した後の「完成」は、サーバーのルールが拒否する（古い画面からの操作。permission）', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    const stale = await confirmOrder('e1', ctxOf(id), ALICE); // 古い画面：まだ調理中と思っている
    await transitionOrder('e1', stale, 'cancel', ALICE); // ほかの端末が、先に取り消した
    await expect(transitionOrder('e1', stale, 'ready', ALICE)).rejects.toMatchObject({ code: 'permission' });
    expect((await rawOrder(id)).status).toBe('cancelled');
  });

  it('古い状態（できあがり）から作った取り消し（cancelledFrom が古い）は、ルールが拒否する。最新の状態からなら通る（PR #42 のレビュー M1）', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    const o = await confirmOrder('e1', ctxOf(id), ALICE);
    await transitionOrder('e1', o, 'ready', ALICE);
    await transitionOrder('e1', { ...o, status: 'ready' }, 'done', ALICE); // ほかのメンバーが、先に「渡した」にした
    // 確認ダイアログを開いた時点の古い状態（ready）から取り消す → cancelledFrom: 'ready' は、いまの状態（done）と合わない
    await expect(transitionOrder('e1', { ...o, status: 'ready' }, 'cancel', ALICE)).rejects.toMatchObject({ code: 'permission' });
    expect((await rawOrder(id)).status).toBe('done');
    await transitionOrder('e1', { ...o, status: 'done' }, 'cancel', ALICE);
    expect(await rawOrder(id)).toMatchObject({ status: 'cancelled', cancelledFrom: 'done' });
  });

  it('メンバーでない人は、操作できない', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    const o = await confirmOrder('e1', ctxOf(id), ALICE);
    setUser(BOB);
    await expect(transitionOrder('e1', o, 'ready', BOB)).rejects.toMatchObject({ code: 'permission' });
  });
});

describe('changePayment', () => {
  it('支払い方法だけが変わる（状態・品目・合計は、そのまま）。お渡し済み・取り消しの注文も変えられる', async () => {
    setUser(ALICE);
    const id = newOrderId('e1');
    await confirmOrder('e1', ctxOf(id), ALICE);
    await changePayment('e1', id, 'paypay', ALICE);
    expect(await rawOrder(id)).toMatchObject({ payment: 'paypay', status: 'preparing', total: 1000, updatedBy: ALICE });

    const o = (await findOrderOnServer('e1', id))!;
    await transitionOrder('e1', o, 'cancel', ALICE);
    await changePayment('e1', id, 'cash', ALICE);
    expect(await rawOrder(id)).toMatchObject({ payment: 'cash', status: 'cancelled' });
  });
});

describe('watchActiveOrders / watchOrdersOfDay', () => {
  it('調理中・できあがりだけを、(day, number) の昇順で返す。済み・取り消しは含まない', async () => {
    setUser(ALICE);
    const ids: string[] = [];
    for (const day of ['2026-08-02', '2026-08-01', '2026-08-01']) {
      const id = newOrderId('e1');
      ids.push(id);
      await confirmOrder('e1', ctxOf(id, { day }), ALICE);
    }
    // 8/1 の1番を取り消し、8/2 の1番を完成にする
    await transitionOrder('e1', (await findOrderOnServer('e1', ids[1]!))!, 'cancel', ALICE);
    await transitionOrder('e1', (await findOrderOnServer('e1', ids[0]!))!, 'ready', ALICE);

    let latest: Order[] | undefined;
    const unsub = watchActiveOrders('e1', (o) => (latest = o), () => {});
    const got = await waitFor(() => (latest && latest.length === 2 ? latest : undefined));
    expect(got.map((o) => [o.day, o.number, o.status])).toEqual([
      ['2026-08-01', 2, 'preparing'],
      ['2026-08-02', 1, 'ready'],
    ]);
    unsub();
  });

  it('その日の全状態（済みも表示）。ほかの日の注文は含まない', async () => {
    setUser(ALICE);
    const a = newOrderId('e1');
    const b = newOrderId('e1');
    const c = newOrderId('e1');
    await confirmOrder('e1', ctxOf(a), ALICE);
    await confirmOrder('e1', ctxOf(b), ALICE);
    await confirmOrder('e1', ctxOf(c, { day: '2026-08-02' }), ALICE);
    await transitionOrder('e1', (await findOrderOnServer('e1', b))!, 'cancel', ALICE);
    let latest: Order[] | undefined;
    const unsub = watchOrdersOfDay('e1', DAY, (o) => (latest = o), () => {});
    const got = await waitFor(() => (latest && latest.length === 2 ? latest : undefined));
    expect(got.map((o) => [o.number, o.status])).toEqual([
      [1, 'preparing'],
      [2, 'cancelled'],
    ]);
    unsub();
  });

  it('ほかのメンバーの操作が、購読に届く', async () => {
    const alice = setUser(ALICE);
    const owner = setUser('owner');
    const id = newOrderId('e1');
    await asUser(alice, () => confirmOrder('e1', ctxOf(id), ALICE));
    let latest: Order[] | undefined;
    const unsub = asUser(owner, async () => watchActiveOrders('e1', (o) => (latest = o), () => {}));
    await waitFor(() => (latest?.[0]?.status === 'preparing' ? true : undefined));
    await asUser(alice, async () => transitionOrder('e1', (await findOrderOnServer('e1', id))!, 'ready', ALICE));
    await waitFor(() => (latest?.[0]?.status === 'ready' ? true : undefined));
    (await unsub)();
  });
});
