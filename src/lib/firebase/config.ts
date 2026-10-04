// Firebase の設定値（.env.* の VITE_FIREBASE_*）。DESIGN.md §5
// スタッフ用・お客様用の両方から使うため、Firebase SDK を import しない。
import type { FirebaseOptions } from 'firebase/app';

export const useEmulator = import.meta.env.VITE_USE_EMULATOR === 'true';

export const emulatorHost = '127.0.0.1';
export const emulatorPorts = { auth: 9099, firestore: 8080 } as const; // firebase.json の emulators と合わせる

function required(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (!value) throw new Error(`${name} が設定されていません（.env.example を参照）`);
  return value;
}

export function firebaseOptions(): FirebaseOptions {
  return {
    apiKey: required('VITE_FIREBASE_API_KEY'),
    authDomain: required('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: required('VITE_FIREBASE_PROJECT_ID'),
    appId: required('VITE_FIREBASE_APP_ID'),
  };
}
