// メニュー・カウンター・レジ締めのルール（testing.md §3：3〜6・48〜50）
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { ALICE, anon, as, BOB, CAROL, createEnv, DAY, OWNER, seed } from './helpers';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());

const menuItem = (patch: Record<string, unknown> = {}) => ({ name: 'たこ焼き', price: 500, order: 10, soldOut: false, ...patch });

const closing = (uid: string, patch: Record<string, unknown> = {}) => ({
  floatCash: 10000,
  expectedCash: 25000,
  actualCash: 24900,
  diff: -100,
  note: '',
  closedAt: serverTimestamp(),
  closedBy: uid,
  ...patch,
});

beforeEach(() =>
  seed(env, async (db) => {
    await setDoc(doc(db, 'events/e1/menu/m1'), menuItem());
    await setDoc(doc(db, 'events/e1/counters', DAY), { n: 5 });
    await setDoc(doc(db, 'events/e1/closings', DAY), { ...closing(ALICE), closedAt: new Date(0) });
  }),
);

const startDeleting = () => updateDoc(doc(as(env, OWNER), 'events/e1'), { deleting: true });

describe('読み取りの権限', () => {
  it('3・4・5：未ログイン・非メンバー・別のイベントのメンバーは、メニュー・カウンター・レジ締めを読めない', async () => {
    for (const db of [anon(env), as(env, BOB), as(env, CAROL)]) {
      await assertFails(getDocs(collection(db, 'events/e1/menu')));
      await assertFails(getDoc(doc(db, 'events/e1/counters', DAY)));
      await assertFails(getDocs(collection(db, 'events/e1/closings')));
    }
  });

  it('6：メンバーは、メニュー・カウンター・レジ締めを読める', async () => {
    const db = as(env, ALICE);
    await assertSucceeds(getDocs(collection(db, 'events/e1/menu')));
    await assertSucceeds(getDoc(doc(db, 'events/e1/counters', DAY)));
    await assertSucceeds(getDocs(collection(db, 'events/e1/closings')));
  });
});

describe('メニュー', () => {
  it('6：メンバーは、メニューを追加・更新・削除できる', async () => {
    const db = as(env, ALICE);
    await assertSucceeds(setDoc(doc(db, 'events/e1/menu/m2'), menuItem({ name: 'ラムネ', price: 200, order: 20 })));
    await assertSucceeds(updateDoc(doc(db, 'events/e1/menu/m1'), { soldOut: true, order: 15.5 }));
    await assertSucceeds(deleteDoc(doc(db, 'events/e1/menu/m1')));
  });

  it('調理の要否（cook）は、無くても（古い商品）、true・false でも通り、あとから変えられる（#52）', async () => {
    const db = as(env, ALICE);
    await assertSucceeds(setDoc(doc(db, 'events/e1/menu/m2'), menuItem({ cook: false })));
    await assertSucceeds(setDoc(doc(db, 'events/e1/menu/m3'), menuItem({ cook: true })));
    await assertSucceeds(updateDoc(doc(db, 'events/e1/menu/m1'), { cook: false })); // m1 は cook の無い古い形
    await assertSucceeds(updateDoc(doc(db, 'events/e1/menu/m1'), { cook: true }));
  });

  it('価格の境界：1円と100,000円は許可', async () => {
    const db = as(env, ALICE);
    await assertSucceeds(setDoc(doc(db, 'events/e1/menu/m2'), menuItem({ price: 1 })));
    await assertSucceeds(setDoc(doc(db, 'events/e1/menu/m3'), menuItem({ price: 100000, name: 'あ'.repeat(40) })));
  });

  it.each([
    ['価格が0', { price: 0 }],
    ['価格が100,001', { price: 100001 }],
    ['価格が小数', { price: 500.5 }],
    ['価格が文字列', { price: '500' }],
    ['名前が空', { name: '' }],
    ['名前が41文字', { name: 'あ'.repeat(41) }],
    ['order が文字列', { order: '10' }],
    ['soldOut が真偽値でない', { soldOut: 0 }],
    ['cook が真偽値でない', { cook: 'no' }],
    ['余計な項目', { memo: 'x' }],
  ])('49：%s は拒否', async (_label, patch) => {
    const db = as(env, ALICE);
    await assertFails(setDoc(doc(db, 'events/e1/menu/m2'), menuItem(patch)));
    await assertFails(updateDoc(doc(db, 'events/e1/menu/m1'), patch));
  });

  it('4・5：非メンバー・別のイベントのメンバーは、メニューを書けない', async () => {
    for (const uid of [BOB, CAROL]) {
      const db = as(env, uid);
      await assertFails(setDoc(doc(db, 'events/e1/menu/m2'), menuItem()));
      await assertFails(updateDoc(doc(db, 'events/e1/menu/m1'), { soldOut: true }));
      await assertFails(deleteDoc(doc(db, 'events/e1/menu/m1')));
    }
  });
});

