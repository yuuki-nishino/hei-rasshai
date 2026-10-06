// お客様の注文の購読（testing.md §4、screens.md §4.1、data-access.md §3.6）。未ログインの利用者で、本物のルールの下で確かめる
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeUsers, createEnv, emailOf, setCustomer, waitFor } from './helpers';

// お客様用の db（lib/firebase/customer）を、未ログインの利用者の db に差し替える
vi.mock('../../src/lib/firebase/customer', async () => {
  const { customerHolder: h } = await import('./helpers');
  return {
    get db() {
      return h.db;
    },
  };
});

const { watchOrder } = await import('../../src/lib/data/customerOrder');
const { customerView } = await import('../../src/lib/domain/customerView');
type CustomerSnapshot = import('../../src/lib/domain/customerView').CustomerSnapshot;

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
afterEach(() => closeUsers());

const old = Timestamp.fromMillis(Date.now() - 48 * 3600 * 1000);

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('events/e1').set({ name: 'e1', startDate: '2026-08-01', endDate: '2026-08-01', floatCash: 0, ownerUid: 'owner', deleting: false, createdAt: old });
    await db.doc('events/e1/members/owner').set({ uid: 'owner', role: 'owner', displayName: 'o', email: emailOf('owner'), joinedAt: old });
    await db.doc('events/e1/orders/o1').set({
      number: 7,
      day: '2026-08-01',
      items: [{ menuId: 'y', name: '焼きそば', price: 500, qty: 2 }],
      total: 1000,
      payment: 'paypay',
      note: '辛さ抜き（個人の名前などは書かない）',
      status: 'preparing',
      cancelledFrom: null,
      qr: true,
      createdAt: old,
      readyAt: null,
      doneAt: null,
      cancelledAt: null,
      createdBy: 'staff-uid',
      updatedBy: 'staff-uid',
      updatedAt: old,
    });
  });
});

function watch(eventId: string, orderId: string) {
  const seen: CustomerSnapshot[] = [];
  const unsub = watchOrder(eventId, orderId, (s) => seen.push(s));
  return { seen, unsub, last: () => seen[seen.length - 1] };
}

async function setStatus(status: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('events/e1/orders/o1').update({ status });
  });
}

describe('watchOrder（お客様）', () => {
  it('ログインしていなくても、注文1件を読める。サーバーの結果（fromCache = false）で、active になる', async () => {
    setCustomer();
    const w = watch('e1', 'o1');
    const snap = await waitFor(() => w.seen.find((s) => s.kind === 'doc' && s.order && !s.fromCache));
    w.unsub();
    expect(customerView(snap, 0)).toMatchObject({ state: 'active', order: { number: 7, status: 'preparing', total: 1000 } });
  });

  it('お客様に渡すのは、番号・状況・明細・合計だけ。支払い方法・メモ・スタッフの uid・時刻は含まない', async () => {
    setCustomer();
    const w = watch('e1', 'o1');
    const snap = await waitFor(() => w.seen.find((s) => s.kind === 'doc' && s.order));
    w.unsub();
    const order = snap.kind === 'doc' ? snap.order : null;
    expect(Object.keys(order!).sort()).toEqual(['items', 'number', 'status', 'total']);
    expect(JSON.stringify(snap)).not.toMatch(/paypay|辛さ抜き|staff-uid/);
  });

  it('スタッフの操作（できあがり）が、数秒以内に届く。状態の変化から、振動の判断ができる', async () => {
    setCustomer();
    const w = watch('e1', 'o1');
    await waitFor(() => w.seen.find((s) => s.kind === 'doc' && s.order?.status === 'preparing' && !s.fromCache));
    await setStatus('ready');
    const ready = await waitFor(() => w.seen.find((s) => s.kind === 'doc' && s.order?.status === 'ready'));
    w.unsub();
    expect(ready.kind === 'doc' && ready.order?.status).toBe('ready');
  });

  it('存在しない注文は、サーバーの結果（fromCache = false）で notFound になる', async () => {
    setCustomer();
    const w = watch('e1', 'nonexistent00000000');
    const snap = await waitFor(() => w.seen.find((s) => s.kind === 'doc' && !s.order && !s.fromCache));
    w.unsub();
    expect(customerView(snap, 0)).toEqual({ state: 'notFound' });
  });

  it('存在しない注文でも、キャッシュの結果（fromCache = true）の間は、notFound と判定しない', () => {
    // 判定は、純粋関数 customerView で確かめている（test/domain/customerView.test.ts）。ここでは、本物の購読の最初の結果の形を確かめる
    setCustomer();
    const w = watch('e1', 'nonexistent00000000');
    return waitFor(() => w.seen[0]).then((first) => {
      w.unsub();
      if (first.kind === 'doc' && !first.order && first.fromCache) expect(customerView(first, 0).state).toBe('loading');
      else expect(['loading', 'notFound']).toContain(customerView(first, 0).state);
    });
  });

  it('注文の一覧（list）は、お客様には読めない（ルール）', async () => {
    const db = setCustomer();
    const { collection, getDocs } = await import('firebase/firestore');
    await expect(getDocs(collection(db, 'events/e1/orders'))).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
