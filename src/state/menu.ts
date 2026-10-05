// メニューの購読（screens.md §1.3、data-access.md §5）。共有ストア（signals）に載せ、同じイベントのメニューを、
// 複数の画面（メニュー・注文）が使っても、購読は1つにする（使う画面の数を数え、0になったら解除）
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { AppError } from '../lib/data/errors';
import { watchMenu } from '../lib/data/menu';
import type { MenuItem } from '../lib/data/types';
import { selectEvent } from './event';

interface MenuState {
  eventId: string | null;
  /** null：まだ届いていない */
  items: MenuItem[] | null;
  error: AppError | null;
}

export const menuState = signal<MenuState>({ eventId: null, items: null, error: null });

let users = 0;
let unsubscribe: (() => void) | null = null;

function acquire(eventId: string): () => void {
  if (menuState.peek().eventId !== eventId) {
    unsubscribe?.();
    menuState.value = { eventId, items: null, error: null };
    unsubscribe = watchMenu(
      eventId,
      (items) => (menuState.value = { eventId, items, error: null }),
      (error) => {
        menuState.value = { ...menuState.peek(), error };
        if (error.code === 'permission') selectEvent(null); // 外された（data-access.md §5）
      },
    );
  }
  users++;
  return () => {
    users--;
    if (users === 0) {
      unsubscribe?.();
      unsubscribe = null;
      menuState.value = { eventId: null, items: null, error: null };
    }
  };
}

/** そのイベントのメニュー。画面が表示されている間、購読する */
export function useMenu(eventId: string): { items: MenuItem[] | null; error: AppError | null } {
  useEffect(() => acquire(eventId), [eventId]);
  const s = menuState.value;
  return s.eventId === eventId ? { items: s.items, error: s.error } : { items: null, error: null };
}
