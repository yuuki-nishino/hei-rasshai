// その他のルール（testing.md §3：51・52）
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { ALICE, anon, as, CREATOR, createEnv, emailOf, OWNER, seed } from './helpers';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

describe('未知のサブコレクション', () => {
  it('51：メンバー・オーナーでも、events/{e}/foo/x は読み書きできない（R4）', async () => {
    for (const uid of [ALICE, OWNER]) {
      const db = as(env, uid);
      await assertFails(getDoc(doc(db, 'events/e1/foo/x')));
      await assertFails(getDocs(collection(db, 'events/e1/foo')));
      await assertFails(setDoc(doc(db, 'events/e1/foo/x'), { a: 1 }));
    }
  });

  it('51：members の下の、さらに下のサブコレクションも拒否（R4）', async () => {
    await assertFails(setDoc(doc(as(env, ALICE), 'events/e1/members', ALICE, 'extra/x'), { a: 1 }));
  });

  it('トップレベルの未知のコレクションも拒否', async () => {
    await assertFails(setDoc(doc(as(env, ALICE), 'foo/x'), { a: 1 }));
  });
});

describe('creators', () => {
  it('52：登録済みの本人も含め、誰も creators を読み書きできない', async () => {
    for (const db of [anon(env), as(env, ALICE), as(env, CREATOR)]) {
      await assertFails(getDoc(doc(db, 'creators', emailOf(CREATOR))));
      await assertFails(getDocs(collection(db, 'creators')));
      await assertFails(setDoc(doc(db, 'creators', emailOf(ALICE)), {}));
    }
  });
});
