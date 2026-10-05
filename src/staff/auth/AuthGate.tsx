// 未ログインなら、ログイン画面を出す（screens.md §1.2）
import type { ComponentChildren } from 'preact';
import { Loading } from '../../components/Feedback';
import { currentUser } from '../../state/auth';
import { LoginPage } from './LoginPage';

export function AuthGate({ children }: { children: ComponentChildren }) {
  const user = currentUser.value;
  if (user === undefined) return <Loading />; // 保存済みのログインを確かめている間
  if (user === null) return <LoginPage />;
  return <>{children}</>;
}
