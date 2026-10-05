// スタッフ画面のURL（screens.md §1.1）。/ と /join?e={eventId} だけ。小さな自前の判別で足りる
import { signal } from '@preact/signals';

function readJoin(): string | null {
  if (typeof location === 'undefined' || location.pathname !== '/join') return null;
  return new URLSearchParams(location.search).get('e') ?? '';
}

/** /join で開いたときの eventId。'' はリンクが壊れている（e が無い）。null は /join ではない */
export const joinEventId = signal<string | null>(readJoin());

/** /join の処理を終えて、/ に戻る（履歴を増やさない） */
export function leaveJoin(): void {
  history.replaceState(null, '', '/');
  joinEventId.value = null;
}
