// イベントの削除（screens.md §3.2・§3.9）。オーナーのみ。イベント名の入力で確定し、進捗を出す。
// 途中で止まったら「削除を再開」（イベントのタブにも、削除中の画面にも出す）
import { useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TextField } from '../../components/TextField';
import type { DeletePhase } from '../../lib/data/eventDelete';
import type { EventDoc } from '../../lib/data/types';
import { deleteState, startEventDelete } from '../../state/eventDelete';
import { browserOnline } from '../../state/online';
import styles from './DeleteEventPanel.module.css';

const PHASE_LABEL: Record<DeletePhase, string> = {
  prepare: '準備しています',
  members: 'メンバーと招待を削除しています',
  data: '注文・メニューなどを削除しています',
  verify: '残りがないか確かめています',
  event: 'イベントを削除しています',
  self: '仕上げています',
};

/** 進捗・エラー・「削除を再開」。このイベントの削除が動いている（または止まっている）ときだけ出す */
export function DeleteStatus({ event, uid }: { event: EventDoc; uid: string }) {
  const s = deleteState.value;
  const online = browserOnline.value;
  if (s.kind === 'idle' || s.eventId !== event.id) return null;
  if (s.kind === 'running') {
    return (
      <div class={styles.status} role="status" aria-live="polite">
        <p class={styles.phase}>{PHASE_LABEL[s.progress.phase]}…</p>
        <p class={styles.count}>{s.progress.deleted.toLocaleString('ja-JP')} 件を削除しました</p>
        <p class={styles.hint}>終わるまで、この画面を閉じないでください。件数が多いと、数分かかります</p>
      </div>
    );
  }
  return (
    <div class={styles.status}>
      <p class={styles.error} role="alert">
        {s.message}
      </p>
      <Button variant="primary" block disabled={!online} onClick={() => void startEventDelete(event.id, uid)}>
        削除を再開
      </Button>
    </div>
  );
}

/** 削除中のイベント（deleting = true）を開いたとき、オーナーに出す「削除を再開」 */
export function ResumeDelete({ event, uid }: { event: EventDoc; uid: string }) {
  const s = deleteState.value;
  const online = browserOnline.value;
  const mine = s.kind !== 'idle' && s.eventId === event.id;
  return (
    <div class={styles.resume}>
      {mine ? (
        <DeleteStatus event={event} uid={uid} />
      ) : (
        <>
          <Button variant="primary" block disabled={!online} onClick={() => void startEventDelete(event.id, uid)}>
            削除を再開
          </Button>
          {!online && <p class={styles.hint}>削除には、通信が必要です</p>}
        </>
      )}
    </div>
  );
}

/** イベントのタブの「イベントを削除」（オーナーのみ） */
export function DeleteEventPanel({ event, uid }: { event: EventDoc; uid: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const online = browserOnline.value;
  const s = deleteState.value;
  const active = s.kind !== 'idle' && s.eventId === event.id;

  function close() {
    setOpen(false);
    setName('');
    setError(null);
  }

  function confirm() {
    if (name.trim() !== event.name) {
      setError('イベント名が違います');
      return;
    }
    close();
    void startEventDelete(event.id, uid);
  }

  return (
    <section class={styles.panel} aria-labelledby="delete-event-title">
      <h2 id="delete-event-title" class={styles.h2}>
        イベントの削除
      </h2>
      {active ? (
        <DeleteStatus event={event} uid={uid} />
      ) : (
        <>
          <p class={styles.note}>注文・売上・メニュー・メンバーを含め、すべて消えます。元に戻せません</p>
          <Button variant="danger" block disabled={!online} onClick={() => setOpen(true)}>
            イベントを削除
          </Button>
          {!online && <p class={styles.hint}>削除には、通信が必要です</p>}
        </>
      )}

      <ConfirmDialog open={open} title="このイベントを削除しますか？" confirmLabel="削除する" danger onCancel={close} onConfirm={confirm}>
        <p>
          「{event.name}」の注文・売上・メニュー・メンバーが、すべて消えます。元に戻せません。確かめるため、イベント名を入力してください。
        </p>
        <TextField
          label="イベント名"
          value={name}
          error={error}
          autoComplete="off"
          onInput={(e: TargetedEvent<HTMLInputElement>) => {
            setName(e.currentTarget.value);
            setError(null);
          }}
        />
      </ConfirmDialog>
    </section>
  );
}
