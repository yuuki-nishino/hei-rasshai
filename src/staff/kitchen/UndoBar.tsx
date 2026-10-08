// 「完成」「渡した」の押し間違いを直せる、猶予の表示（#45）。猶予の間、「元に戻す」を出す（どのタブでも出す）
import { UNDO_GRACE_MS } from '../../lib/domain/orderHold';
import { holds, undoHold } from '../../state/hold';
import styles from './UndoBar.module.css';

const TO_LABEL = { ready: 'できあがり', done: 'お渡し済み', preparing: '調理中', cancelled: '取り消し' } as const;

export function UndoBar() {
  const waiting = holds.value.filter((h) => !h.written);
  if (waiting.length === 0) return null;
  return (
    <>
      {waiting.map((h) => (
        <div key={h.seq} class={styles.bar} role="status">
          <p class={styles.message}>
            <strong>{h.number}番</strong>を「{TO_LABEL[h.to]}」にしました
          </p>
          <button type="button" class={styles.undo} onClick={() => undoHold(h.orderId)}>
            元に戻す
          </button>
          <span class={styles.timer} style={{ animationDuration: `${UNDO_GRACE_MS}ms` }} aria-hidden="true" />
        </div>
      ))}
    </>
  );
}