describe('カウンター', () => {
  it('その日の最初は n = 1 で作れる。+1 の更新ができる（R9）', async () => {
    const db = as(env, ALICE);
    await assertSucceeds(setDoc(doc(db, 'events/e1/counters', '2026-08-02'), { n: 1 }));
    await assertSucceeds(setDoc(doc(db, 'events/e1/counters', DAY), { n: 6 }));
  });

  it('作成時に n が 1 でない、ID が日付の形式でないなら拒否', async () => {
    const db = as(env, ALICE);
    await assertFails(setDoc(doc(db, 'events/e1/counters', '2026-08-02'), { n: 2 }));
    await assertFails(setDoc(doc(db, 'events/e1/counters', '2026-08-02'), { n: 0 }));
    await assertFails(setDoc(doc(db, 'events/e1/counters', '20260802'), { n: 1 }));
  });

  it('48：カウンターを戻す・+2・同じ値・余計な項目は拒否（R9）', async () => {
    const db = as(env, ALICE);
    for (const data of [{ n: 4 }, { n: 7 }, { n: 5 }, { n: 6, x: 1 }]) {
      await assertFails(setDoc(doc(db, 'events/e1/counters', DAY), data));
    }
  });

  it('48：deleting = false なら、オーナーでも削除できない', async () => {
    await assertFails(deleteDoc(doc(as(env, ALICE), 'events/e1/counters', DAY)));
    await assertFails(deleteDoc(doc(as(env, OWNER), 'events/e1/counters', DAY)));
  });

  it('deleting = true なら、オーナーは削除できる。メンバーはできない', async () => {
    await startDeleting();
    await assertFails(deleteDoc(doc(as(env, ALICE), 'events/e1/counters', DAY)));
    await assertSucceeds(deleteDoc(doc(as(env, OWNER), 'events/e1/counters', DAY)));
  });

  it('4・5：非メンバー・別のイベントのメンバーは、カウンターを進められない', async () => {
    await assertFails(setDoc(doc(as(env, BOB), 'events/e1/counters', DAY), { n: 6 }));
    await assertFails(setDoc(doc(as(env, CAROL), 'events/e1/counters', DAY), { n: 6 }));
  });
});

describe('レジ締め', () => {
  it('6：メンバーは、レジ締めを保存・やり直し（上書き）できる', async () => {
    const db = as(env, ALICE);
    await assertSucceeds(setDoc(doc(db, 'events/e1/closings', '2026-08-02'), closing(ALICE)));
    await assertSucceeds(setDoc(doc(db, 'events/e1/closings', DAY), closing(ALICE, { actualCash: 25000, diff: 0, note: 'あ'.repeat(200) })));
  });

  it.each([
    ['diff が actualCash - expectedCash と違う', { diff: 100 }],
    ['closedBy が自分の uid でない', { closedBy: OWNER }],
    ['closedAt がクライアントの時刻', { closedAt: new Date() }],
    ['メモが201文字', { note: 'あ'.repeat(201) }],
    ['数えた現金が負', { actualCash: -1, diff: -25001 }],
    ['準備金が負', { floatCash: -1 }],
    ['金額が小数', { actualCash: 24900.5, diff: -99.5 }],
    ['余計な項目', { closedByEmail: 'alice@example.com' }],
  ])('50：%s は拒否', async (_label, patch) => {
    await assertFails(setDoc(doc(as(env, ALICE), 'events/e1/closings', DAY), closing(ALICE, patch)));
  });

  it('ID が日付の形式でないなら拒否', async () => {
    await assertFails(setDoc(doc(as(env, ALICE), 'events/e1/closings', 'today'), closing(ALICE)));
  });

  it('deleting = false なら削除できない。true なら、オーナーだけが削除できる', async () => {
    await assertFails(deleteDoc(doc(as(env, OWNER), 'events/e1/closings', DAY)));
    await startDeleting();
    await assertFails(deleteDoc(doc(as(env, ALICE), 'events/e1/closings', DAY)));
    await assertSucceeds(deleteDoc(doc(as(env, OWNER), 'events/e1/closings', DAY)));
  });

  it('4・5：非メンバー・別のイベントのメンバーは、レジ締めを書けない', async () => {
    await assertFails(setDoc(doc(as(env, BOB), 'events/e1/closings', DAY), closing(BOB)));
    await assertFails(setDoc(doc(as(env, CAROL), 'events/e1/closings', DAY), closing(CAROL)));
  });
});
