// イベントのデータアクセス（testing.md §4 #15・#16b・#21・#26、data-access.md §3.2・§3.9）
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { disableNetwork, doc, getDoc, Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authUser, closeUsers, createEnv, emailOf, setUser, waitFor } from './helpers';

// lib/data が使う db を、setUser で作った利用者の db に差し替える
vi.mock('../../src/lib/firebase/staff', async () => {
  const { holder } = await import('./helpers');
  return {
    get db() {
      return holder.db;
    },
  };
});

const { createEvent, watchMyEvents } = await import('../../src/lib/data/events');
const { AppError } = await import('../../src/lib/data/errors');
type EventDoc = import('../../src/lib/data/types').EventDoc;

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
afterEach(() => closeUsers());

const CREATOR = 'creator';
const ALICE = 'alice';
const input = { name: '夏まつり', startDate: '2026-08-01', endDate: '2026-08-02', floatCash: 10000 };
const old = Timestamp.fromMillis(Date.now() - 48 * 3600 * 1000);

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`creators/${emailOf(CREATOR)}`).set({});
    // e1：ALICE がメンバー
    await db.doc('events/e1').set({ ...input, name: 'e1', ownerUid: 'owner', deleting: false, createdAt: old });
    await db.doc(`events/e1/members/${ALICE}`).set({ uid: ALICE, role: 'member', displayName: 'a', email: emailOf(ALICE), joinedAt: old });
  });
});

/** 一覧の購読の、条件に合う結果を待つ */
function watchUntil(uid: string, ok: (events: EventDoc[], fromCache: boolean) => boolean) {
  let last: { events: EventDoc[]; fromCache: boolean } | undefined;
  let error: unknown;
  const unsub = watchMyEvents(
    uid,
    (events, { fromCache }) => (last = { events, fromCache }),
    (e) => (error = e),
  );
  return waitFor(() => {
    if (error) throw error;
    return last && ok(last.events, last.fromCache) ? last : undefined;
  }).finally(unsub);
}

async function membersDoc(eventId: string, uid: string): Promise<boolean> {
  let exists = false;
  await env.withSecurityRulesDisabled(async (ctx) => {
    exists = (await ctx.firestore().doc(`events/${eventId}/members/${uid}`).get()).exists;
  });
  return exists;
}

describe('createEvent', () => {
  it('creators のアカウントは作れる。イベント＋オーナーの members ができ、一覧に出る', async () => {
    setUser(CREATOR);
    const id = await createEvent(input, authUser(CREATOR, '山田'));
    const r = await watchUntil(CREATOR, (es, fromCache) => !fromCache && es.length === 1);
    expect(r.events[0]).toEqual({ id, ...input, ownerUid: CREATOR, deleting: false });
    expect(await membersDoc(id, CREATOR)).toBe(true);
  });

  it('#26：displayName が null なら、メールの @ より前で作れる', async () => {
    const db = setUser(CREATOR);
    const id = await createEvent(input, authUser(CREATOR, null));
    expect((await getDoc(doc(db, 'events', id, 'members', CREATOR))).data()?.displayName).toBe(CREATOR);
  });

  it('#26：displayName が61文字以上なら、60文字に切り詰めて作れる（絵文字でも）', async () => {
    const db = setUser(CREATOR);
    for (const [name, expected] of [
      ['あ'.repeat(61), 'あ'.repeat(60)],
      ['🍜'.repeat(31), '🍜'.repeat(30)],
    ]) {
      const id = await createEvent(input, authUser(CREATOR, name!));
      expect((await getDoc(doc(db, 'events', id, 'members', CREATOR))).data()?.displayName).toBe(expected);
    }
  });

  it('ルールの文字数は UTF-16 の単位（絵文字は2文字）。画面の検査（validateEventForm）と同じ数え方', async () => {
    setUser(CREATOR);
    await expect(createEvent({ ...input, name: '🍜'.repeat(30) }, authUser(CREATOR))).resolves.toBeTypeOf('string');
    await expect(createEvent({ ...input, name: '🍜'.repeat(31) }, authUser(CREATOR))).rejects.toMatchObject({ code: 'permission' });
  });

  it('creators でないアカウントは、AppError(permission)', async () => {
    setUser(ALICE);
    await expect(createEvent(input, authUser(ALICE))).rejects.toMatchObject({ code: 'permission' });
  });

  it('オフラインなら、AppError(offline)。書き込みは溜まらない（復帰しても作られない）', async () => {
    const db = setUser(CREATOR);
    await disableNetwork(db);
    const e = await createEvent(input, authUser(CREATOR)).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(AppError);
    expect((e as InstanceType<typeof AppError>).code).toBe('offline');
    let count = -1;
    await env.withSecurityRulesDisabled(async (ctx) => {
      count = (await ctx.firestore().collection('events').where('ownerUid', '==', CREATOR).get()).size;
    });
    expect(count).toBe(0);
  });
});

describe('watchMyEvents', () => {
  it('自分がメンバーのイベントだけを出す', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('events/e2').set({ ...input, name: 'e2', ownerUid: 'other', deleting: false, createdAt: old });
    });
    setUser(ALICE);
    const r = await watchUntil(ALICE, (es, fromCache) => !fromCache && es.length > 0);
    expect(r.events.map((e) => e.id)).toEqual(['e1']);
  });

  it('#15：孤立した members（イベントが存在しない）は、サーバーで確かめて削除し、一覧に出さない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`events/gone/members/${ALICE}`).set({ uid: ALICE, role: 'member', displayName: 'a', email: emailOf(ALICE), joinedAt: old });
    });
    setUser(ALICE);
    const r = await watchUntil(ALICE, (es, fromCache) => !fromCache && es.length === 1);
    expect(r.events.map((e) => e.id)).toEqual(['e1']);
    // 掃除は、一覧を返すのと同時に進むため、消えるのを待つ
    await vi.waitFor(async () => expect(await membersDoc('gone', ALICE)).toBe(false), { timeout: 8000 });
    expect(await membersDoc('e1', ALICE)).toBe(true);
  });

  it('#21・#16b：オフラインで起動（disableNetwork 後に購読）しても、キャッシュのイベントが出る。members は消さない', async () => {
    const db = setUser(ALICE);
    await watchUntil(ALICE, (es, fromCache) => !fromCache && es.length === 1); // 一度オンラインで開き、キャッシュに入れる
    // サーバーではイベントを消しておく（オフラインの端末は、それを知らない）
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('events/e1').delete();
    });
    await disableNetwork(db);
    const r = await watchUntil(ALICE, (es, fromCache) => fromCache && es.length === 1);
    expect(r.events.map((e) => e.id)).toEqual(['e1']);
    expect(await membersDoc('e1', ALICE)).toBe(true);
  });
});
