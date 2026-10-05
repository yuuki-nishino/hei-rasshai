// 接続状態の帯（screens.md §2）。オンライン＝緑、オフライン＝赤、未送信あり＝黄。判定は data-access.md §6（後のIssue）
import styles from './StatusBar.module.css';

export type Connection = 'online' | 'offline' | 'pending';

/** pendingCount：未送信の件数。数えられないときは null（「未送信あり」と出す） */
export function StatusBar({ connection, pendingCount = null }: { connection: Connection; pendingCount?: number | null }) {
  const text =
    connection === 'online' ? 'オンライン' : connection === 'offline' ? 'オフライン' : pendingCount === null ? '未送信あり' : `未送信 ${pendingCount}件`;
  return (
    <div class={`${styles.bar} ${styles[connection]}`} role="status">
      {text}
    </div>
  );
}
