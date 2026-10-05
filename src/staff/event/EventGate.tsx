// イベントを選んでいなければ、イベント一覧を出す（screens.md §1.2・§3.2）
// 保存してある現在のイベントは、一覧の取得を待たずに復元する（オフラインで起動しても、すぐ中に入れる）
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { currentUser } from '../../state/auth';
import { currentEventId } from '../../state/event';
import { tryClearCache } from '../../state/cacheClear';
import { currentEvent, myEventsRetry, subscribeMyEvents } from '../../state/myEvents';
import { DeletingEventPage } from './DeletingEventPage';
import { EventListPage } from './EventListPage';

export function EventGate({ children }: { children: ComponentChildren }) {
  const uid = currentUser.value?.uid;
  const onList = !currentEventId.value;
  // 一覧は、親のイベントを getDoc で1回だけ取るため、イベントの変更（名前・削除中）は、購読し直すまで反映されない。
  // そのため、一覧に戻るたび（と、イベントに入るとき）に、購読し直す（読み取りは、自分のイベントの数×2 程度）。
  // 購読が失敗したときの「やり直す」（myEventsRetry）でも、購読し直す
  const retry = myEventsRetry.value;
  useEffect(() => (uid ? subscribeMyEvents(uid) : undefined), [uid, onList, retry]);
  // 持ち越したキャッシュの消去は、一覧に戻ったとき（作業の切れ目）に試す。消すときは、再読み込みする（data-access.md §8）
  useEffect(() => {
    if (onList) void tryClearCache();
  }, [onList]);

  if (onList) return <EventListPage />;
  const event = currentEvent.value;
  if (event?.deleting) return <DeletingEventPage event={event} />;
  return <>{children}</>;
}
