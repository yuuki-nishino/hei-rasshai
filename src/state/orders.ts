// 調理中・できあがりの注文（screens.md §1.2・§3.5）。Shell の階層（イベントを選んでいる間）で、常に購読する。
// 接続状態の判定（#19）と、調理画面で共有するため
import { signal } from '@preact/signals';
import type { AppError } from '../lib/data/errors';
import { watchActiveOrders } from '../lib/data/orders';
import type { Order } from '../lib/data/types';
import { selectEvent } from './event';

export interface ActiveOrdersState {
  orders: Order[];
  /** サーバーで確かめていない一覧（オフライン）。#19 の接続状態の推定に使う */
  fromCache: boolean;
}

/** null：まだ届いていない */
export const activeOrders = signal<ActiveOrdersState | null>(null);
export const activeOrdersError = signal<AppError | null>(null);

/** 購読を始める。解除する関数を返す（EventHome の useEffect から） */
export function subscribeActiveOrders(eventId: string): () => void {
  activeOrders.value = null;
  activeOrdersError.value = null;
  const unsubscribe = watchActiveOrders(
    eventId,
    (orders, meta) => {
      activeOrders.value = { orders, fromCache: meta.fromCache };
      activeOrdersError.value = null;
    },
    (e) => {
      activeOrdersError.value = e;
      if (e.code === 'permission') selectEvent(null); // メンバーでなくなった（data-access.md §5）
    },
  );
  return () => {
    unsubscribe();
    activeOrders.value = null;
  };
}
