// 削除中・削除後のイベントでは、新しい文書を作れない（#4 のレビュー。data-access.md §7）
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { ALICE, as, createEnv, DAY, dbOf, OWNER, seed, storedOrder } from './helpers';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());

// o1：注文あり（1番）。カウンターは1。メニュー・レジ締めあり
beforeEach(() =>
  seed(env, async (db) => {
    await setDoc(doc(db, 'events/e1/counters', DAY), { n: 1 });
    await setDoc(doc(db, 'events/e1/orders/o1'), storedOrder());
    await setDoc(doc(db, 'events/e1/menu/m1'), { name: 'たこ焼き', price: 500, order: 10, soldOut: false });
    await setDoc(doc(db, 'events/e1/closings', DAY), closing(ALICE, { closedAt: new Date(0) }));
  }),
);

function closing(uid: string, patch: Record<string, unknown> = {}) {
  return {
    floatCash: 10000,
    expectedCash: 11000,
    actualCash: 11000,
    diff: 0,
    note: '',
    closedAt: serverTimestamp(),
    closedBy: uid,
    ...patch,
  };
}

const newOrder = (uid: string, number: number, day = DAY) => ({
  ...storedOrder({ number, day, createdBy: uid, updatedBy: uid }),
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

function createOrder(db: Firestore, uid: string, orderId: string, number: number, day = DAY) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'events/e1/counters', day), { n: number });
  batch.set(doc(db, 'events/e1/orders', orderId), newOrder(uid, number, day));
  return batch.commit();
}

// 新しい文書の作成を、まとめて試す（成功か失敗かを、同じ期待で）
async function expectCreates(uid: string, ok: boolean) {
  const db = as(env, uid);
  const check = (p: Promise<unknown>) => (ok ? assertSucceeds(p) : assertFails(p));
  await check(createOrder(db, uid, 'o2', 2));
  await check(setDoc(doc(db, 'events/e1/voids/v2'), { createdBy: uid, createdAt: serverTimestamp() }));
  await check(setDoc(doc(db, 'events/e1/counters', '2026-08-02'), { n: 1 }));
  await check(setDoc(doc(db, 'events/e1/menu/m2'), { name: 'ラムネ', price: 200, order: 20, soldOut: false }));
  await check(setDoc(doc(db, 'events/e1/closings', '2026-08-02'), closing(uid)));
}

describe('削除中・削除後のイベントへの作成', () => {
  it('通常（deleting = false）は、注文・墓標・カウンター・メニュー・レジ締めを作れる（比較のため）', async () => {
    await expectCreates(OWNER, true);
  });

  it('deleting = true なら、オーナーもメンバーも、新しい文書を作れない', async () => {
    await updateDoc(doc(as(env, OWNER), 'events/e1'), { deleting: true });
    await expectCreates(OWNER, false);
    await expectCreates(ALICE, false);
  });

  it('イベントの削除後（オーナーの members だけが残る、手順5〜6の間）は、新しい文書を作れない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(dbOf(ctx), 'events/e1'));
    });
    await expectCreates(OWNER, false);
  });

  it('削除中でも、既にある文書の更新はできる（オフラインで溜めた操作が、後から届いても拒否しない。消すのは削除の手順）', async () => {
    await updateDoc(doc(as(env, OWNER), 'events/e1'), { deleting: true });
    const db = as(env, ALICE);
    await assertSucceeds(
      updateDoc(doc(db, 'events/e1/orders/o1'), { status: 'ready', readyAt: serverTimestamp(), updatedBy: ALICE, updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(updateDoc(doc(db, 'events/e1/menu/m1'), { soldOut: true }));
    await assertSucceeds(setDoc(doc(db, 'events/e1/closings', DAY), closing(ALICE, { note: 'やり直し' })));
  });
});
