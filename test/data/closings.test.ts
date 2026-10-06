// レジ締め（testing.md §4 #23・#18、data-access.md §3.7・§3.9）。売上の集計と、「締め後に変更あり」を、本物のルールの下で確かめる
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeUsers, createEnv, emailOf, setUnreachableUser, setUser } from './helpers';

// lib/data が使う db を、setUser で作った利用者の db に差し替える
vi.mock('../../src/lib/firebase/staff', async () => {
  const { holder } = await import('./helpers');
  return {
    get db() {
      return holder.db;
    },
  };
});

const { changePayment, confirmOrder, fetchOrdersOfDayFromServer, newOrderId, transitionOrder, findOrderOnServer } = await import('../../src/lib/data/orders');
const { getClosing, saveClosing } = await import('../../src/lib/data/closings');
const { calcExpectedCash, closingView, summarize } = await import('../../src/lib/domain');
type ConfirmContext = import('../../src/lib/domain/confirmFlow').ConfirmContext;

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
afterEach(() => closeUsers());

const ALICE = 'alice';
const BOB = 'bob'; // メンバーでない
const DAY = '2026-08-01';
const old = Timestamp.fromMillis(Date.now() - 48 * 3600 * 1000);

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('events/e1').set({ name: 'e1', startDate: DAY, endDate: '2026-08-02', floatCash: 8000, ownerUid: ALICE, deleting: false, createdAt: old });
    await db.doc(`events/e1/members/${ALICE}`).set({ uid: ALICE, role: 'owner', displayName: 'アリス', email: emailOf(ALICE), joinedAt: old });
  });
});

const ctxOf = (day: string, items: { menuId: string; name: string; price: number; qty: number }[], payment: 'cash' | 'paypay'): ConfirmContext => ({
  orderId: newOrderId('e1'),
  day,
  draft: { items, total: items.reduce((s, i) => s + i.price * i.qty, 0), payment, qr: true, note: '' },
  tendered: 0,
});
const yaki = (qty: number) => [{ menuId: 'y', name: '焼きそば', price: 500, qty }];

/** サーバーから取得して、集計する（画面と同じ流れ） */
async function aggregate(day = DAY) {
  return summarize(await fetchOrdersOfDayFromServer('e1', day));
}

describe('fetchOrdersOfDayFromServer（レジ締め用）', () => {
  it('その日の注文だけを、全状態で、(day, number) の順に返す', async () => {
    setUser(ALICE);
    await confirmOrder('e1', ctxOf(DAY, yaki(1), 'cash'), ALICE);
    await confirmOrder('e1', ctxOf(DAY, yaki(2), 'paypay'), ALICE);
    await confirmOrder('e1', ctxOf('2026-08-02', yaki(9), 'cash'), ALICE);
    const orders = await fetchOrdersOfDayFromServer('e1', DAY);
    expect(orders.map((o) => [o.number, o.payment])).toEqual([
      [1, 'cash'],
      [2, 'paypay'],
    ]);
  });

  it('つながらない（オフライン）とき、AppError(offline)。キャッシュを返さない', async () => {
    setUnreachableUser(ALICE);
    await expect(fetchOrdersOfDayFromServer('e1', DAY)).rejects.toMatchObject({ code: 'offline' });
  }, 30_000);

  it('メンバーでない人は、読めない（permission）', async () => {
    setUser(BOB);
    await expect(fetchOrdersOfDayFromServer('e1', DAY)).rejects.toMatchObject({ code: 'permission' });
  });
});

