// 「完成」「渡した」の猶予（#45）：猶予の間は、お客様の画面に、何も届かない（本物のルールの下で、お客様の購読を確かめる）
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeUsers, createEnv, emailOf, setCustomer, setUser, waitFor } from './helpers';

vi.mock('../../src/lib/firebase/staff', async () => {
  const { holder } = await import('./helpers');
  return {
    get db() {
      return holder.db;
    },
  };
});
vi.mock('../../src/lib/firebase/customer', async () => {
  const { customerHolder: h } = await import('./helpers');
  return {
    get db() {
      return h.db;
    },
  };
});

const { watchOrder } = await import('../../src/lib/data/customerOrder');
const { findOrderOnServer, transitionOrder } = await import('../../src/lib/data/orders');
const { createHoldStore } = await import('../../src/state/holdStore');
type CustomerSnapshot = import('../../src/lib/domain/customerView').CustomerSnapshot;

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
afterEach(() => closeUsers());

const old = Timestamp.fromMillis(Date.now() - 48 * 3600 * 1000);
const GRACE = 800;

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('events/e1').set({ name: 'e1', startDate: '2026-08-01', endDate: '2026-08-01', floatCash: 0, ownerUid: 'alice', deleting: false, createdAt: old });
    await db.doc('events/e1/members/alice').set({ uid: 'alice', role: 'owner', displayName: 'a', email: emailOf('alice'), joinedAt: old });
    await db.doc('events/e1/orders/o1').set({
      number: 7, day: '2026-08-01', items: [{ menuId: 'y', name: '焼きそば', price: 500, qty: 2 }], total: 1000, payment: 'cash', note: '',
      status: 'preparing', cancelledFrom: null, qr: true, createdAt: old, readyAt: null, doneAt: null, cancelledAt: null,
      createdBy: 'alice', updatedBy: 'alice', updatedAt: old,
    });
  });
});

async function setup() {
  setCustomer();
  const seen: CustomerSnapshot[] = [];
  const unsub = watchOrder('e1', 'o1', (s) => seen.push(s));
  await waitFor(() => seen.find((s) => s.kind === 'doc' && s.order && !s.fromCache)); // お客様の画面が、調理中で落ち着くまで待つ
  setUser('alice'); // 以降の staff の操作は、alice の db
  const order = (await findOrderOnServer('e1', 'o1'))!;
  const store = createHoldStore({
    graceMs: GRACE,
    settleMs: 100,
    write: (h) => void transitionOrder(h.eventId, h.order, h.action, h.uid),
  });
  const statuses = () => seen.flatMap((s) => (s.kind === 'doc' && s.order ? [s.order.status] : []));
  return { store, order, statuses, unsub };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('完成の猶予', () => {
  it('猶予の間に「元に戻す」：サーバーには何も書かれず、お客様の画面は、一度も変わらない', async () => {
    const { store, order, statuses, unsub } = await setup();
    store.start({ eventId: 'e1', uid: 'alice', order, action: 'ready' });
    await sleep(GRACE / 2);
    expect(store.undo('o1')).toBe(true);
    await sleep(GRACE + 700); // 猶予が過ぎても、書かれない
    expect((await findOrderOnServer('e1', 'o1'))!.status).toBe('preparing');
    expect(statuses().every((s) => s === 'preparing')).toBe(true);
    unsub();
  });

  it('戻さなければ、猶予のあと、サーバーに書かれ、お客様の画面が「できあがり」になる。猶予の間は、変わらない', async () => {
    const { store, order, statuses, unsub } = await setup();
    store.start({ eventId: 'e1', uid: 'alice', order, action: 'ready' });
    await sleep(GRACE / 2);
    expect(statuses().includes('ready')).toBe(false);
    expect((await findOrderOnServer('e1', 'o1'))!.status).toBe('preparing');
    await waitFor(() => (statuses().includes('ready') ? true : undefined));
    expect((await findOrderOnServer('e1', 'o1'))!.status).toBe('ready');
    unsub();
  });

  it('flushAll（画面を離れる前）：猶予を待たずに、すぐ書かれる', async () => {
    const { store, order, unsub } = await setup();
    store.start({ eventId: 'e1', uid: 'alice', order, action: 'ready' });
    store.flushAll();
    const start = Date.now();
    for (;;) {
      if ((await findOrderOnServer('e1', 'o1'))!.status === 'ready') break;
      expect(Date.now() - start).toBeLessThan(GRACE); // 猶予より、ずっと早く
      await sleep(50);
    }
    unsub();
  });
});
