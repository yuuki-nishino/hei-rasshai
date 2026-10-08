// 削除中のイベントを開いたとき（screens.md §3.2）。通常の画面には入らない。
// 「削除を再開」（オーナーのみ）で、続きから消す（#21）
import { Button } from '../../components/Button';
import { ErrorView } from '../../components/Feedback';
import { Noren } from '../../components/Noren';
import type { EventDoc } from '../../lib/data/types';
import { currentUser } from '../../state/auth';
import { selectEvent } from '../../state/event';
import { ResumeDelete } from './DeleteEventPanel';

export function DeletingEventPage({ event }: { event: EventDoc }) {
  const uid = currentUser.value?.uid;
  const isOwner = !!uid && event.ownerUid === uid;
  return (
    <>
      <Noren title={event.name} />
      <main>
        <ErrorView title={isOwner ? 'このイベントは削除の途中です' : 'オーナーが削除中です'}>
          {isOwner && <ResumeDelete event={event} uid={uid} />}
          <Button variant="secondary" onClick={() => selectEvent(null)}>
            一覧に戻る
          </Button>
        </ErrorView>
      </main>
    </>
  );
}
