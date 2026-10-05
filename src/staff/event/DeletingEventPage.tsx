// 削除中のイベントを開いたとき（screens.md §3.2）。通常の画面には入らない。
// 「削除を再開」（オーナーのみ）は、イベントの削除（#21）で足す
import { Button } from '../../components/Button';
import { ErrorView } from '../../components/Feedback';
import { Noren } from '../../components/Noren';
import type { EventDoc } from '../../lib/data/types';
import { currentUser } from '../../state/auth';
import { selectEvent } from '../../state/event';

export function DeletingEventPage({ event }: { event: EventDoc }) {
  const isOwner = event.ownerUid === currentUser.value?.uid;
  return (
    <>
      <Noren title={event.name} />
      <main>
        <ErrorView title={isOwner ? 'このイベントは削除の途中です' : 'オーナーが削除中です'}>
          <Button variant="secondary" onClick={() => selectEvent(null)}>
            一覧に戻る
          </Button>
        </ErrorView>
      </main>
    </>
  );
}
