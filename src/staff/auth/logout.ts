// ログアウト。現在のイベントの選択も消す（同じ端末で、別のアカウントがログインしたときに、前の人のイベントを開かないように）
import { signOut } from '../../lib/data/auth';
import { selectEvent } from '../../state/event';

export async function logout(): Promise<void> {
  selectEvent(null);
  await signOut();
}
