// データアクセスの結合テストの共通部分（testing.md §4）。npm run test:data（Firestore Emulator 上）で動く
// - lib/data は、lib/firebase/staff の db を使う。テストでは、vi.mock で、利用者ごとの db に差し替える（setUser）
// - 利用者の db は、modular SDK を Emulator につなぎ、mockUserToken でログイン済みにする（ルールが効く）
// - キャッシュは、メモリ＋LRU（取得した文書を、オフラインになっても残す。本番の永続キャッシュの代わり）
import { AsyncLocalStorage } from 'node:async_hooks';
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

// 並行に走らせる処理ごとの db（asUser の中で使う）。やり直しなどで、後から db を読み直しても、その処理の利用者のままになる
const scoped = new AsyncLocalStorage<Firestore>();
let current: Firestore | null = null;

/** vi.mock の差し替え先（lib/firebase/staff の db）。setUser で切り替える。asUser の中では、その利用者の db */
export const holder = {
  get db(): Firestore | null {
    return scoped.getStore() ?? current;
  },
  set db(db: Firestore | null) {
    current = db;
  },
};

/** fn の中（と、その中の非同期の続き）では、lib/data が db を使う（2台から並行に操作するテスト用） */
export function asUser<T>(db: Firestore, fn: () => Promise<T>): Promise<T> {
  return scoped.run(db, fn);
}

const opened: { app: FirebaseApp; db: Firestore }[] = [];
let seq = 0;

export const emailOf = (uid: string) => `${uid}@example.com`;

/** uid でログインした利用者の db を作り、lib/data の db をそれに切り替える */
export function setUser(uid: string): Firestore {
  return openUser(uid, 8080);
}

/**
 * つながらない宛先につないだ利用者（本当のオフラインの代わり）。
 * disableNetwork は、トランザクション（runTransaction）の通信を止めない（別の通り道で送られる）ため、確定のオフラインの確認には、こちらを使う（#13）
 */
export function setUnreachableUser(uid: string): Firestore {
  return openUser(uid, 9); // 9 番（discard）には、Emulator がいない
}

function openUser(uid: string, port: number): Firestore {
  const app = initializeApp({ projectId, apiKey: 'demo' }, `user-${uid}-${++seq}`);
  const db = initializeFirestore(app, { localCache: memoryLocalCache({ garbageCollector: memoryLruGarbageCollector() }) });
  connectFirestoreEmulator(db, '127.0.0.1', port, {
    mockUserToken: { sub: uid, user_id: uid, email: emailOf(uid), email_verified: true },
  });
  opened.push({ app, db });
  holder.db = db;
  return db;
}

/**
 * ログインしていない利用者（お客様）の db（メモリキャッシュのみ。お客様用の初期化と同じ）。
 * lib/data/customerOrder は、lib/firebase/customer の db を使うため、そちらの差し替え先（customerHolder）に入れる
 */
export const customerHolder: { db: Firestore | null } = { db: null };

export function setCustomer(): Firestore {
  const app = initializeApp({ projectId, apiKey: 'demo' }, `customer-${++seq}`);
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  connectFirestoreEmulator(db, '127.0.0.1', 8080); // mockUserToken なし＝未ログイン
  opened.push({ app, db });
  customerHolder.db = db;
  return db;
}

export async function closeUsers(): Promise<void> {
  for (const { app, db } of opened.splice(0)) {
    await terminate(db);
    await deleteApp(app);
  }
  holder.db = null;
  customerHolder.db = null;
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
