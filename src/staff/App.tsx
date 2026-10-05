// スタッフ画面のルート。Shell は、後のIssueで足す（screens.md §1.2）
import { Button } from '../components/Button';
import { Empty } from '../components/Feedback';
import { Noren } from '../components/Noren';
import { formatDayRange } from '../lib/domain/day';
import { currentUser } from '../state/auth';
import { selectEvent } from '../state/event';
import { currentEvent } from '../state/myEvents';
import { joinEventId } from '../state/route';
import { AuthGate } from './auth/AuthGate';
import { logout } from './auth/logout';
import { EventGate } from './event/EventGate';
import styles from './App.module.css';
import { JoinPage } from './join/JoinPage';
import { InvitePanel } from './members/InvitePanel';

// イベントの中の仮の画面（注文などのタブは、#12 以降で足す。招待は「イベント」タブができたら移す）
function EventHome() {
  const event = currentEvent.value; // 一覧が届く前（オフラインの起動直後など）は undefined
  const uid = currentUser.value?.uid;
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
        {event && uid && event.ownerUid === uid && <InvitePanel eventId={event.id} uid={uid} />}
        <Button variant="secondary" onClick={() => void logout()}>
          ログアウト
        </Button>
      </main>
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
    </AuthGate>
  );
}
