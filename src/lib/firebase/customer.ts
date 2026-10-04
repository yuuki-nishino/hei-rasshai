// お客様用の Firebase 初期化（data-access.md §1、DESIGN.md §4・§8）
// Firestore のみ・メモリキャッシュ。firebase/auth と staff.ts を import しない（バンドルを軽く保つ）
import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { emulatorHost, emulatorPorts, firebaseOptions, useEmulator } from './config';

export const app = initializeApp(firebaseOptions());

export const db = initializeFirestore(app, { localCache: memoryLocalCache() });

if (useEmulator) {
  connectFirestoreEmulator(db, emulatorHost, emulatorPorts.firestore);
}
