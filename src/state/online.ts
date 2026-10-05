// ブラウザの通信状態（navigator.onLine）。イベント一覧と /join では、これだけで判定する（data-access.md §3.9）
// Shell の中の接続状態（Firestore の購読も見る）は、#19 で足す
import { signal } from '@preact/signals';

export const browserOnline = signal(typeof navigator === 'undefined' ? true : navigator.onLine);

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => (browserOnline.value = true));
  window.addEventListener('offline', () => (browserOnline.value = false));
}
