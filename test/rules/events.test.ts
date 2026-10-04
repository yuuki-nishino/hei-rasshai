// イベントのルール（testing.md §3：3〜5・28〜33）
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { ALICE, anon, as, BOB, CAROL, createEnv, CREATOR, emailOf, eventData, OWNER, seed } from './helpers';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

const newEvent = (ownerUid: string, patch: Record<string, unknown> = {}) =>
  eventData(ownerUid, { createdAt: serverTimestamp(), ...patch });

const ownerMember = (uid: string) => ({
  uid,
  role: 'owner',
  displayName: uid,
  email: emailOf(uid),
  joinedAt: serverTimestamp(),
});

describe('イベントの読み取り', () => {
  it('3：未ログインは、イベントを読めない', async () => {
    await assertFails(getDoc(doc(anon(env), 'events/e1')));
  });

  it('4：非メンバーは、イベントを読み書きできない', async () => {
    const db = as(env, BOB);
    await assertFails(getDoc(doc(db, 'events/e1')));
    await assertFails(updateDoc(doc(db, 'events/e1'), { name: '乗っ取り' }));
  });

  it('5：別のイベントのメンバーは、このイベントを読み書きできない', async () => {
    const db = as(env, CAROL);
    await assertFails(getDoc(doc(db, 'events/e1')));
    await assertFails(updateDoc(doc(db, 'events/e1'), { name: '乗っ取り' }));
  });

  it('メンバー・オーナーは、イベントを読める', async () => {
    await assertSucceeds(getDoc(doc(as(env, ALICE), 'events/e1')));
    await assertSucceeds(getDoc(doc(as(env, OWNER), 'events/e1')));
  });
});

describe('イベントの作成', () => {
  function createBatch(uid: string, event = newEvent(uid), member = ownerMember(uid), token = {}) {
    const db = as(env, uid, token);
    const batch = writeBatch(db);
    batch.set(doc(db, 'events/new'), event);
    batch.set(doc(db, 'events/new/members', uid), member);
    return batch.commit();
  }

  it('29：creators 登録済みのユーザーは、イベント＋オーナーの members を1バッチで作れる（R2）', async () => {
    await assertSucceeds(createBatch(CREATOR));
  });

  it('29：トークンのメールに大文字が含まれても、小文字にして creators と照合する', async () => {
    await assertSucceeds(createBatch(CREATOR, undefined, { ...ownerMember(CREATOR) }, { email: 'Creator@Example.com' }));
  });

  it('28：creators 未登録のユーザーは、イベントを作れない', async () => {
    await assertFails(createBatch(BOB));
  });

  it('28：メールが未確認（email_verified = false）なら、作れない', async () => {
    await assertFails(createBatch(CREATOR, undefined, undefined, { email_verified: false }));
  });

  it('30：他人の uid を ownerUid にしたイベントは、作れない', async () => {
    const db = as(env, CREATOR);
    await assertFails(setDoc(doc(db, 'events/new'), newEvent(BOB)));
  });

  it('30：deleting = true では、作れない', async () => {
    await assertFails(createBatch(CREATOR, newEvent(CREATOR, { deleting: true })));
  });

  it('作成時の createdAt がクライアントの時刻なら、拒否（R11）', async () => {
    await assertFails(createBatch(CREATOR, newEvent(CREATOR, { createdAt: new Date() })));
  });

  it('イベントだけでなく、オーナーの members も、イベントと同じバッチでないと作れない（R2）', async () => {
    // イベントが無い状態で、オーナーの members だけを作る
    const db = as(env, CREATOR);
    await assertFails(setDoc(doc(db, 'events/none/members', CREATOR), ownerMember(CREATOR)));
  });
});

describe('イベントの更新', () => {
  it('メンバーは、名前・日付・準備金を更新できる', async () => {
    await assertSucceeds(
      updateDoc(doc(as(env, ALICE), 'events/e1'), { name: '秋祭り', startDate: '2026-09-01', endDate: '2026-09-01', floatCash: 0 }),
    );
  });

  it.each([
    ['ownerUid の変更', { ownerUid: ALICE }],
    ['名前が61文字', { name: 'あ'.repeat(61) }],
    ['名前が空', { name: '' }],
    ['startDate > endDate（R10）', { startDate: '2026-08-03' }],
    ['日付の形式が違う', { endDate: '2026/08/02' }],
    ['準備金が負', { floatCash: -1 }],
    ['準備金が小数', { floatCash: 1.5 }],
    ['余計な項目', { memo: 'x' }],
    ['createdAt の変更', { createdAt: new Date() }],
  ])('31：%s は拒否', async (_label, patch) => {
    await assertFails(updateDoc(doc(as(env, OWNER), 'events/e1'), patch));
  });

  it('32：メンバーは、deleting を変更できない', async () => {
    await assertFails(updateDoc(doc(as(env, ALICE), 'events/e1'), { deleting: true }));
  });

  it('32：オーナーは、deleting を変更できる', async () => {
    await assertSucceeds(updateDoc(doc(as(env, OWNER), 'events/e1'), { deleting: true }));
  });
});

describe('イベントの削除', () => {
  it('33：deleting = false なら、オーナーでも削除できない', async () => {
    await assertFails(deleteDoc(doc(as(env, OWNER), 'events/e1')));
  });

  it('33：deleting = true なら、オーナーは削除できる', async () => {
    await updateDoc(doc(as(env, OWNER), 'events/e1'), { deleting: true });
    await assertSucceeds(deleteDoc(doc(as(env, OWNER), 'events/e1')));
  });

  it('33：deleting = true でも、メンバーは削除できない', async () => {
    await updateDoc(doc(as(env, OWNER), 'events/e1'), { deleting: true });
    await assertFails(deleteDoc(doc(as(env, ALICE), 'events/e1')));
  });
});
