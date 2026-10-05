// メンバー（screens.md §3.9）。一覧、オーナーによる削除、メンバーが自分で抜ける。
// いまはイベントの中の仮の画面に置く。「イベント」タブができたら、そこへ移す
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Loading } from '../../components/Feedback';
import { AppError } from '../../lib/data/errors';
import { removeMember, watchMembers } from '../../lib/data/members';
import type { Member } from '../../lib/data/types';
import { selectEvent } from '../../state/event';
import { browserOnline } from '../../state/online';
import styles from './MembersPanel.module.css';

function messageOf(e: unknown): string {
  if (e instanceof AppError && e.code === 'offline') return '通信が必要です。電波を確認してから、もう一度押してください';
  if (e instanceof AppError && e.code === 'timeout') return '送れていません。通信が戻ると、反映されることがあります。一覧を確かめてください';
  if (e instanceof AppError && e.code === 'permission') return 'この操作は許可されていません';
  return 'うまくいきませんでした。時間をおいて、もう一度押してください';
}

type Pending = { kind: 'remove'; member: Member } | { kind: 'leave' };

export function MembersPanel({ eventId, uid, isOwner }: { eventId: string; uid: string; isOwner: boolean }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const online = browserOnline.value;

  // 外された（permission-denied）ときは、イベント一覧へ（data-access.md §5。キャッシュの消去は、一覧の購読が始める）
  useEffect(
    () =>
      watchMembers(eventId, setMembers, (e) => {
        if (e.code === 'permission') selectEvent(null);
        else setError(messageOf(e));
      }),
    [eventId],
  );

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      console.error(e);
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    const p = pending;
    setPending(null);
    if (p?.kind === 'remove') void run(() => removeMember(eventId, p.member.uid));
    if (p?.kind === 'leave') {
      void run(async () => {
        await removeMember(eventId, uid);
        selectEvent(null); // 一覧へ。端末のキャッシュの消去は、一覧の購読が始める
      });
    }
  }

  return (
    <section class={styles.panel} aria-labelledby="members-title">
      <h2 id="members-title" class={styles.h2}>
        メンバー
      </h2>
      {members === null ? (
        <Loading label="メンバーを読み込み中…" />
      ) : (
        <ul class={styles.list}>
          {members.map((m) => (
            <li key={m.uid}>
              <Card>
                <div class={styles.member}>
                  <div class={styles.who}>
                    <span class={styles.name}>
                      {m.displayName || '（名前なし）'}
                      {m.uid === uid && '（自分）'}
                    </span>
                    <span class={styles.email}>{m.email}</span>
                  </div>
                  {m.role === 'owner' && <span class={styles.role}>オーナー</span>}
                  {isOwner && m.uid !== uid && (
                    <Button variant="danger" disabled={busy || !online} onClick={() => setPending({ kind: 'remove', member: m })}>
                      外す
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p class={styles.error} role="alert">
          {error}
        </p>
      )}

      {/* オーナーは抜けられない（イベントの削除のみ） */}
      {!isOwner && (
        <Button variant="danger" block disabled={busy || !online} onClick={() => setPending({ kind: 'leave' })}>
          このイベントから抜ける
        </Button>
      )}
      {!online && <p class={styles.hint}>メンバーの変更には、通信が必要です</p>}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'remove' ? `${pending.member.displayName || pending.member.email} を外しますか？` : 'このイベントから抜けますか？'}
        confirmLabel={pending?.kind === 'remove' ? '外す' : '抜ける'}
        danger
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      >
        {pending?.kind === 'remove'
          ? 'このイベントを開けなくなります。もう一度参加するには、招待し直してください。'
          : 'このイベントを開けなくなります。もう一度参加するには、オーナーに招待してもらってください。'}
      </ConfirmDialog>
    </section>
  );
}
