// 未ログインなら、ログイン画面を出す（screens.md §1.2）
import type { ComponentChildren } from 'preact';
import { currentUser } from '../../state/auth';
import { LoginPage } from './LoginPage';

export function AuthGate({ children }: { children: ComponentChildren }) {
  const user = currentUser.value;
  if (user === undefined) return <p aria-busy="true">読み込み中…</p>; // 保存済みのログインを確かめている間
  if (user === null) return <LoginPage />;
  return <>{children}</>;
}
