// 招待（オーナー。screens.md §3.9、security-rules.md §4）。メールアドレスで招待し、リンクを相手に送る。
// いまはイベントの中の仮の画面に置く。「イベント」タブができたら、そこへ移す
import type { TargetedEvent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TextField } from '../../components/TextField';
import { AppError } from '../../lib/data/errors';
import { cancelInvite, createInvite, watchInvites } from '../../lib/data/members';
import type { Invite } from '../../lib/data/types';
import { formatDateTime } from '../../lib/domain/day';
import { inviteExpiresAt, joinUrl, normalizeInviteEmail } from '../../lib/domain/invite';
import { browserOnline } from '../../state/online';
import styles from './InvitePanel.module.css';

function messageOf(e: unknown): string {
  if (e instanceof AppError && e.code === 'offline') return '通信が必要です。電波を確認してから、もう一度押してください';
  if (e instanceof AppError && e.code === 'permission') return '招待できませんでした。オーナーだけが招待できます（削除中のイベントでは、招待できません）';
  return 'うまくいきませんでした。時間をおいて、もう一度押してください';
}

export function InvitePanel({ eventId, uid }: { eventId: string; uid: string }) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [email, setEmail] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canceling, setCanceling] = useState<string | null>(null);
  const online = browserOnline.value;
  const url = joinUrl(location.origin, eventId);

  useEffect(() => watchInvites(eventId, setInvites, (e) => setError(messageOf(e))), [eventId]);

  // 期限切れの表示を、時間の経過で切り替える（1分ごと）
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

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

  async function invite(e: Event) {
    e.preventDefault();
    const normalized = normalizeInviteEmail(email);
    if (!normalized) {
      setInputError('メールアドレスの形を確かめてください');
      return;
    }
    await run(async () => {
      await createInvite(eventId, normalized, uid);
      setEmail('');
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // コピーできない端末では、リンクを長押しで選んでもらう（.url は全体が選ばれる）
      setError('コピーできませんでした。リンクを長押しして、コピーしてください');
    }
  }

  return (
    <section class={styles.panel} aria-labelledby="invite-title">
      <h2 id="invite-title" class={styles.h2}>
        メンバーを招待
      </h2>

      <form class={styles.form} onSubmit={invite} noValidate>
        <TextField
          label="相手のGoogleアカウントのメールアドレス"
          placeholder="例：taro@gmail.com"
          autoComplete="off"
          inputMode="email"
          hint="相手がログインに使うアドレスを、そのまま入れてください。招待した人だけが、下のリンクから参加できます（期限は1日）"
          value={email}
          error={inputError}
          onInput={(e: TargetedEvent<HTMLInputElement>) => {
            setEmail(e.currentTarget.value);
            setInputError(null);
          }}
        />
        <Button type="submit" variant="primary" disabled={busy || !online}>
          招待する
        </Button>
        {!online && <p class={styles.expires}>招待には、通信が必要です</p>}
      </form>

      {error && (
        <p class={styles.error} role="alert">
          {error}
        </p>
      )}

      {invites && invites.length > 0 && (
        <>
          <div class={styles.link}>
            <p class={styles.linkLabel}>招待リンク（LINEなどで、招待した人に送ってください）</p>
            <p class={styles.url}>{url}</p>
            <div class={styles.row}>
              <Button variant="secondary" onClick={() => void copy()}>
                コピー
              </Button>
              {typeof navigator.share === 'function' && (
                <Button
                  variant="secondary"
                  onClick={() => void navigator.share({ title: '毎度おおきに への招待', url }).catch(() => {})}
                >
                  送る
                </Button>
              )}
              {copied && (
                <span class={styles.copied} role="status">
                  コピーしました
                </span>
              )}
            </div>
          </div>

          <ul class={styles.list} aria-label="招待中">
            {invites.map((inv) => {
              const expires = inviteExpiresAt(inv.createdAt);
              const expired = expires !== null && expires.getTime() <= now;
              return (
                <li key={inv.email}>
                  <Card muted={expired}>
                    <div class={styles.invite}>
                      <span class={styles.email}>{inv.email}</span>
                      <span class={`${styles.expires} ${expired ? styles.expired : ''}`}>
                        {expires === null ? '発行中…' : expired ? '期限切れ（再発行してください）' : `期限：${formatDateTime(expires)}まで`}
                      </span>
                      <div class={styles.row}>
                        <Button variant="secondary" disabled={busy || !online} onClick={() => void run(() => createInvite(eventId, inv.email, uid))}>
                          再発行
                        </Button>
                        <Button variant="danger" disabled={busy || !online} onClick={() => setCanceling(inv.email)}>
                          取り消し
                        </Button>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={canceling !== null}
        title="招待を取り消しますか？"
        confirmLabel="取り消す"
        danger
        onCancel={() => setCanceling(null)}
        onConfirm={() => {
          const target = canceling;
          setCanceling(null);
          if (target) void run(() => cancelInvite(eventId, target));
        }}
      >
        {canceling} は、リンクを開いても参加できなくなります。
      </ConfirmDialog>
    </section>
  );
}
