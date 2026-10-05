// 自分のイベントの一覧（screens.md §3.2）。ログインしている間、EventGate が購読する
import { computed, signal } from '@preact/signals';
import type { AppError } from '../lib/data/errors';
import { watchMyEvents } from '../lib/data/events';
import type { EventDoc } from '../lib/data/types';
import { currentEventId } from './event';

/** null：まだ届いていない */
export const myEvents = signal<{ events: EventDoc[]; fromCache: boolean } | null>(null);
export const myEventsError = signal<AppError | null>(null);

/** 現在のイベント。一覧が届く前・一覧に無いときは undefined（EventGate は、一覧を待たずに中へ進む） */
export const currentEvent = computed(() => myEvents.value?.events.find((e) => e.id === currentEventId.value));

let subscribedUid: string | null = null;

export function subscribeMyEvents(uid: string): () => void {
  // 同じ人が購読し直すときは、前の一覧を残す（届くまでの間、「読み込み中」に戻らないように）。別の人なら消す
  if (uid !== subscribedUid) myEvents.value = null;
  subscribedUid = uid;
  myEventsError.value = null;
  return watchMyEvents(
    uid,
    (events, { fromCache }) => {
      myEvents.value = { events, fromCache };
      myEventsError.value = null;
    },
    (e) => (myEventsError.value = e),
  );
}
