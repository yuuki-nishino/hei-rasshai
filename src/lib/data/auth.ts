// 認証（data-access.md §3.1、DESIGN.md §6）
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as fbSignOut } from 'firebase/auth';
import { auth } from '../firebase/staff';
import { classifyAuthError } from './errors';

// UI に Firebase の User 型を漏らさない（data-access.md §1）
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  return onAuthStateChanged(auth, (u) => cb(u && { uid: u.uid, email: u.email, displayName: u.displayName }));
}

// Googleログイン（ポップアップ。★U1、DESIGN.md §6）
// 本人がポップアップを閉じたときは 'cancelled' を返す。それ以外の失敗は AppError を投げる
export async function signInWithGoogle(): Promise<'signed-in' | 'cancelled'> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' }); // 別のアカウントを選べるように
  try {
    await signInWithPopup(auth, provider);
    return 'signed-in';
  } catch (e) {
    const result = classifyAuthError(e);
    if (result === 'cancelled') return result;
    throw result;
  }
}

// ログアウト（Auth だけ）。未送信の確認と、端末のキャッシュの消去は state/logout.ts（data-access.md §8）
export function signOut(): Promise<void> {
  return fbSignOut(auth);
}
