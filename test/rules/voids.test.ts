// 墓標のルール（testing.md §3：24〜27。ADR-0004）
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALICE, anon, as, BOB, CAROL, createEnv, DAY, OWNER, seed, storedOrder } from './helpers';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());

// o1：注文あり（1番）。v1：墓標あり（注文なし）
beforeEach(() =>
  seed(env, async (db) => {
    await setDoc(doc(db, 'events/e1/counters', DAY), { n: 1 });
    await setDoc(doc(db, 'events/e1/orders/o1'), storedOrder());
    await setDoc(doc(db, 'events/e1/voids/v1'), { createdBy: ALICE, createdAt: new Date(0) });
  }),
);

const voidData = (uid: string, patch: Record<string, unknown> = {}) => ({
  createdBy: uid,
  createdAt: serverTimestamp(),
  ...patch,
});

const newOrder = (uid: string, number: number) => ({
  ...storedOrder({ number, createdBy: uid, updatedBy: uid }),
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

// 確定（order-confirm.md §5.1）：注文が既にあれば何もしない
async function confirm(db: Firestore, orderId: string, uid: string) {
  return runTransaction(db, async (tx) => {
    const orderRef = doc(db, 'events/e1/orders', orderId);
    const counterRef = doc(db, 'events/e1/counters', DAY);
    if ((await tx.get(orderRef)).exists()) return;
    const counter = await tx.get(counterRef);
    const n = ((counter.data()?.n as number | undefined) ?? 0) + 1;
    tx.set(counterRef, { n });
    tx.set(orderRef, newOrder(uid, n));
  });
}

// やめる（order-confirm.md §5.2）：注文があれば何もしない。なければ墓標を作る
async function voidOrFind(db: Firestore, orderId: string, uid: string) {
  return runTransaction(db, async (tx) => {
    const orderRef = doc(db, 'events/e1/orders', orderId);
    const voidRef = doc(db, 'events/e1/voids', orderId);
    if ((await tx.get(orderRef)).exists()) return;
    if (!(await tx.get(voidRef)).exists()) tx.set(voidRef, voidData(uid));
  });
}

describe('墓標の作成・読み取り', () => {
  it('メンバーは、注文の無い ID に、墓標を作れる。読める', async () => {
    const db = as(env, ALICE);
    await assertSucceeds(setDoc(doc(db, 'events/e1/voids/o2'), voidData(ALICE)));
    await assertSucceeds(getDoc(doc(db, 'events/e1/voids/o2')));
  });

  it('メンバーは、墓標の一覧を読める（イベントの削除で数え上げる。#21）。メンバーでない人は読めない', async () => {
    await assertSucceeds(getDocs(collection(as(env, ALICE), 'events/e1/voids')));
    await assertFails(getDocs(collection(as(env, BOB), 'events/e1/voids')));
    await assertFails(getDocs(collection(anon(env), 'events/e1/voids')));
  });

  it('余計な項目、createdAt がクライアントの時刻、createdBy が他人なら拒否', async () => {
    const db = as(env, ALICE);
    await assertFails(setDoc(doc(db, 'events/e1/voids/o2'), voidData(ALICE, { reason: 'x' })));
    await assertFails(setDoc(doc(db, 'events/e1/voids/o2'), voidData(ALICE, { createdAt: new Date() })));
    await assertFails(setDoc(doc(db, 'events/e1/voids/o2'), voidData(OWNER)));
  });

  it('3・4・5：未ログイン・非メンバー・別のイベントのメンバーは、墓標を読み書きできない', async () => {
    await assertFails(getDoc(doc(anon(env), 'events/e1/voids/v1')));
    for (const uid of [BOB, CAROL]) {
      const db = as(env, uid);
      await assertFails(getDoc(doc(db, 'events/e1/voids/v1')));
      await assertFails(setDoc(doc(db, 'events/e1/voids/o2'), voidData(uid)));
    }
  });
});

describe('墓標の排他（R8）', () => {
  it('24：注文があるのに、墓標を作ると拒否', async () => {
    await assertFails(setDoc(doc(as(env, ALICE), 'events/e1/voids/o1'), voidData(ALICE)));
  });

  it('25：墓標があるのに、同じ orderId で注文を作ると拒否', async () => {
    const db = as(env, ALICE);
    const batch = writeBatch(db);
    batch.set(doc(db, 'events/e1/counters', DAY), { n: 2 });
    batch.set(doc(db, 'events/e1/orders/v1'), newOrder(ALICE, 2));
    await assertFails(batch.commit());
  });

  it('同じバッチで、注文と墓標を両方作ると拒否（どちらか一方だけが存在できる）', async () => {
    const db = as(env, ALICE);
    const batch = writeBatch(db);
    batch.set(doc(db, 'events/e1/counters', DAY), { n: 2 });
    batch.set(doc(db, 'events/e1/orders/o2'), newOrder(ALICE, 2));
    batch.set(doc(db, 'events/e1/voids/o2'), voidData(ALICE));
    await assertFails(batch.commit());
  });

  it('25：確定のトランザクションは、墓標のある ID では拒否される（遅れて届いたコミット）', async () => {
    await assertFails(confirm(as(env, ALICE), 'v1', ALICE));
  });

  it('24：やめるのトランザクションは、注文のある ID では墓標を作らない', async () => {
    await assertSucceeds(voidOrFind(as(env, ALICE), 'o1', ALICE));
    expect((await getDoc(doc(as(env, ALICE), 'events/e1/voids/o1'))).exists()).toBe(false);
  });

  it('26：同じ orderId で、確定とやめるを並行して実行しても、注文と墓標は並存しない（補助的な確認）', async () => {
    const alice = as(env, ALICE);
    const owner = as(env, OWNER);
    for (let i = 0; i < 5; i++) {
      const id = `race${i}`;
      // どちらが先にコミットしても、後の方は、拒否されるか（確定）、何も書かない（やめる）
      await Promise.allSettled([confirm(alice, id, ALICE), voidOrFind(owner, id, OWNER)]);
      const order = await getDoc(doc(alice, 'events/e1/orders', id));
      const tomb = await getDoc(doc(alice, 'events/e1/voids', id));
      expect(order.exists() !== tomb.exists()).toBe(true);
    }
  });
});

describe('墓標の更新・削除', () => {
  it('27：墓標は、更新できない', async () => {
    await assertFails(updateDoc(doc(as(env, OWNER), 'events/e1/voids/v1'), { createdBy: OWNER }));
  });

  it('27：deleting = false なら、オーナーでも削除できない', async () => {
    await assertFails(deleteDoc(doc(as(env, ALICE), 'events/e1/voids/v1')));
    await assertFails(deleteDoc(doc(as(env, OWNER), 'events/e1/voids/v1')));
  });

  it('deleting = true なら、オーナーは削除できる。メンバーはできない', async () => {
    await updateDoc(doc(as(env, OWNER), 'events/e1'), { deleting: true });
    await assertFails(deleteDoc(doc(as(env, ALICE), 'events/e1/voids/v1')));
    await assertSucceeds(deleteDoc(doc(as(env, OWNER), 'events/e1/voids/v1')));
  });
});
