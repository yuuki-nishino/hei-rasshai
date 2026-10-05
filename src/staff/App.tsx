// スタッフ画面のルート。Shell は、後のIssueで足す（screens.md §1.2）
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Empty } from '../components/Feedback';
import { Noren } from '../components/Noren';
import { formatDayRange } from '../lib/domain/day';
import { currentUser } from '../state/auth';
import { cacheClearAsk, confirmCacheClear } from '../state/cacheClear';
import { selectEvent } from '../state/event';
import { logoutConfirm, logoutNow, requestLogout } from '../state/logout';
import { currentEvent } from '../state/myEvents';
import { joinEventId } from '../state/route';
import styles from './App.module.css';
import { AuthGate } from './auth/AuthGate';
import { EventGate } from './event/EventGate';
import { JoinPage } from './join/JoinPage';
import { InvitePanel } from './members/InvitePanel';
import { MembersPanel } from './members/MembersPanel';

// イベントの中の仮の画面（注文などのタブは、#12 以降で足す。メンバー・招待は「イベント」タブができたら移す）
function EventHome() {
  const event = currentEvent.value; // 一覧が届く前（オフラインの起動直後など）は undefined
  const uid = currentUser.value?.uid;
  const isOwner = !!event && !!uid && event.ownerUid === uid;
  return (
    <>
      <Noren
        title={event?.name ?? 'イベント'}
        sub={event ? formatDayRange(event.startDate, event.endDate) : undefined}
        actions={
          <Button variant="secondary" onClick={() => selectEvent(null)}>
            一覧へ
          </Button>
        }
      />
      <main class={styles.main}>
        <Empty title="注文の画面（準備中）" />
        {event && uid && <MembersPanel eventId={event.id} uid={uid} isOwner={isOwner} />}
        {event && uid && isOwner && <InvitePanel eventId={event.id} uid={uid} />}
        <Button variant="secondary" onClick={() => void requestLogout()}>
          ログアウト
        </Button>
      </main>
    </>
  );
}

// どの画面からでも出る確認（data-access.md §8）
function GlobalDialogs() {
  return (
    <>
      <ConfirmDialog
        open={logoutConfirm.value}
        title="未送信の操作があります"
        confirmLabel="消してログアウト"
        danger
        onCancel={() => (logoutConfirm.value = false)}
        onConfirm={() => void logoutNow()}
      >
        ログアウトすると、まだ送れていない操作が消えます。通信できる場所で送信してから、ログアウトしてください。
      </ConfirmDialog>
      <ConfirmDialog
        open={cacheClearAsk.value}
        title="未送信の操作が残っています"
        confirmLabel="消す"
        cancelLabel="あとで"
        danger
        onCancel={() => (cacheClearAsk.value = false)}
        onConfirm={() => void confirmCacheClear()}
      >
        参加していないイベントのデータが、この端末に残っています。消すと、まだ送れていない操作も消えます（外されたイベントの操作は、送っても受け付けられません）。消してよいですか？
      </ConfirmDialog>
    </>
  );
}

export function App() {
  const joinId = joinEventId.value;
  return (
    <AuthGate>
      {joinId !== null ? (
        <JoinPage eventId={joinId} />
      ) : (
        <EventGate>
          <EventHome />
        </EventGate>
      )}
      <GlobalDialogs />
    </AuthGate>
  );
}
