// 招待の受け取り（/join?e={eventId}。screens.md §3.3）。ログインは AuthGate が済ませている
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import { ErrorView, Loading } from '../../components/Feedback';
import { Noren } from '../../components/Noren';
import { AppError } from '../../lib/data/errors';
import { joinEvent } from '../../lib/data/events';
import { currentUser } from '../../state/auth';
import { selectEvent } from '../../state/event';
import { leaveJoin } from '../../state/route';
import { requestLogout } from '../../state/logout';
import styles from './JoinPage.module.css';

type State = 'checking' | 'denied' | 'offline' | 'timeout' | 'error';

export function JoinPage({ eventId }: { eventId: string }) {
  const [state, setState] = useState<State>('checking');
  const [attempt, setAttempt] = useState(0);
  const user = currentUser.value;

  useEffect(() => {
    if (!user || !eventId) return;
    let cancelled = false;
    setState('checking');
    joinEvent(eventId, user).then(
      () => {
        if (cancelled) return;
        // 参加した・すでにメンバーだった：そのイベントを選んで、/ へ
        selectEvent(eventId);
        leaveJoin();
      },
      (e: unknown) => {
        if (cancelled) return;
        console.error(e);
        const code = e instanceof AppError ? e.code : 'unknown';
        setState(code === 'permission' ? 'denied' : code === 'offline' || code === 'timeout' ? code : 'error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, user, attempt]);

  const toList = (
    <Button variant="secondary" onClick={leaveJoin}>
      イベント一覧へ
    </Button>
  );
  const retry = (
    <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
      もう一度
    </Button>
  );

  return (
    <>
      <Noren title="招待の受け取り" />
      <main class={styles.main}>
        {!eventId ? (
          <ErrorView title="招待のリンクが正しくありません">
            <p>オーナーに、リンクをもう一度送ってもらってください</p>
            {toList}
          </ErrorView>
        ) : state === 'checking' ? (
          <Loading label="招待を確認しています…" />
        ) : state === 'denied' ? (
          <>
            <div class={styles.message} role="alert">
              <p class={styles.title}>このアカウントでは、参加できません</p>
              <p>
                ログイン中：<span class={styles.email}>{user?.email}</span>
              </p>
              <p>
                招待されたGoogleアカウントで、ログインし直してください。招待の期限（発行から1日）が切れている場合は、オーナーに再発行を頼んでください。
              </p>
              <p>
                オーナーには、上のメールアドレスを、そのまま伝えてください（Gmailの「.」の有無や「+」の付いた別名では、一致しないことがあります）。
              </p>
            </div>
            <div class={styles.actions}>
              {/* ログアウトして、ログイン画面へ。/join のままなので、ログインし直すと、もう一度確かめる */}
              <Button variant="primary" block onClick={() => void requestLogout()}>
                別のアカウントでログイン
              </Button>
              {toList}
            </div>
          </>
        ) : (
          <ErrorView title={state === 'offline' ? '通信が必要です。電波を確認してください' : state === 'timeout' ? '送れていません' : '確認できませんでした'}>
            {/* 時間切れ：送信待ちが端末に残り、つながり直したときに参加が済むことがある。「もう一度」は、まずメンバーかを確かめるので、二重にならない */}
            {state === 'timeout' && <p>電波の良い場所で「もう一度」を押してください。通信が戻ると、参加が済んでいることがあります</p>}
            <div class={styles.actions}>
              {retry}
              {toList}
            </div>
          </ErrorView>
        )}
      </main>
    </>
  );
}
