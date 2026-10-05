// メンバーの一覧・削除・抜ける、未送信の確認（testing.md §4 #24、data-access.md §3.3・§8）
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { disableNetwork, doc, enableNetwork, Timestamp, updateDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeUsers, createEnv, emailOf, setUser, waitFor } from './helpers';

// lib/data が使う db を、setUser で作った利用者の db に差し替える
vi.mock('../../src/lib/firebase/staff', async () => {
  const { holder } = await import('./helpers');
  return {
    get db() {
      return holder.db;
    },
  };
});

const { removeMember, watchMembers } = await import('../../src/lib/data/members');
const { hasPendingWrites } = await import('../../src/lib/data/cache');
type Member = import('../../src/lib/data/types').Member;

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
afterEach(() => closeUsers());

const OWNER = 'owner';
const ALICE = 'alice';
const BOB = 'bob';
const old = Timestamp.fromMillis(Date.now() - 48 * 3600 * 1000);
const member = (uid: string, role: 'owner' | 'member', displayName: string) => ({ uid, role, displayName, email: emailOf(uid), joinedAt: old });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const e of ['e1', 'e2']) {
      await db.doc(`events/${e}`).set({ name: e, startDate: '2026-08-01', endDate: '2026-08-01', floatCash: 0, ownerUid: OWNER, deleting: false, createdAt: old });
      await db.doc(`events/${e}/members/${OWNER}`).set(member(OWNER, 'owner', 'おーなー'));
      await db.doc(`events/${e}/members/${ALICE}`).set(member(ALICE, 'member', 'ありす'));
    }
    await db.doc(`events/e1/members/${BOB}`).set(member(BOB, 'member', 'ぼぶ'));
  });
});

async function exists(path: string): Promise<boolean> {
  let found = false;
  await env.withSecurityRulesDisabled(async (ctx) => {
    found = (await ctx.firestore().doc(path).get()).exists;
  });
  return found;
}

describe('watchMembers', () => {
  it('オーナーが先、あとは表示名の順', async () => {
    setUser(ALICE);
    let members: Member[] | undefined;
    const unsub = watchMembers('e1', (m) => (members = m), () => {});
    const list = await waitFor(() => members);
    expect(list.map((m) => [m.uid, m.role])).toEqual([
      [OWNER, 'owner'],
      [ALICE, 'member'],
      [BOB, 'member'],
    ]);
    unsub();
  });

  it('外されると、購読が permission で止まる（画面は、イベント一覧に戻す）', async () => {
    setUser(BOB);
    let error: { code: string } | undefined;
    let members: Member[] | undefined;
    const unsub = watchMembers('e1', (m) => (members = m), (e) => (error = e));
    await waitFor(() => members);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`events/e1/members/${BOB}`).delete();
    });
    expect((await waitFor(() => error)).code).toBe('permission');
    unsub();
  });
});

describe('removeMember', () => {
  it('オーナーは、ほかのメンバーを外せる', async () => {
    setUser(OWNER);
    await removeMember('e1', BOB);
    expect(await exists(`events/e1/members/${BOB}`)).toBe(false);
  });

  it('メンバーは、自分で抜けられる。ほかのメンバーは外せない', async () => {
    setUser(ALICE);
    await expect(removeMember('e1', BOB)).rejects.toMatchObject({ code: 'permission' });
    await removeMember('e1', ALICE);
    expect(await exists(`events/e1/members/${ALICE}`)).toBe(false);
  });

  it('オーナーは、抜けられない', async () => {
    setUser(OWNER);
    await expect(removeMember('e1', OWNER)).rejects.toMatchObject({ code: 'permission' });
  });

  it('オフラインなら offline で失敗し、書き込みは溜まらない', async () => {
    const db = setUser(OWNER);
    await disableNetwork(db);
    await expect(removeMember('e1', BOB)).rejects.toMatchObject({ code: 'offline' });
    expect(await exists(`events/e1/members/${BOB}`)).toBe(true);
  });
});

describe('hasPendingWrites（#24：消去の延期の判断に使う）', () => {
  it('ほかのイベントに未送信があれば true。送られれば false', async () => {
    const db = setUser(ALICE);
    expect(await hasPendingWrites()).toBe(false);
    await disableNetwork(db);
    // オフラインで、別のイベント（e2）の名前を変える（送信待ちになる）
    void updateDoc(doc(db, 'events/e2'), { name: 'e2 改' }).catch(() => {});
    expect(await hasPendingWrites(300)).toBe(true);
    await enableNetwork(db);
    await vi.waitFor(async () => expect(await hasPendingWrites(1000)).toBe(false), { timeout: 8000 });
  });
});
