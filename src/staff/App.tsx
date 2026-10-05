// スタッフ画面のルート。Shell は、後のIssueで足す（screens.md §1.2）
import { Button } from '../components/Button';
import { Empty } from '../components/Feedback';
import { Noren } from '../components/Noren';
import { formatDayRange } from '../lib/domain/day';
import { selectEvent } from '../state/event';
import { currentEvent } from '../state/myEvents';
import { AuthGate } from './auth/AuthGate';
import { logout } from './auth/logout';
import { EventGate } from './event/EventGate';

// イベントの中の仮の画面（注文などのタブは、#12 以降で足す）
function EventHome() {
  const event = currentEvent.value; // 一覧が届く前（オフラインの起動直後など）は undefined
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
      <main>
        <Empty title="注文の画面（準備中）">
          <Button variant="secondary" onClick={() => void logout()}>
            ログアウト
          </Button>
        </Empty>
      </main>
    </>
  );
}

export function App() {
  return (
    <AuthGate>
      <EventGate>
        <EventHome />
      </EventGate>
    </AuthGate>
  );
}
