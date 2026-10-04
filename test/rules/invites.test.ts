// 招待のルール（testing.md §3：41〜43）
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { ALICE, anon, as, BOB, CAROL, createEnv, emailOf, hoursAgo, OWNER, seed } from './helpers';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() =>
  seed(env, (db) => setDoc(doc(db, 'events/e1/invites', emailOf(BOB)), { createdBy: OWNER, createdAt: hoursAgo(1) })),
);

const inviteData = (uid = OWNER, patch: Record<string, unknown> = {}) => ({
  createdBy: uid,
  createdAt: serverTimestamp(),
  ...patch,
});

describe('招待（オーナー）', () => {
  it('42：オーナーは、招待を作成できる', async () => {
    await assertSucceeds(setDoc(doc(as(env, OWNER), 'events/e1/invites', emailOf('dave')), inviteData()));
  });

  it('42：オーナーは、招待を再発行（createdAt の更新）できる', async () => {
    await assertSucceeds(updateDoc(doc(as(env, OWNER), 'events/e1/invites', emailOf(BOB)), { createdAt: serverTimestamp() }));
  });

  it('42：オーナーは、招待を削除（取り消し）できる', async () => {
    await assertSucceeds(deleteDoc(doc(as(env, OWNER), 'events/e1/invites', emailOf(BOB))));
  });

  it('オーナーは、招待を読める', async () => {
    await assertSucceeds(getDocs(collection(as(env, OWNER), 'events/e1/invites')));
  });

  it('R5：記号を含むメールアドレス（. + サブドメイン）を、招待のIDに使える', async () => {
    await assertSucceeds(setDoc(doc(as(env, OWNER), 'events/e1/invites', 'dave.smith+fes@mail.example.co.jp'), inviteData()));
  });

  it.each([
    ['大文字を含むID', 'Dave@example.com'],
    ['@ が無いID', 'dave.example.com'],
    ['@ が2つあるID', 'dave@x@example.com'],
  ])('R5：%s は拒否', async (_label, id) => {
    await assertFails(setDoc(doc(as(env, OWNER), 'events/e1/invites', id), inviteData()));
  });

  it('43：createdAt がクライアントの時刻なら拒否（R11）', async () => {
    await assertFails(setDoc(doc(as(env, OWNER), 'events/e1/invites', emailOf('dave')), inviteData(OWNER, { createdAt: new Date() })));
  });

  it('43：余計な項目（期限など）は拒否', async () => {
    await assertFails(
      setDoc(doc(as(env, OWNER), 'events/e1/invites', emailOf('dave')), inviteData(OWNER, { expiresAt: serverTimestamp() })),
    );
  });

  it('createdBy が自分の uid でなければ拒否', async () => {
    await assertFails(setDoc(doc(as(env, OWNER), 'events/e1/invites', emailOf('dave')), inviteData(ALICE)));
  });
});

describe('招待（オーナー以外）', () => {
  it('41：メンバーは、招待を作成・読み取りできない', async () => {
    const db = as(env, ALICE);
    await assertFails(setDoc(doc(db, 'events/e1/invites', emailOf('dave')), inviteData(ALICE)));
    await assertFails(getDoc(doc(db, 'events/e1/invites', emailOf(BOB))));
    await assertFails(getDocs(collection(db, 'events/e1/invites')));
  });

  it('招待された本人も、招待を読めない（招待の有無は、参加の可否で分かる）', async () => {
    await assertFails(getDoc(doc(as(env, BOB), 'events/e1/invites', emailOf(BOB))));
  });

  it('3・5：未ログイン・別のイベントのオーナーは、招待を読み書きできない', async () => {
    await assertFails(getDoc(doc(anon(env), 'events/e1/invites', emailOf(BOB))));
    await assertFails(getDoc(doc(as(env, CAROL), 'events/e1/invites', emailOf(BOB))));
    await assertFails(setDoc(doc(as(env, CAROL), 'events/e1/invites', emailOf('dave')), inviteData(CAROL)));
  });

  it('招待された本人は、自分宛ての招待を削除できる', async () => {
    await assertSucceeds(deleteDoc(doc(as(env, BOB), 'events/e1/invites', emailOf(BOB))));
  });

  it('他人宛ての招待は、削除できない（メンバーでも）', async () => {
    await assertFails(deleteDoc(doc(as(env, ALICE), 'events/e1/invites', emailOf(BOB))));
    await assertFails(deleteDoc(doc(as(env, CAROL), 'events/e1/invites', emailOf(BOB))));
  });

  it('メールが未確認なら、自分宛ての招待でも削除できない', async () => {
    await assertFails(deleteDoc(doc(as(env, BOB, { email_verified: false }), 'events/e1/invites', emailOf(BOB))));
  });
});
