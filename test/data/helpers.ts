// データアクセスの結合テストの共通部分（testing.md §4）。npm run test:data（Firestore Emulator 上）で動く
// - lib/data は、lib/firebase/staff の db を使う。テストでは、vi.mock で、利用者ごとの db に差し替える（setUser）
// - 利用者の db は、modular SDK を Emulator につなぎ、mockUserToken でログイン済みにする（ルールが効く）
// - キャッシュは、メモリ＋LRU（取得した文書を、オフラインになっても残す。本番の永続キャッシュの代わり）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  memoryLruGarbageCollector,
  terminate,
  type Firestore,
} from 'firebase/firestore';

export const projectId = 'demo-maido-ookini';

export function createEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync(resolve(import.meta.dirname, '../../firestore.rules'), 'utf8') },
  });
}

/** vi.mock の差し替え先（lib/firebase/staff の db）。setUser で切り替える */
export const holder: { db: Firestore | null } = { db: null };

const opened: { app: FirebaseApp; db: Firestore }[] = [];
let seq = 0;

export const emailOf = (uid: string) => `${uid}@example.com`;

/** uid でログインした利用者の db を作り、lib/data の db をそれに切り替える */
export function setUser(uid: string): Firestore {
  const app = initializeApp({ projectId, apiKey: 'demo' }, `user-${uid}-${++seq}`);
  const db = initializeFirestore(app, { localCache: memoryLocalCache({ garbageCollector: memoryLruGarbageCollector() }) });
  connectFirestoreEmulator(db, '127.0.0.1', 8080, {
    mockUserToken: { sub: uid, user_id: uid, email: emailOf(uid), email_verified: true },
  });
  opened.push({ app, db });
  holder.db = db;
  return db;
}

export async function closeUsers(): Promise<void> {
  for (const { app, db } of opened.splice(0)) {
    await terminate(db);
    await deleteApp(app);
  }
  holder.db = null;
}

export const authUser = (uid: string, displayName: string | null = uid) => ({ uid, email: emailOf(uid), displayName });

/** 条件を満たすまで待つ（購読の結果が届くのを待つ） */
export async function waitFor<T>(get: () => T | undefined, timeoutMs = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: 時間切れ');
    await new Promise((r) => setTimeout(r, 50));
  }
}
