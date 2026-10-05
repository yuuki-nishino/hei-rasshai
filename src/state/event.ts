// 現在のイベント（screens.md §1.3）。localStorage の hei:currentEvent に保存し、起動時に復元する
import { signal } from '@preact/signals';
import { readStorage, writeStorage } from './storage';

const KEY = 'hei:currentEvent';

export const currentEventId = signal<string | null>(readStorage(KEY));

export function selectEvent(eventId: string | null): void {
  currentEventId.value = eventId;
  writeStorage(KEY, eventId);
}
