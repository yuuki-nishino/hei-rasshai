// 注文のメモの修正（#40）。調理画面のカードから開く。空にもできる。保存は、待たずに閉じる（オフラインでも受け付ける）
import type { TargetedEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { normalizeNote, NOTE_MAX } from '../../lib/domain/note';
import styles from './NoteDialog.module.css';

type Props = {
  /** 修正する注文。null なら閉じている */
  order: { id: string; number: number; note: string } | null;
  onSave: (orderId: string, note: string) => void;
  onClose: () => void;
};

export function NoteDialog({ order, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const open = order !== null;

  // 開くたびに、そのときのメモを入れる（開いている間に、ほかのメンバーが直しても、入力中の文字は変えない）
  const noteRef = useRef('');
  useEffect(() => {
    noteRef.current = order?.note ?? '';
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setText(noteRef.current);
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open, order?.id]);

  const normalized = normalizeNote(text);

  function submit(e: Event) {
    e.preventDefault();
    if (order && normalized !== null) onSave(order.id, normalized);
  }

  return (
    <dialog ref={ref} class={styles.dialog} aria-labelledby="note-dialog-title" onCancel={(e) => (e.preventDefault(), onClose())}>
      {order && (
        <form class={styles.form} onSubmit={submit} noValidate>
          <h2 id="note-dialog-title" class={styles.title}>
            {order.number}番のメモ
          </h2>
          <TextField
            label="メモ"
            placeholder="例：辛さ抜き"
            maxLength={NOTE_MAX}
            hint="空にすると、メモが消えます。お客様の画面には出ません。個人の名前など、個人情報は書かないでください"
            value={text}
            error={normalized === null ? `メモは${NOTE_MAX}文字までです` : null}
            onInput={(e: TargetedEvent<HTMLInputElement>) => setText(e.currentTarget.value)}
          />
          <div class={styles.actions}>
            <Button variant="secondary" onClick={onClose}>
              やめる
            </Button>
            <Button type="submit" variant="primary" disabled={normalized === null}>
              保存する
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