describe('saveClosing / getClosing', () => {
  it('締めを保存し、サーバーから読める。diff は、数えた現金 − あるはずの現金。締めた人・時刻が残る', async () => {
    setUser(ALICE);
    await confirmOrder('e1', ctxOf(DAY, yaki(2), 'cash'), ALICE); // 現金 1000円
    const s = await aggregate();
    expect(await getClosing('e1', DAY)).toBeNull();
    await saveClosing('e1', DAY, { floatCash: 10000, expectedCash: calcExpectedCash(10000, s.cashTotal), actualCash: 10900, note: '100円足りない' }, ALICE);
    const c = await getClosing('e1', DAY);
    expect(c).toMatchObject({ floatCash: 10000, expectedCash: 11000, actualCash: 10900, diff: -100, note: '100円足りない', closedBy: ALICE });
    expect(c?.closedAt).toBeInstanceOf(Date);
  });

  it('何度でも上書きできる（締め直し）。日ごとに別の記録', async () => {
    setUser(ALICE);
    await saveClosing('e1', DAY, { floatCash: 10000, expectedCash: 10000, actualCash: 10000, note: '' }, ALICE);
    await saveClosing('e1', DAY, { floatCash: 10000, expectedCash: 10000, actualCash: 10050, note: '数え直した' }, ALICE);
    await saveClosing('e1', '2026-08-02', { floatCash: 5000, expectedCash: 5000, actualCash: 5000, note: '' }, ALICE);
    expect(await getClosing('e1', DAY)).toMatchObject({ actualCash: 10050, diff: 50, note: '数え直した' });
    expect((await getClosing('e1', '2026-08-02'))?.floatCash).toBe(5000);
  });

  it('不正な入力は、書く前に validation（小数・負の数・上限超え・201文字のメモ）', async () => {
    setUser(ALICE);
    const ok = { floatCash: 10000, expectedCash: 10000, actualCash: 10000, note: '' };
    await expect(saveClosing('e1', DAY, { ...ok, actualCash: 100.5 }, ALICE)).rejects.toMatchObject({ code: 'validation' });
    await expect(saveClosing('e1', DAY, { ...ok, actualCash: -1 }, ALICE)).rejects.toMatchObject({ code: 'validation' });
    await expect(saveClosing('e1', DAY, { ...ok, floatCash: 10_000_001 }, ALICE)).rejects.toMatchObject({ code: 'validation' });
    await expect(saveClosing('e1', DAY, { ...ok, note: 'あ'.repeat(201) }, ALICE)).rejects.toMatchObject({ code: 'validation' });
    expect(await getClosing('e1', DAY)).toBeNull();
  });

  it('#23：オフラインなら、offline で失敗し、書き込みが溜まらない（復帰後にも、反映されない）', async () => {
    setUnreachableUser(ALICE);
    await expect(saveClosing('e1', DAY, { floatCash: 10000, expectedCash: 10000, actualCash: 10000, note: '' }, ALICE)).rejects.toMatchObject({ code: 'offline' });
    setUser(ALICE);
    expect(await getClosing('e1', DAY)).toBeNull();
  }, 30_000);

  it('メンバーでない人は、締められない・読めない（permission）', async () => {
    setUser(BOB);
    await expect(saveClosing('e1', DAY, { floatCash: 0, expectedCash: 0, actualCash: 0, note: '' }, BOB)).rejects.toMatchObject({ code: 'permission' });
    await expect(getClosing('e1', DAY)).rejects.toMatchObject({ code: 'permission' });
  });
});

describe('「締め後に変更あり」（#18 のレジ締めの検知。data-model.md §5.3）', () => {
  /** 現金 1000円の注文を作り、締める。締めたあとの状態を返す */
  async function setupClosed() {
    setUser(ALICE);
    const id = newOrderId('e1');
    await confirmOrder('e1', { ...ctxOf(DAY, yaki(2), 'cash'), orderId: id }, ALICE);
    const s = await aggregate();
    await saveClosing('e1', DAY, { floatCash: 10000, expectedCash: calcExpectedCash(10000, s.cashTotal), actualCash: 11000, note: '' }, ALICE);
    return id;
  }
  const view = async () => closingView(await aggregate(), await getClosing('e1', DAY), 8000);

  it('締めた直後は、変更なし。準備金の初期値は、保存された準備金（イベントの 8000 ではなく 10000）', async () => {
    await setupClosed();
    expect(await view()).toMatchObject({ changedAfterClosing: false, initialFloat: 10000 });
  });

  it('締めた後に、注文を追加すると、変更あり', async () => {
    await setupClosed();
    await confirmOrder('e1', ctxOf(DAY, yaki(1), 'cash'), ALICE);
    expect((await view()).changedAfterClosing).toBe(true);
  });

  it('締めた後に、現金の注文を取り消すと、変更あり。戻すと、変更なしに戻る', async () => {
    const id = await setupClosed();
    await transitionOrder('e1', (await findOrderOnServer('e1', id))!, 'cancel', ALICE);
    expect((await view()).changedAfterClosing).toBe(true);
    await transitionOrder('e1', (await findOrderOnServer('e1', id))!, 'restore', ALICE);
    expect((await view()).changedAfterClosing).toBe(false);
  });

  it('締めた後に、支払い方法を現金から PayPay に変えると、変更あり', async () => {
    const id = await setupClosed();
    await changePayment('e1', id, 'paypay', ALICE);
    expect((await view()).changedAfterClosing).toBe(true);
  });

  it('PayPay の注文の追加・取り消しは、現金に関係しないので、変更なし', async () => {
    await setupClosed();
    await confirmOrder('e1', ctxOf(DAY, yaki(3), 'paypay'), ALICE);
    expect((await view()).changedAfterClosing).toBe(false);
  });

  it('上書きして締め直すと、変更なしに戻る（締めの記録は、上書きするまで変わらない）', async () => {
    await setupClosed();
    await confirmOrder('e1', ctxOf(DAY, yaki(1), 'cash'), ALICE);
    const s = await aggregate();
    await saveClosing('e1', DAY, { floatCash: 10000, expectedCash: calcExpectedCash(10000, s.cashTotal), actualCash: 11500, note: '締め直し' }, ALICE);
    expect((await view()).changedAfterClosing).toBe(false);
  });
});
