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
  /** online：何も表示しない（オンライン前提のアプリのため、問題があるときだけ出す） */
  connection: ConnectionState | 'pending';
  /** 未送信の件数。0件・数えられないときは null */
  pendingCount: number | null;
  /** 件数は分からないが、未送信があるかもしれない（再読み込みの直後） */
  pendingUnknown: boolean;
}

/**
 * ヘッダーの表示：オフライン ＞ 未送信あり ＞ （何も出さない）。
 * オフラインのときも、未送信の件数（または、不明であること）は渡す。未送信の警告が一番要るのは、オフラインのときのため
 */
export function statusBarView(input: { connection: ConnectionState; pendingWrites: number; pendingUnknown: boolean }): StatusBarView {
  const { connection, pendingWrites, pendingUnknown } = input;
  const pendingCount = pendingWrites > 0 ? pendingWrites : null;
  const unknown = pendingCount === null && pendingUnknown;
  if (connection === 'offline') return { connection, pendingCount, pendingUnknown: unknown };
  if (pendingCount !== null || unknown) return { connection: 'pending', pendingCount, pendingUnknown: unknown };
  return { connection: 'online', pendingCount: null, pendingUnknown: false };
}
