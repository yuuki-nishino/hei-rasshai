// 接続状態の帯（screens.md §2）。オンライン前提のアプリのため、問題があるときだけ出す：
// 通信が不安定（オフライン）＝赤、未送信あり＝黄。オンラインで未送信も無いときは、何も出さない。判定は data-access.md §6
import styles from './StatusBar.module.css';

export type Connection = 'online' | 'offline' | 'pending';

/** pendingCount：未送信の件数（無ければ null）。pendingUnknown：件数は分からないが、あるかもしれない */
export function StatusBar({
  connection,
  pendingCount = null,
  pendingUnknown = false,
}: {
  connection: Connection;
  pendingCount?: number | null;
  pendingUnknown?: boolean;
}) {
  if (connection === 'online') return null;
  const pending = pendingCount !== null ? `未送信 ${pendingCount}件` : pendingUnknown ? '未送信あり' : '';
  const text = connection === 'offline' ? `通信状態が不安定です${pending ? `（${pending}）` : ''}` : pending;
  return (
    <div class={`${styles.bar} ${styles[connection]}`} role="status">
      {text}
    </div>
  );
}
