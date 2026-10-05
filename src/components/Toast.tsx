// トースト（screens.md §2）。成功は数秒で消し、失敗は閉じるまで残す（消す時間は、使う側の ToastHost で管理する）
import type { ComponentChildren } from 'preact';
import styles from './Toast.module.css';

export type ToastKind = 'success' | 'error';

export function Toast({ kind, message, onClose }: { kind: ToastKind; message: string; onClose: () => void }) {
  return (
    <div class={`${styles.toast} ${kind === 'error' ? styles.error : ''}`} role={kind === 'error' ? 'alert' : 'status'}>
      <p class={styles.message}>{message}</p>
      <button type="button" class={styles.close} onClick={onClose}>
        閉じる
      </button>
    </div>
  );
}

/** トーストを並べる場所（画面の下） */
export function ToastRegion({ children }: { children: ComponentChildren }) {
  return <div class={styles.region}>{children}</div>;
}
