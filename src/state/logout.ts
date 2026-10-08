// ログアウト（data-access.md §8）。未送信があれば、警告して確認を取る。
// ログアウトしたら、現在のイベントの選択と、端末のキャッシュを消して、再読み込みする
import { signal } from '@preact/signals';
import { signOut } from '../lib/data/auth';
import { hasPendingWrites } from '../lib/data/cache';
import { flushAllHolds } from './hold';
import { clearCacheForLogout } from './cacheClear';
import { selectEvent } from './event';

/** 未送信があり、ログアウトしてよいかの確認を待っている */
export const logoutConfirm = signal(false);

export async function requestLogout(): Promise<void> {
  flushAllHolds(); // 保留中の「完成」「渡した」は、先に書く（未送信として数えられる）
  if (await hasPendingWrites()) {
    logoutConfirm.value = true;
    return;
  }
  await logoutNow();
}

export async function logoutNow(): Promise<void> {
  logoutConfirm.value = false;
  selectEvent(null); // 同じ端末で、別のアカウントが、前の人のイベントを開かないように
  await signOut();
  await clearCacheForLogout(); // 再読み込みする
}
