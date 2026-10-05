// メニュー（data-access.md §3.4、Issue #10）
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { disableNetwork, enableNetwork, Timestamp } from 'firebase/firestore';
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

const { addMenuItem, addMenuItemsBulk, deleteMenuItem, moveMenuItem, updateMenuItem, watchMenu } = await import('../../src/lib/data/menu');
const { parseBulkMenu } = await import('../../src/lib/domain/menu');
type MenuItem = import('../../src/lib/data/types').MenuItem;

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
afterEach(() => closeUsers());

const OWNER = 'owner';
const ALICE = 'alice';
const old = Timestamp.fromMillis(Date.now() - 48 * 3600 * 1000);

async function seed(menu: Record<string, { name: string; price: number; order: number; soldOut?: boolean }> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('events/e1').set({ name: 'e1', startDate: '2026-08-01', endDate: '2026-08-01', floatCash: 0, ownerUid: OWNER, deleting: false, createdAt: old });
    for (const uid of [OWNER, ALICE]) {
      await db.doc(`events/e1/members/${uid}`).set({ uid, role: uid === OWNER ? 'owner' : 'member', displayName: uid, email: emailOf(uid), joinedAt: old });
    }
    for (const [id, m] of Object.entries(menu)) await db.doc(`events/e1/menu/${id}`).set({ soldOut: false, ...m });
  });
}

beforeEach(() => env.clearFirestore());

/** 購読して、条件に合う一覧を待つ */
function watchUntil(ok: (items: MenuItem[]) => boolean): { result: Promise<MenuItem[]>; latest: () => MenuItem[] | undefined } {
  let last: MenuItem[] | undefined;
  const unsub = watchMenu('e1', (items) => (last = items), () => {});
  return { result: waitFor(() => (last && ok(last) ? last : undefined)).finally(unsub), latest: () => last };
}

