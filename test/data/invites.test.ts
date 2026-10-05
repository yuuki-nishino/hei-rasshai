// 招待と参加（testing.md §4 #10・#23、security-rules.md §4、ADR-0003）
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { disableNetwork, enableNetwork, Timestamp } from 'firebase/firestore';
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

// 確認（getDocFromServer）の直後に通信が切れる場合を作るため、getDocFromServer の後に処理を差し込めるようにする（PR #33 のレビュー J1）
const hooks = vi.hoisted(() => ({ afterServerRead: null as null | (() => Promise<void>) }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const m = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...m,
    getDocFromServer: async (...args: Parameters<typeof m.getDocFromServer>) => {
      try {
        return await m.getDocFromServer(...args);
      } finally {
        const hook = hooks.afterServerRead;
        hooks.afterServerRead = null;
        if (hook) await hook();
      }
    },
  };
});

const { joinEvent } = await import('../../src/lib/data/events');
const { cancelInvite, createInvite, watchInvites } = await import('../../src/lib/data/members');
type Invite = import('../../src/lib/data/types').Invite;

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
afterEach(() => closeUsers());

const OWNER = 'owner';
const BOB = 'bob'; // 招待される人
const CAROL = 'carol'; // 招待されていない人
const hoursAgo = (h: number) => Timestamp.fromMillis(Date.now() - h * 3600 * 1000);

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('events/e1').set({ name: 'e1', startDate: '2026-08-01', endDate: '2026-08-01', floatCash: 0, ownerUid: OWNER, deleting: false, createdAt: hoursAgo(48) });
    await db.doc(`events/e1/members/${OWNER}`).set({ uid: OWNER, role: 'owner', displayName: 'o', email: emailOf(OWNER), joinedAt: hoursAgo(48) });
  });
});

async function read(path: string): Promise<Record<string, unknown> | undefined> {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await ctx.firestore().doc(path).get()).data();
  });
  return data;
}

async function seedInvite(email: string, createdAt: Timestamp) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`events/e1/invites/${email}`).set({ createdBy: OWNER, createdAt });
  });
}

describe('招待（オーナー）', () => {
  it('作成・一覧・再発行（期限が延びる）・取り消し', async () => {
    setUser(OWNER);
    let invites: Invite[] | undefined;
    const unsub = watchInvites('e1', (v) => (invites = v), () => {});
    await createInvite('e1', emailOf(BOB), OWNER);
    const first = await waitFor(() => invites?.find((i) => i.email === emailOf(BOB) && i.createdAt)?.createdAt ?? undefined);
    const stored = await read(`events/e1/invites/${emailOf(BOB)}`);
    expect(stored?.createdBy).toBe(OWNER);

    await new Promise((r) => setTimeout(r, 20));
    await createInvite('e1', emailOf(BOB), OWNER); // 再発行
    await waitFor(() => {
      const t = invites?.find((i) => i.email === emailOf(BOB))?.createdAt;
      return t && t.getTime() > first.getTime() ? true : undefined;
    });

    await cancelInvite('e1', emailOf(BOB));
    await waitFor(() => (invites?.length === 0 ? true : undefined));
    expect(await read(`events/e1/invites/${emailOf(BOB)}`)).toBeUndefined();
    unsub();
  });

  it('メンバー（オーナーでない）は、招待を作れない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`events/e1/members/${CAROL}`).set({ uid: CAROL, role: 'member', displayName: 'c', email: emailOf(CAROL), joinedAt: hoursAgo(1) });
    });
    setUser(CAROL);
    await expect(createInvite('e1', emailOf(BOB), CAROL)).rejects.toMatchObject({ code: 'permission' });
  });

  it('#23：オフラインなら、招待の作成・取り消しは offline で失敗し、書き込みは溜まらない', async () => {
    const db = setUser(OWNER);
    await disableNetwork(db);
    await expect(createInvite('e1', emailOf(BOB), OWNER)).rejects.toMatchObject({ code: 'offline' });
    await expect(cancelInvite('e1', emailOf(BOB))).rejects.toMatchObject({ code: 'offline' });
    expect(await read(`events/e1/invites/${emailOf(BOB)}`)).toBeUndefined();
  });
});

describe('参加（joinEvent）', () => {
  it('#10：招待された人は参加でき、招待が消える。2回目は already（招待は無くても、メンバーなので成功）', async () => {
    await seedInvite(emailOf(BOB), hoursAgo(1));
    setUser(BOB);
    expect(await joinEvent('e1', authUser(BOB, 'ボブ'))).toBe('joined');
    expect(await read(`events/e1/members/${BOB}`)).toMatchObject({ uid: BOB, role: 'member', displayName: 'ボブ', email: emailOf(BOB) });
    expect(await read(`events/e1/invites/${emailOf(BOB)}`)).toBeUndefined();
    expect(await joinEvent('e1', authUser(BOB))).toBe('already');
  });

  it('#10：招待されていないアカウントは、参加できない（permission）。招待は残る', async () => {
    await seedInvite(emailOf(BOB), hoursAgo(1));
    setUser(CAROL);
    await expect(joinEvent('e1', authUser(CAROL))).rejects.toMatchObject({ code: 'permission' });
    expect(await read(`events/e1/invites/${emailOf(BOB)}`)).toBeDefined();
  });

  it('期限切れ（発行から1日を過ぎた）の招待では、参加できない', async () => {
    await seedInvite(emailOf(BOB), hoursAgo(25));
    setUser(BOB);
    await expect(joinEvent('e1', authUser(BOB))).rejects.toMatchObject({ code: 'permission' });
  });

  it('参加した後、抜けた人が、同じ招待をもう一度使うことはできない（使い切り）', async () => {
    await seedInvite(emailOf(BOB), hoursAgo(1));
    setUser(BOB);
    await joinEvent('e1', authUser(BOB));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`events/e1/members/${BOB}`).delete();
    });
    await expect(joinEvent('e1', authUser(BOB))).rejects.toMatchObject({ code: 'permission' });
  });

  it('削除中のイベントには、招待があっても参加できない', async () => {
    await seedInvite(emailOf(BOB), hoursAgo(1));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('events/e1').update({ deleting: true });
    });
    setUser(BOB);
    await expect(joinEvent('e1', authUser(BOB))).rejects.toMatchObject({ code: 'permission' });
  });

  it('J1：確認の直後に通信が切れると、8秒で timeout になる（止まったままにならない）。送信待ちは、つながり直すと通る', async () => {
    await seedInvite(emailOf(BOB), hoursAgo(1));
    const db = setUser(BOB);
    hooks.afterServerRead = () => disableNetwork(db);
    await expect(joinEvent('e1', authUser(BOB))).rejects.toMatchObject({ code: 'timeout' });
    expect(await read(`events/e1/members/${BOB}`)).toBeUndefined();
    // 既知の制約：送信待ちは端末に残り、つながり直したときに送られる。もう一度呼ぶと、すでにメンバーと分かる
    await enableNetwork(db);
    await vi.waitFor(async () => expect(await read(`events/e1/members/${BOB}`)).toBeDefined(), { timeout: 8000 });
    expect(await joinEvent('e1', authUser(BOB))).toBe('already');
  });

  it('#23：オフラインなら、offline で失敗し、書き込みは溜まらない', async () => {
    await seedInvite(emailOf(BOB), hoursAgo(1));
    const db = setUser(BOB);
    await disableNetwork(db);
    await expect(joinEvent('e1', authUser(BOB))).rejects.toMatchObject({ code: 'offline' });
    expect(await read(`events/e1/members/${BOB}`)).toBeUndefined();
  });
});
