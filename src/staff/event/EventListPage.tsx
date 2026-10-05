// イベント一覧（screens.md §3.2）。タップで選び、hei:currentEvent に保存する
import { useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import { Empty, ErrorView, Loading } from '../../components/Feedback';
import { Noren } from '../../components/Noren';
import { formatDayRange } from '../../lib/domain/day';
import { currentUser } from '../../state/auth';
import { selectEvent } from '../../state/event';
import { myEvents, myEventsError } from '../../state/myEvents';
import { browserOnline } from '../../state/online';
import { logout } from '../auth/logout';
import { CreateEventPage } from './CreateEventPage';
import styles from './EventListPage.module.css';

export function EventListPage() {
  const [creating, setCreating] = useState(false);
  if (creating) return <CreateEventPage onBack={() => setCreating(false)} />;

  const data = myEvents.value;
  const online = browserOnline.value;

  return (
    <>
      <Noren
        title="イベント"
        sub={currentUser.value?.email ?? undefined}
        actions={
          <Button variant="secondary" onClick={() => void logout()}>
            ログアウト
          </Button>
        }
      />
      <main class={styles.main}>
        {!online && <p class={styles.notice}>オフラインです。端末に保存してあるイベントだけを表示しています</p>}
        <EventList />
        {data && (
          <div class={styles.create}>
            {/* ★作成できるかは、事前に分からない（creators は読めない）。ボタンは常に出し、失敗したら説明する */}
            <Button variant={data.events.length === 0 ? 'primary' : 'secondary'} block disabled={!online} onClick={() => setCreating(true)}>
              イベントを作成
            </Button>
            {!online && <p class={styles.hint}>イベントの作成には、通信が必要です</p>}
          </div>
        )}
      </main>
    </>
  );
}

function EventList() {
  const data = myEvents.value;
  const error = myEventsError.value;
  if (!data) {
    return error ? <ErrorView title="イベント一覧を読み込めませんでした" /> : <Loading label="イベントを読み込み中…" />;
  }
  if (data.events.length === 0) {
    // オフラインで、端末にも無いときは、「無い」と言い切らない
    return data.fromCache ? (
      <Empty title="通信できないため、イベント一覧を確認できません">
        <p>電波の良い場所で、もう一度開いてください</p>
      </Empty>
    ) : (
      <Empty title="イベントがありません">
        <p>招待を受けるか、イベントを作成してください</p>
      </Empty>
    );
  }
  return (
    <ul class={styles.list}>
      {data.events.map((e) => (
        <li key={e.id}>
          <button type="button" class={styles.item} onClick={() => selectEvent(e.id)}>
            <span class={styles.name}>
              {e.name}
              {e.deleting && <span class={styles.deleting}>削除中</span>}
            </span>
            <span class={styles.dates}>{formatDayRange(e.startDate, e.endDate)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
