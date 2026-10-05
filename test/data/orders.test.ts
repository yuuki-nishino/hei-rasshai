// 注文の確定と「やめる」（testing.md §4 #1〜8・#12、order-confirm.md §5、ADR-0004）
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { disableNetwork, Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asUser, closeUsers, createEnv, emailOf, setUnreachableUser, setUser } from './helpers';

// lib/data が使う db を、setUser で作った利用者の db に差し替える
vi.mock('../../src/lib/firebase/staff', async () => {
  const { holder } = await import('./helpers');
  return {
    get db() {
      return holder.db;
    },
  };
});

const { confirmOrder, findOrderOnServer, newOrderId, voidExistsOnServer, voidOrFind } = await import('../../src/lib/data/orders');
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
