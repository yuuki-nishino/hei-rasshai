// スタッフ用の Firebase 初期化（data-access.md §1、DESIGN.md §6・§8）
// - Auth：browserLocalPersistence（ログインを保持する）
// - Firestore：永続キャッシュ（IndexedDB）＋複数タブ。オフラインでも読み書きできる
import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  initializeAuth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { emulatorHost, emulatorPorts, firebaseOptions, useEmulator } from './config';

export const app = initializeApp(firebaseOptions());

export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
});

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (useEmulator) {
  connectAuthEmulator(auth, `http://${emulatorHost}:${emulatorPorts.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, emulatorHost, emulatorPorts.firestore);
}
