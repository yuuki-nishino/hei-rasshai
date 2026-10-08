// 未送信の数え上げ（testing.md §4 #13・#14、data-access.md §6.2）
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { disableNetwork, enableNetwork, Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asUser, closeUsers, createEnv, emailOf, setUser, waitFor } from './helpers';

vi.mock('../../src/lib/firebase/staff', async () => {
  const { holder } = await import('./helpers');
  return {
    get db() {
      return holder.db;
    },
  };
});

const { changeNote, confirmOrder, findOrderOnServer, newOrderId, transitionOrder, watchActiveOrders } = await import('../../src/lib/data/orders');
const { reconnectNow } = await import('../../src/lib/data/online');
const { checkPendingAfterReload, pendingUnknown, pendingWrites, trackWrite } = await import('../../src/lib/data/writes');
type Order = import('../../src/lib/data/types').Order;
type AppError = import('../../src/lib/data/errors').AppError;

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
  pendingWrites.value = 0;
  pendingUnknown.value = false;
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('events/e1').set({ name: 'e1', startDate: DAY, endDate: DAY, floatCash: 0, ownerUid: OWNER, deleting: false, createdAt: old });
    for (const uid of [OWNER, ALICE]) {
      await db.doc(`events/e1/members/${uid}`).set({ uid, role: uid === OWNER ? 'owner' : 'member', displayName: uid, email: emailOf(uid), joinedAt: old });
    }
  });
});

async function newOrder(uid: string): Promise<string> {
  const id = newOrderId('e1');
  await confirmOrder('e1', { orderId: id, day: DAY, draft: { items: [{ menuId: 'y', name: '焼きそば', price: 500, qty: 2 }], total: 1000, payment: 'cash', qr: true }, tendered: 0 }, uid);
  return id;
}

async function rawStatus(id: string): Promise<unknown> {
  let status: unknown;
  await env.withSecurityRulesDisabled(async (ctx) => {
    status = (await ctx.firestore().doc(`events/e1/orders/${id}`).get()).data()?.status;
  });
  return status;
}

describe('trackWrite', () => {
  it('オフラインの操作は、未送信として数え、画面には、すぐ反映される。復帰すると、サーバーに届いて、0に戻る（#13）', async () => {
    const db = setUser(ALICE);
    const id = await newOrder(ALICE);
    let latest: Order[] | undefined;
    const unsub = watchActiveOrders('e1', (o) => (latest = o), () => {});
    await waitFor(() => (latest?.[0]?.id === id ? true : undefined));
    const order = (await findOrderOnServer('e1', id))!;

    await disableNetwork(db);
    const onRejected = vi.fn();
    trackWrite(transitionOrder('e1', order, 'ready', ALICE), onRejected);
    expect(pendingWrites.value).toBe(1);
    await waitFor(() => (latest?.[0]?.status === 'ready' ? true : undefined)); // ローカルの表示は、すぐ変わる
    expect(await rawStatus(id)).toBe('preparing'); // サーバーは、まだ

    await enableNetwork(db);
    await waitFor(() => (pendingWrites.value === 0 ? true : undefined));
    expect(await rawStatus(id)).toBe('ready');
    expect(onRejected).not.toHaveBeenCalled();
    unsub();
  });

  it('復帰後に拒否された操作は、onRejected で知らせ、数えも戻る。ローカルの表示は、サーバーの状態に戻る（#14）', async () => {
    const dbA = setUser(ALICE);
    const id = await newOrder(ALICE);
    await transitionOrder('e1', (await findOrderOnServer('e1', id))!, 'ready', ALICE);
    let latest: Order[] | undefined;
    const unsub = watchActiveOrders('e1', (o) => (latest = o), () => {});
    await waitFor(() => (latest?.[0]?.status === 'ready' ? true : undefined));
    const ready = (await findOrderOnServer('e1', id))!;

    await disableNetwork(dbA);
    const rejected: AppError[] = [];
    trackWrite(transitionOrder('e1', ready, 'done', ALICE), (e) => rejected.push(e)); // ready → done（オフラインのまま）
    await waitFor(() => (latest?.length === 0 ? true : undefined)); // 渡したので、調理の一覧から消える

    // その間に、オーナーが、調理中に戻す（ready → preparing）。Alice の done は、preparing → done になり、ルールで拒否される
    const dbO = setUser(OWNER);
    await asUser(dbO, async () => transitionOrder('e1', (await findOrderOnServer('e1', id))!, 'backToPreparing', OWNER));

    await enableNetwork(dbA);
    await waitFor(() => (rejected.length === 1 ? true : undefined));
    expect(rejected[0]?.code).toBe('permission');
    await waitFor(() => (pendingWrites.value === 0 ? true : undefined));
    expect(await rawStatus(id)).toBe('preparing');
    await waitFor(() => (latest?.[0]?.status === 'preparing' ? true : undefined)); // 表示が、サーバーの状態に戻る
    unsub();
  });

  it('検証で失敗した操作も、拒否として知らせ、数えは戻る', async () => {
    setUser(ALICE);
    const onRejected = vi.fn();
    trackWrite(changeNote('e1', 'x', 'あ'.repeat(101), ALICE), onRejected);
    await waitFor(() => (onRejected.mock.calls.length === 1 ? true : undefined));
    expect(onRejected.mock.calls[0]?.[0]).toMatchObject({ code: 'validation' });
    await waitFor(() => (pendingWrites.value === 0 ? true : undefined));
  });
});

describe('reconnectNow', () => {
  it('ネットワークを入れ直しても、未送信は残り、そのまま送られる', async () => {
    const db = setUser(ALICE);
    const id = await newOrder(ALICE);
    await disableNetwork(db);
    const order = (await findOrderOnServer('e1', id).catch(() => null)) ?? ({ id, status: 'preparing', cancelledFrom: null } as const);
    trackWrite(transitionOrder('e1', order, 'ready', ALICE), () => {});
    expect(pendingWrites.value).toBe(1);
    await reconnectNow();
    await waitFor(() => (pendingWrites.value === 0 ? true : undefined));
    expect(await rawStatus(id)).toBe('ready');
  });
});

describe('trackWrite の通知の失敗', () => {
  it('onRejected が例外を投げても、数えは戻り、unhandled rejection にならない（C4）', async () => {
    setUser(ALICE);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    trackWrite(changeNote('e1', 'x', 'あ'.repeat(101), ALICE), () => {
      throw new Error('通知の失敗');
    });
    await waitFor(() => (pendingWrites.value === 0 && spy.mock.calls.length > 0 ? true : undefined));
    spy.mockRestore();
  });
});

describe('checkPendingAfterReload', () => {
  it('未送信がなければ、何も出さない', async () => {
    setUser(ALICE);
    await checkPendingAfterReload(500);
    expect(pendingUnknown.value).toBe(false);
  });

  it('再読み込み前の未送信が残っていれば、「未送信あり」（件数は不明）を出し、送られたら消す', async () => {
    const db = setUser(ALICE);
    const id = await newOrder(ALICE);
    await disableNetwork(db);
    void changeNote('e1', id, '前の画面のメモ', ALICE).catch(() => {}); // trackWrite を通さない＝再読み込みで、数えが失われた状態
    expect(pendingWrites.value).toBe(0);

    const check = checkPendingAfterReload(300);
    await waitFor(() => (pendingUnknown.value ? true : undefined));
    expect(pendingWrites.value).toBe(0);

    await enableNetwork(db);
    await check;
    expect(pendingUnknown.value).toBe(false);
  });
});
