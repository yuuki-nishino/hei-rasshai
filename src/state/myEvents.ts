// 自分のイベントの一覧（screens.md §3.2）。ログインしている間、EventGate が購読する
import { computed, effect, signal } from '@preact/signals';
import type { AppError } from '../lib/data/errors';
import { watchMyEvents } from '../lib/data/events';
import type { EventDoc } from '../lib/data/types';
import { isSelectionGone } from '../lib/domain/event';
import { currentUser } from './auth';
import { clearMark, onServerMembership } from './cacheClear';
import { currentEventId, selectEvent } from './event';

/** null：まだ届いていない */
export const myEvents = signal<{ events: EventDoc[]; fromCache: boolean } | null>(null);
export const myEventsError = signal<AppError | null>(null);
/** 「やり直す」で増やす。EventGate が、これを見て購読し直す（PR #32 のレビュー E3） */
export const myEventsRetry = signal(0);

/** 現在のイベント。一覧が届く前・一覧に無いときは undefined（EventGate は、一覧を待たずに中へ進む） */
export const currentEvent = computed(() => myEvents.value?.events.find((e) => e.id === currentEventId.value));

let subscribedUid: string | null = null;

// ログアウトしたら（ログインが切れた場合も）、一覧を消す。次の人に、前の人の一覧が一瞬見えないように（レビュー E2）
effect(() => {
  if (currentUser.value === null) {
    myEvents.value = null;
    myEventsError.value = null;
    subscribedUid = null;
  }
});

export function retryMyEvents(): void {
  myEventsRetry.value++;
}

export function subscribeMyEvents(uid: string): () => void {
  // 同じ人が購読し直すときは、前の一覧を残す（届くまでの間、「読み込み中」に戻らないように）。別の人なら消す
  if (uid !== subscribedUid) myEvents.value = null;
  subscribedUid = uid;
  myEventsError.value = null;
  return watchMyEvents(
    uid,
    (events, meta) => {
      // 外れたイベント・参加し直したイベントを、先に印へ反映する（参加し直した直後の一覧で、隠さないように。PR #34 の再レビュー K4）。
      // 新しく外れたイベントは、もともと events に無いため、先に呼んでも絞り込みは変わらない
      if (!meta.fromCache) onServerMembership(meta.memberOf);
      // 消去待ちの、外れたイベントは、一覧に出さず、開けない（data-access.md §8）
      const hidden = clearMark.peek()?.events ?? [];
      myEvents.value = { events: events.filter((e) => !hidden.includes(e.id)), fromCache: meta.fromCache };
      myEventsError.value = null;
      const current = currentEventId.peek();
      // 選んでいるイベントから外れていたら、選択を外して一覧に戻す（消された・外された。レビュー E1）
      if (isSelectionGone(current, meta) || (current && hidden.includes(current))) selectEvent(null);
    },
    (e) => (myEventsError.value = e),
  );
}
