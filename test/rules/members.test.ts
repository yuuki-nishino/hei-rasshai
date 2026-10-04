// メンバー・参加のルール（testing.md §3：3〜5・34〜40・44〜47）
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { ALICE, anon, as, BOB, CAROL, createEnv, emailOf, hoursAgo, OWNER, seed } from './helpers';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());

// BOB 宛ての招待を置く（createdAt を変えて、期限を試す）
function seedInvite(email = emailOf(BOB), createdAt: Timestamp = hoursAgo(1)) {
  return seed(env, (db) => setDoc(doc(db, 'events/e1/invites', email), { createdBy: OWNER, createdAt }));
}

const joinData = (uid: string, patch: Record<string, unknown> = {}) => ({
  uid,
  role: 'member',
  displayName: uid,
  email: emailOf(uid),
  joinedAt: serverTimestamp(),
  ...patch,
});

// 参加のバッチ：members を作り、招待を削除する（security-rules.md §4）
function join(uid: string, opts: { data?: Record<string, unknown>; inviteEmail?: string; deleteInvite?: boolean; token?: object } = {}) {
  const db = as(env, uid, opts.token);
  const batch = writeBatch(db);
  batch.set(doc(db, 'events/e1/members', uid), opts.data ?? joinData(uid));
  if (opts.deleteInvite ?? true) batch.delete(doc(db, 'events/e1/invites', opts.inviteEmail ?? emailOf(uid)));
  return batch.commit();
}

describe('メンバーの読み取り', () => {
  beforeEach(() => seed(env));

  it('3：未ログインは、メンバーを読めない', async () => {
    await assertFails(getDocs(collection(anon(env), 'events/e1/members')));
  });

  it('4：非メンバーは、メンバーの一覧・1件を読めない', async () => {
    await assertFails(getDocs(collection(as(env, BOB), 'events/e1/members')));
    await assertFails(getDoc(doc(as(env, BOB), 'events/e1/members', OWNER)));
  });

  it('5：別のイベントのメンバーは、このイベントのメンバーを読めない', async () => {
    await assertFails(getDocs(collection(as(env, CAROL), 'events/e1/members')));
  });

  it('メンバーは、メンバーの一覧を読める', async () => {
    await assertSucceeds(getDocs(collection(as(env, ALICE), 'events/e1/members')));
  });

  it('非メンバーが、自分の members（存在しない）を get するのは拒否（joinEvent は permission-denied を「メンバーではない」と扱う）', async () => {
    await assertFails(getDoc(doc(as(env, BOB), 'events/e1/members', BOB)));
  });
});

describe('参加（招待 → メンバー）', () => {
  it('34：自分宛ての有効な招待で、members を作り、同じバッチで招待を削除できる（R1・R5）', async () => {
    await seedInvite();
    await assertSucceeds(join(BOB));
  });

  it('34：参加した後は、同じ招待を使えない（招待が消えている）', async () => {
    await seedInvite();
    await join(BOB);
    await deleteDoc(doc(as(env, BOB), 'events/e1/members', BOB)); // 抜ける
    await assertFails(join(BOB));
  });

  it('34：期限の直前（発行から23時間）なら、参加できる（R10）', async () => {
    await seedInvite(emailOf(BOB), hoursAgo(23));
    await assertSucceeds(join(BOB));
  });

  it('35：招待を削除せずに members を作るのは拒否（R1）', async () => {
    await seedInvite();
    await assertFails(join(BOB, { deleteInvite: false }));
  });

  it('36：期限切れ（発行から25時間）の招待では、参加できない（R10）', async () => {
    await seedInvite(emailOf(BOB), hoursAgo(25));
    await assertFails(join(BOB));
  });

  it('37：別のメールアドレス宛ての招待では、参加できない', async () => {
    await seedInvite(emailOf('someone'));
    await assertFails(join(BOB, { inviteEmail: emailOf('someone') }));
  });

  it('37：招待がないのに、参加できない', async () => {
    await seed(env);
    await assertFails(join(BOB, { deleteInvite: false }));
  });

  it('メールが未確認（email_verified = false）なら、参加できない', async () => {
    await seedInvite();
    await assertFails(join(BOB, { token: { email_verified: false } }));
  });

  it('トークンのメールに大文字が含まれても、小文字の招待IDと照合する（R5）', async () => {
    await seedInvite();
    await assertSucceeds(join(BOB, { token: { email: 'Bob@Example.COM' } }));
  });

  it('38：email を偽った members は拒否', async () => {
    await seedInvite();
    await assertFails(join(BOB, { data: joinData(BOB, { email: emailOf(ALICE) }) }));
  });

  it('38：joinedAt がクライアントの時刻なら拒否（R11）', async () => {
    await seedInvite();
    await assertFails(join(BOB, { data: joinData(BOB, { joinedAt: new Date() }) }));
  });

  it('displayName が61文字なら拒否、余計な項目も拒否', async () => {
    await seedInvite();
    await assertFails(join(BOB, { data: joinData(BOB, { displayName: 'あ'.repeat(61) }) }));
    await assertFails(join(BOB, { data: joinData(BOB, { note: 'x' }) }));
  });

  it('他人の uid の members は作れない', async () => {
    await seedInvite();
    const db = as(env, BOB);
    const batch = writeBatch(db);
    batch.set(doc(db, 'events/e1/members', 'mallory'), joinData('mallory', { email: emailOf(BOB) }));
    batch.delete(doc(db, 'events/e1/invites', emailOf(BOB)));
    await assertFails(batch.commit());
  });

  it('39：自分を role: owner にして参加するのは拒否（ownerUid でないイベント）', async () => {
    await seedInvite();
    await assertFails(join(BOB, { data: joinData(BOB, { role: 'owner' }) }));
  });

  it('40：メンバーは、自分の role を owner に変えられない（members の更新は不可）', async () => {
    await seed(env);
    await assertFails(updateDoc(doc(as(env, ALICE), 'events/e1/members', ALICE), { role: 'owner' }));
  });
});

