// イベントの削除 deleteEventDeep（testing.md §4 の 11・22・25、data-access.md §7、★U4）。本物のルールの下で確かめる
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeUsers, createEnv, emailOf, setUnreachableUser, setUser } from './helpers';

vi.mock('../../src/lib/firebase/staff', async () => {
  const { holder } = await import('./helpers');
  return {
    get db() {
      return holder.db;
    },
  };
});

const { deleteEventDeep } = await import('../../src/lib/data/eventDelete');
type DeleteProgress = import('../../src/lib/data/eventDelete').DeleteProgress;

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
afterEach(() => closeUsers());

const OWNER = 'owner';
const ALICE = 'alice';
const old = Timestamp.fromMillis(Date.now() - 48 * 3600 * 1000);
const SUBS = ['orders', 'voids', 'counters', 'closings', 'menu', 'invites', 'members'] as const;

/** イベント e1 を、配下ごと作る（ルールを無効にして）。注文は orders 件 */
async function seed(orders: number, event: { deleting: boolean } | null = { deleting: false }) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    if (event) {
      await db.doc('events/e1').set({ name: 'e1', startDate: '2026-08-01', endDate: '2026-08-01', floatCash: 0, ownerUid: OWNER, deleting: event.deleting, createdAt: old });
    }
    await db.doc(`events/e1/members/${OWNER}`).set({ uid: OWNER, role: 'owner', displayName: 'o', email: emailOf(OWNER), joinedAt: old });
    if (!event) return;
    await db.doc(`events/e1/members/${ALICE}`).set({ uid: ALICE, role: 'member', displayName: 'a', email: emailOf(ALICE), joinedAt: old });
    await db.doc('events/e1/invites/bob@example.com').set({ createdBy: OWNER, createdAt: old });
    await db.doc('events/e1/menu/m1').set({ name: '焼きそば', price: 500, order: 10, soldOut: false });
    await db.doc('events/e1/counters/2026-08-01').set({ n: orders });
    await db.doc('events/e1/closings/2026-08-01').set({ floatCash: 0, expectedCash: 0, actualCash: 0, diff: 0, note: '', closedAt: old, closedBy: OWNER });
    await db.doc('events/e1/voids/v1').set({ createdBy: OWNER, createdAt: old });
    for (let from = 0; from < orders; from += 400) {
      const batch = db.batch();
      for (let k = from; k < Math.min(orders, from + 400); k++) {
        batch.set(db.doc(`events/e1/orders/o${k}`), { number: k + 1, day: '2026-08-01', items: [], total: 500, status: 'done', createdAt: old });
      }
      await batch.commit();
    }
  });
}

/** イベントの配下に残っている文書の数（コレクションごと）と、イベント本体の有無 */
async function remains() {
  const r = { event: false, counts: {} as Record<string, number> };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    r.event = (await db.doc('events/e1').get()).exists;
    for (const s of SUBS) r.counts[s] = (await db.collection(`events/e1/${s}`).get()).size;
  });
  return r;
}

const EMPTY = { event: false, counts: { orders: 0, voids: 0, counters: 0, closings: 0, menu: 0, invites: 0, members: 0 } };

beforeEach(() => seed(0));

describe('deleteEventDeep', () => {
  it('#11：配下がすべて消え、孤立が残らない。注文は450件ずつ消え、進捗が届く', async () => {
    await seed(1000);
    setUser(OWNER);
    const progress: DeleteProgress[] = [];
    await deleteEventDeep('e1', OWNER, (p) => progress.push(p));
    expect(await remains()).toEqual(EMPTY);
    expect(progress[0]).toEqual({ phase: 'prepare', deleted: 0 });
    // 消した件数：注文1000 + 墓標1 + カウンター1 + レジ締め1 + メニュー1 + 招待1 + 他のメンバー1
    expect(progress.at(-1)).toMatchObject({ phase: 'self', deleted: 1006 });
    expect(progress.map((p) => p.deleted)).toEqual([...progress.map((p) => p.deleted)].sort((a, b) => a - b)); // 件数は減らない
  });

  it('#11：途中で止めて再実行しても完了する。止まった後は、ほかのメンバーが書き込めない', async () => {
    await seed(1000);
    setUser(OWNER);
    // 注文を450件ほど消したところで止める
    await expect(
      deleteEventDeep('e1', OWNER, (p) => {
        if (p.phase === 'data' && p.deleted >= 450) throw new Error('stop');
      }),
    ).rejects.toThrow();
    const mid = await remains();
    expect(mid.event).toBe(true);
    expect(mid.counts.orders).toBeLessThan(1000);
    expect(mid.counts.orders).toBeGreaterThan(0);
    expect(mid.counts.members).toBe(1); // ほかのメンバーは、先に外されている

    // 外されたメンバーは、メニューを書けない（ルール）。オーナーも、新しい文書は作れない（deleting = true）
    const alice = setUser(ALICE);
    await expect(setDoc(doc(alice, 'events/e1/menu/m1'), { name: 'x', price: 1, order: 1, soldOut: false })).rejects.toMatchObject({ code: 'permission-denied' });

    setUser(OWNER);
    await deleteEventDeep('e1', OWNER);
    expect(await remains()).toEqual(EMPTY);
  });

  it('イベント本体が消えた後（自分の members だけが残る）で再実行しても、完了する', async () => {
    await seed(0, null);
    setUser(OWNER);
    await deleteEventDeep('e1', OWNER);
    expect(await remains()).toEqual(EMPTY);
  });

  it('すでに deleting = true のイベントは、そのまま続きから消す', async () => {
    await seed(10, { deleting: true });
    setUser(OWNER);
    await deleteEventDeep('e1', OWNER);
    expect(await remains()).toEqual(EMPTY);
  });

  it('#22：オフライン（サーバーに届かない）なら offline で始めない。何も消えない', async () => {
    await seed(5);
    setUnreachableUser(OWNER);
    await expect(deleteEventDeep('e1', OWNER)).rejects.toMatchObject({ code: 'offline' });
    const r = await remains();
    expect(r.event).toBe(true);
    expect(r.counts.orders).toBe(5);
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await ctx.firestore().doc('events/e1').get()).get('deleting')).toBe(false); // 削除中にもしていない
    });
  }, 30_000);

  it('オーナーでないメンバーは、削除できない（permission）。何も消えない', async () => {
    await seed(5);
    setUser(ALICE);
    await expect(deleteEventDeep('e1', ALICE)).rejects.toMatchObject({ code: 'permission' });
    const r = await remains();
    expect(r.event).toBe(true);
    expect(r.counts.orders).toBe(5);
  });

  it('★U4：数千件（3,000件）の注文を、消しきれる。かかった時間を記録する', async () => {
    await seed(3000);
    setUser(OWNER);
    const t0 = Date.now();
    await deleteEventDeep('e1', OWNER);
    console.log(`★U4 Emulator：注文3,000件の削除に ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
    expect(await remains()).toEqual(EMPTY);
  }, 180_000);
});
