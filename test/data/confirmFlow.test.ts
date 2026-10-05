// 確定の途中の記録（pending）からの復元と、確認できない状態からの復帰（testing.md §4 #17・#19・#20・#27、order-confirm.md §5.3・§5.4）
// 動かす部分（state/confirmRunner.ts）に、本物のデータアクセス（lib/data/orders.ts）をつないで確かめる
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

const orders = await import('../../src/lib/data/orders');
const { createConfirmRunner } = await import('../../src/state/confirmRunner');
const { initialConfirmState } = await import('../../src/lib/domain/confirmFlow');
type ConfirmState = import('../../src/lib/domain/confirmFlow').ConfirmState;
type ConfirmContext = import('../../src/lib/domain/confirmFlow').ConfirmContext;
type PendingRecord = import('../../src/state/confirmRunner').PendingRecord;

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
afterEach(() => closeUsers());

const ALICE = 'alice';
const DAY = '2026-08-01';
const old = Timestamp.fromMillis(Date.now() - 48 * 3600 * 1000);

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('events/e1').set({ name: 'e1', startDate: DAY, endDate: DAY, floatCash: 0, ownerUid: ALICE, deleting: false, createdAt: old });
    await db.doc(`events/e1/members/${ALICE}`).set({ uid: ALICE, role: 'owner', displayName: 'a', email: emailOf(ALICE), joinedAt: old });
  });
});

const ctxOf = (orderId: string): ConfirmContext => ({
  orderId,
  day: DAY,
  draft: { items: [{ menuId: 'y', name: '焼きそば', price: 500, qty: 1 }], total: 500, payment: 'cash', qr: true },
  tendered: 0,
});

/** 本物のデータアクセスにつないだ runner。pending は、メモリに持つ（端末の localStorage の代わり） */
function makeRunner(uid = ALICE) {
  let state: ConfirmState = initialConfirmState;
  let pending: PendingRecord | null = null;
  const toConfirmed = (o: { id: string; number: number; day: string; total: number; qr: boolean }) => ({
    orderId: o.id,
    number: o.number,
    day: o.day,
    total: o.total,
    qr: o.qr,
  });
  const runner = createConfirmRunner(
    {
      confirmOrder: async (c) => toConfirmed(await orders.confirmOrder('e1', c, uid)),
      voidOrFind: async (id) => {
        const r = await orders.voidOrFind('e1', id, uid);
        return r.result === 'found' ? { result: 'found', order: toConfirmed(r.order) } : r;
      },
      voidExists: (id) => orders.voidExistsOnServer('e1', id),
      findOrder: async (id) => {
        const o = await orders.findOrderOnServer('e1', id);
        return o && toConfirmed(o);
      },
      pending: { save: (p) => (pending = p), clear: () => (pending = null) },
    },
    { get: () => state, set: (s) => (state = s) },
  );
  return { runner, state: () => state, pending: () => pending };
}

const until = (get: () => ConfirmState, kinds: ConfirmState['kind'][]) =>
  vi.waitFor(
    () => {
      if (!kinds.includes(get().kind)) throw new Error(`まだ ${get().kind}`);
    },
    { timeout: 15_000 },
  );

describe('resolvePending（#17）', () => {
  it('pending の注文が、サーバーで登録されていた → done（登録されていました）。pending を消す', async () => {
    setUser(ALICE);
    const id = orders.newOrderId('e1');
    await orders.confirmOrder('e1', ctxOf(id), ALICE); // 前回、確定は届いていた（画面は結果を受け取れなかった）
    const r = makeRunner();
    r.runner.restore({ ctx: ctxOf(id), abandoning: false });
    await until(r.state, ['done']);
    expect(r.state()).toMatchObject({ kind: 'done', recovered: true, order: { number: 1 } });
    expect(r.pending()).toBeNull();
  });

  it('注文も墓標も無い → decide。「もう一度確定する」で、同じ orderId で登録される', async () => {
    setUser(ALICE);
    const id = orders.newOrderId('e1');
    const r = makeRunner();
    r.runner.restore({ ctx: ctxOf(id), abandoning: false });
    await until(r.state, ['decide']);
    r.runner.retry();
    await until(r.state, ['done']);
    expect((await orders.findOrderOnServer('e1', id))?.number).toBe(1);
  });

  it('abandoning → やめる処理の続き。注文が無ければ墓標を作り、idle（やめた扱い）', async () => {
    setUser(ALICE);
    const id = orders.newOrderId('e1');
    const r = makeRunner();
    r.runner.restore({ ctx: ctxOf(id), abandoning: true });
    await until(r.state, ['idle']);
    expect(r.state()).toEqual({ kind: 'idle', notice: 'voided' });
    expect(await orders.voidExistsOnServer('e1', id)).toBe(true);
  });

  it('確認できない（つながらない）→ unverifiable。pending は残る', async () => {
    setUnreachableUser(ALICE);
    const r = makeRunner();
    const id = 'o-offline';
    r.runner.restore({ ctx: ctxOf(id), abandoning: false });
    await until(r.state, ['unverifiable']);
    expect(r.state()).toMatchObject({ kind: 'unverifiable', via: 'find' });
  });
});

describe('#19：墓標があり、注文が無い pending（abandoning なし）', () => {
  it('find が墓標を見つけ、idle（やめた扱い）。「登録されていません」の画面にならない', async () => {
    setUser(ALICE);
    const id = orders.newOrderId('e1');
    await orders.voidOrFind('e1', id, ALICE); // 墓標は書かれたが、abandoning の保存の前に落ちた、などの場合
    const r = makeRunner();
    r.runner.restore({ ctx: ctxOf(id), abandoning: false });
    await until(r.state, ['idle', 'decide']);
    expect(r.state()).toEqual({ kind: 'idle', notice: 'voided' });
  });
});

describe('#20：墓標のある orderId で確定すると permission', () => {
  it('墓標を確かめて「やめた注文」にし、draft を残したまま、新しい orderId で確定し直せる（pending も置き換わる）', async () => {
    setUser(ALICE);
    const id = orders.newOrderId('e1');
    await orders.voidOrFind('e1', id, ALICE);
    const r = makeRunner();
    r.runner.submit(ctxOf(id));
    await until(r.state, ['failed']);
    expect(r.state()).toMatchObject({ kind: 'failed', reason: 'voided' });
    const next = { ...ctxOf(orders.newOrderId('e1')) };
    expect(r.runner.submit(next)).toBe(true);
    expect(r.pending()).toEqual({ ctx: next, abandoning: false });
    await until(r.state, ['done']);
    expect(r.state()).toMatchObject({ kind: 'done', order: { orderId: next.orderId, number: 1 } });
  });
});

describe('#27：resolvePending の同時実行', () => {
  it('確かめている間は、次の復元・確認を始めない。手動の「もう一度確認」は busy', async () => {
    setUnreachableUser(ALICE); // 応答がなく、裏の処理が長く続く
    const r = makeRunner();
    expect(r.runner.restore({ ctx: ctxOf('a'), abandoning: false })).toBe(true);
    expect(r.runner.restore({ ctx: ctxOf('b'), abandoning: false })).toBe(false);
    await until(r.state, ['unverifiable']);
    if (r.runner.busy()) expect(r.runner.recheck()).toBe('busy');
    else expect(r.runner.recheck()).toBe('started'); // 裏の処理が既に終わっていれば、すぐ確かめ直す
  });
});