describe('メンバーの削除', () => {
  beforeEach(() => seed(env));

  it('44：オーナーは、他のメンバーを削除できる', async () => {
    await assertSucceeds(deleteDoc(doc(as(env, OWNER), 'events/e1/members', ALICE)));
  });

  it('45：メンバーは、自分の members を削除できる（抜ける）', async () => {
    await assertSucceeds(deleteDoc(doc(as(env, ALICE), 'events/e1/members', ALICE)));
  });

  it('45：メンバーは、他人の members を削除できない', async () => {
    await assertFails(deleteDoc(doc(as(env, ALICE), 'events/e1/members', OWNER)));
  });

  it('非メンバー・別のイベントのオーナーは、members を削除できない', async () => {
    await assertFails(deleteDoc(doc(as(env, BOB), 'events/e1/members', ALICE)));
    await assertFails(deleteDoc(doc(as(env, CAROL), 'events/e1/members', ALICE)));
  });

  it('46：オーナーは、イベントがある間、自分の members を削除できない', async () => {
    await assertFails(deleteDoc(doc(as(env, OWNER), 'events/e1/members', OWNER)));
  });

  it('46：イベントを削除した後なら、オーナーは自分の members を削除できる', async () => {
    const db = as(env, OWNER);
    await updateDoc(doc(db, 'events/e1'), { deleting: true });
    await deleteDoc(doc(db, 'events/e1'));
    await assertSucceeds(deleteDoc(doc(db, 'events/e1/members', OWNER)));
  });
});

describe('自分のイベント一覧（コレクショングループ）', () => {
  beforeEach(() => seed(env));

  it('47：自分の uid で members を list できる（R3）', async () => {
    const db = as(env, ALICE);
    await assertSucceeds(getDocs(query(collectionGroup(db, 'members'), where('uid', '==', ALICE))));
  });

  it('47：他人の uid では list できない（R3）', async () => {
    const db = as(env, ALICE);
    await assertFails(getDocs(query(collectionGroup(db, 'members'), where('uid', '==', OWNER))));
  });

  it('47：where の無い list はできない（R3）', async () => {
    await assertFails(getDocs(collectionGroup(as(env, ALICE), 'members')));
  });

  it('R3：コレクショングループのルールは、個別のイベントの members の list にも効く（非メンバーでも、自分の uid の条件なら許可。結果は空で、情報は漏れない）', async () => {
    await assertSucceeds(getDocs(query(collection(as(env, BOB), 'events/e1/members'), where('uid', '==', BOB))));
    await assertFails(getDocs(query(collection(as(env, BOB), 'events/e1/members'), where('uid', '==', ALICE))));
  });

  it('未ログインは list できない', async () => {
    await assertFails(getDocs(query(collectionGroup(anon(env), 'members'), where('uid', '==', ALICE))));
  });
});
