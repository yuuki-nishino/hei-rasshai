// 接続状態の推定と、ヘッダー（StatusBar）の表示の判定（data-access.md §6）

/** fromCache が、この時間（ms）以上続いたら、オフラインとみなす（★N1。実機で確かめる） */
export const OFFLINE_AFTER_MS = 10_000;

export type ConnectionState = 'online' | 'offline';

export interface ConnectionInput {
  /** navigator.onLine */
  browserOnline: boolean;
  /** Shell の購読の最新スナップショットが、fromCache になった時刻（ms）。サーバーに届いている／購読していないときは null */
  fromCacheSince: number | null;
  /** 現在時刻（ms） */
  now: number;
}

export function connectionStatus({ browserOnline, fromCacheSince, now }: ConnectionInput): ConnectionState {
  if (!browserOnline) return 'offline';
  if (fromCacheSince !== null && now - fromCacheSince >= OFFLINE_AFTER_MS) return 'offline';
  return 'online';
}

export interface StatusBarView {
  connection: ConnectionState | 'pending';
  /** 未送信の件数。数えられない（再読み込み後）ときは null */
  pendingCount: number | null;
}

/**
 * ヘッダーの表示：オフライン ＞ 未送信あり ＞ オンライン。
 * オフラインのときも、数えられている未送信の件数は渡す（「オフライン（未送信◯件）」と出せるように）
 */
export function statusBarView(input: { connection: ConnectionState; pendingWrites: number; pendingUnknown: boolean }): StatusBarView {
  const { connection, pendingWrites, pendingUnknown } = input;
  if (connection === 'offline') return { connection, pendingCount: pendingWrites > 0 ? pendingWrites : null };
  if (pendingWrites > 0) return { connection: 'pending', pendingCount: pendingWrites };
  if (pendingUnknown) return { connection: 'pending', pendingCount: null };
  return { connection: 'online', pendingCount: null };
}
