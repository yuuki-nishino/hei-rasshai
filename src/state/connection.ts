// 接続状態（data-access.md §6.1）。navigator.onLine と、Shell の購読（watchActiveOrders）の fromCache から推定する
import { computed, signal } from '@preact/signals';
import { connectionStatus, OFFLINE_AFTER_MS, statusBarView } from '../lib/domain/connection';
import { reconnectNow } from '../lib/data/online';
import { pendingUnknown, pendingWrites } from '../lib/data/writes';
import { browserOnline } from './online';

const fromCacheSince = signal<number | null>(null);
/** fromCache が続いた時間の判定を、スナップショットが来なくても進めるための時計 */
const clock = signal(Date.now());
let timer: ReturnType<typeof setTimeout> | undefined;

export const connection = computed(() => {
  void clock.value; // タイマーで、判定をやり直すための依存
  return connectionStatus({ browserOnline: browserOnline.value, fromCacheSince: fromCacheSince.value, now: Date.now() });
});

export const statusView = computed(() =>
  statusBarView({ connection: connection.value, pendingWrites: pendingWrites.value, pendingUnknown: pendingUnknown.value }),
);

/** Shell の購読の最新スナップショットを知らせる。fromCache が続き始めた時刻から、10秒で、オフラインに変わる */
export function reportSnapshot(fromCache: boolean): void {
  if (!fromCache) return resetConnection();
  if (fromCacheSince.value !== null) return; // すでに続いている
  startFromCache();
}

function startFromCache(): void {
  clearTimeout(timer);
  fromCacheSince.value = Date.now();
  timer = setTimeout(() => (clock.value = Date.now()), OFFLINE_AFTER_MS + 50); // タイマーの誤差で、10秒に届かないことがないように少し足す
}

// ブラウザの通信が戻ったら、すぐ再接続させ、fromCache の数え直しを始める（戻りの表示が遅れないように）。まだつながらなければ、10秒でまたオフラインになる
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (fromCacheSince.value === null) return; // 購読していない、または、サーバーに届いている
    startFromCache();
    void reconnectNow();
  });
}

/** 購読を止めたとき・サーバーに届いたとき */
export function resetConnection(): void {
  clearTimeout(timer);
  fromCacheSince.value = null;
}
