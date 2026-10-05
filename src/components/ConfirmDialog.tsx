// 確認ダイアログ（screens.md §2）。取り消し・削除などの前に出す。ブラウザ標準の <dialog> を使う（フォーカスの閉じ込め・Esc で閉じる）
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { Button } from './Button';
import styles from './ConfirmDialog.module.css';

type Props = {
  open: boolean;
  title: string;
  children?: ComponentChildren;
  /** 実行ボタンの文言。「取り消す」など、何が起きるかを書く */
  confirmLabel: string;
  cancelLabel?: string;
  /** 取り消し・削除なら true（実行ボタンを赤にする） */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = 'やめる', danger = false, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    // Esc で閉じたときも、onCancel を呼ぶ
    <dialog ref={ref} class={styles.dialog} aria-labelledby={titleId} onCancel={(e) => (e.preventDefault(), onCancel())}>
      <h2 id={titleId} class={styles.title}>
        {title}
      </h2>
      {children && <div class={styles.body}>{children}</div>}
      <div class={styles.actions}>
        {/* 最初のフォーカスは「やめる」（Enter の押し間違いで実行しない） */}
        <Button variant="secondary" onClick={onCancel} autofocus>
          {cancelLabel}
        </Button>
        <Button variant={danger ? 'dangerSolid' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