describe('watchMenu', () => {
  it('order の昇順、同じ値なら id の順', async () => {
    await seed({ b: { name: 'B', price: 100, order: 10 }, a: { name: 'A', price: 100, order: 10 }, c: { name: 'C', price: 100, order: 5 } });
    setUser(ALICE);
    expect((await watchUntil((i) => i.length === 3).result).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('ほかのメンバーの変更が、リアルタイムで届く', async () => {
    await seed({ a: { name: '焼きそば', price: 500, order: 10 } });
    setUser(ALICE);
    const w = watchUntil((i) => i[0]?.soldOut === true);
    await waitFor(() => w.latest());
    setUser(OWNER); // 別の利用者（オーナー）が、売り切れにする
    await updateMenuItem('e1', 'a', { soldOut: true });
    expect((await w.result)[0]).toMatchObject({ id: 'a', soldOut: true });
  });
});

describe('追加・更新・削除', () => {
  it('追加：order は 最大 + 10、売り切れでない', async () => {
    await seed({ a: { name: 'A', price: 100, order: 10 }, b: { name: 'B', price: 100, order: 35 } });
    setUser(ALICE);
    const items = await watchUntil((i) => i.length === 2).result;
    await addMenuItem('e1', { name: 'ラムネ', price: 200 }, items);
    const after = await watchUntil((i) => i.length === 3).result;
    expect(after[2]).toMatchObject({ name: 'ラムネ', price: 200, order: 45, soldOut: false });
  });

  it('追加も、名前・価格を検査する（不正なら書かない）', async () => {
    await seed();
    setUser(ALICE);
    await expect(addMenuItem('e1', { name: '', price: 100 }, [])).rejects.toMatchObject({ code: 'validation' });
    await expect(addMenuItem('e1', { name: 'x', price: 0 }, [])).rejects.toMatchObject({ code: 'validation' });
  });

  it('100件を超える追加は、validation で拒否（書かない）', async () => {
    await seed();
    setUser(ALICE);
    const full = Array.from({ length: 100 }, (_, k) => ({ id: `m${k}`, name: 'x', price: 1, order: k, soldOut: false }));
    await expect(addMenuItem('e1', { name: 'y', price: 1 }, full)).rejects.toMatchObject({ code: 'validation' });
  });

  it('更新：名前・価格・売り切れ。不正な値は、書く前に validation', async () => {
    await seed({ a: { name: 'A', price: 100, order: 10 } });
    setUser(ALICE);
    await updateMenuItem('e1', 'a', { name: 'たこ焼き', price: 400 });
    await expect(updateMenuItem('e1', 'a', { price: 0 })).rejects.toMatchObject({ code: 'validation' });
    await expect(updateMenuItem('e1', 'a', { price: 100001 })).rejects.toMatchObject({ code: 'validation' });
    await expect(updateMenuItem('e1', 'a', { name: '' })).rejects.toMatchObject({ code: 'validation' });
    await expect(updateMenuItem('e1', 'a', { name: 'あ'.repeat(41) })).rejects.toMatchObject({ code: 'validation' });
    expect((await watchUntil((i) => i[0]?.price === 400).result)[0]).toMatchObject({ name: 'たこ焼き', price: 400 });
  });

  it('削除', async () => {
    await seed({ a: { name: 'A', price: 100, order: 10 } });
    setUser(ALICE);
    await deleteMenuItem('e1', 'a');
    expect(await watchUntil((i) => i.length === 0).result).toEqual([]);
  });

  it('メンバーでない人は、書けない（permission）', async () => {
    await seed({ a: { name: 'A', price: 100, order: 10 } });
    setUser('stranger');
    await expect(updateMenuItem('e1', 'a', { soldOut: true })).rejects.toMatchObject({ code: 'permission' });
  });
});

describe('addMenuItemsBulk（#11）', () => {
  it('parseBulkMenu の結果を、1バッチで、今の最大の続きの order で追加する', async () => {
    await seed({ a: { name: 'A', price: 100, order: 10 } });
    setUser(ALICE);
    const items = await watchUntil((i) => i.length === 1).result;
    const { ok, errors } = parseBulkMenu('たこ焼き 500\nラムネ,200\n焼きそば\u3000６００円');
    expect(errors).toEqual([]);
    await addMenuItemsBulk('e1', ok, items);
    const after = await watchUntil((i) => i.length === 4).result;
    expect(after.map((i) => [i.name, i.price, i.order])).toEqual([
      ['A', 100, 10],
      ['たこ焼き', 500, 20],
      ['ラムネ', 200, 30],
      ['焼きそば', 600, 40],
    ]);
  });

  it('合計が100件を超えるなら、1件も書かない（validation）', async () => {
    await seed();
    setUser(ALICE);
    const items = Array.from({ length: 99 }, (_, k) => ({ id: `m${k}`, name: 'x', price: 1, order: k, soldOut: false }));
    const lines = [
      { line: 1, name: 'a', price: 1 },
      { line: 2, name: 'b', price: 1 },
    ];
    await expect(addMenuItemsBulk('e1', lines, items)).rejects.toMatchObject({ code: 'validation' });
    // 1件も書かれていない（PR #37 のレビュー B5）
    expect(await watchUntil(() => true).result).toEqual([]);
    await expect(addMenuItemsBulk('e1', lines.slice(0, 1), [])).resolves.toBeUndefined();
  });
});

describe('moveMenuItem', () => {
  it('入れ替えて、全件の order を 10, 20, 30… に振り直す（同じ値になっていても動く）', async () => {
    await seed({ a: { name: 'A', price: 100, order: 10 }, b: { name: 'B', price: 100, order: 10 }, c: { name: 'C', price: 100, order: 10 } });
    setUser(ALICE);
    const items = await watchUntil((i) => i.length === 3).result;
    await moveMenuItem('e1', 'c', 'up', items);
    const after = await watchUntil((i) => i.map((x) => x.id).join() === 'a,c,b').result;
    expect(after.map((x) => x.order)).toEqual([10, 20, 30]);
  });
});

describe('オフライン', () => {
  it('オフラインでも受け付け、画面（購読）には、すぐ反映される。つながると送られる', async () => {
    await seed({ a: { name: 'A', price: 100, order: 10 } });
    const db = setUser(ALICE);
    await watchUntil((i) => i.length === 1).result;
    await disableNetwork(db);
    const sent = updateMenuItem('e1', 'a', { soldOut: true }); // サーバーが受け取るまで終わらない
    expect((await watchUntil((i) => i[0]?.soldOut === true).result)[0]?.soldOut).toBe(true);
    await enableNetwork(db);
    await sent;
  });
});
