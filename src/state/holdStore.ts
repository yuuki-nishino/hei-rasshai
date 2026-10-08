// 「完成」「渡した」の猶予（#45）。押してから猶予の間は、書き込みを保留し、画面の中だけで、状態を進めて見せる。
// 「元に戻す」が押されなければ、猶予が過ぎたとき（または、flush で、すぐ）書く。押されたら、何も書かない
import { signal } from '@preact/signals';
import type { Order } from '../lib/data/types';
import { isHoldable } from '../lib/domain/orderHold';
import { transitionPatch, type OrderAction, type OrderStatus } from '../lib/domain/orderStatus';

export interface Hold {
  orderId: string;
  number: number;
  eventId: string;
  uid: string;
  /** 操作する前の注文（画面に出ていたもの。書き込みの遷移の判定に使う） */
  order: Order;
  action: OrderAction;
  /** 操作したあとの状態（画面に見せる状態） */
  to: OrderStatus;
  /** 書き込み済み。「元に戻す」は出さない。購読に反映されるまでの間、見せる状態を保つ（一瞬、元に戻って見えないように） */
  written: boolean;
}

export interface HoldDeps {
  graceMs: number;
  /** 書き込み済みの印を、購読に反映されるまで保つ時間（ms） */
  settleMs: number;
  /** 書き込む（transitionOrder。拒否の通知は、呼ぶ側） */
  write: (hold: Hold) => void;
}

export function createHoldStore({ graceMs, settleMs, write }: HoldDeps) {
  const holds = signal<Hold[]>([]);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const find = (orderId: string) => holds.value.find((h) => h.orderId === orderId);
  const replace = (from: Hold, to: Hold | null) => {
    holds.value = holds.value.flatMap((h) => (h === from ? (to ? [to] : []) : [h]));
  };

  /** すぐ書く（猶予が過ぎたとき、同じ注文の次の操作の前、画面を離れる前） */
  function flush(orderId: string): void {
    const hold = find(orderId);
    if (!hold || hold.written) return;
    clearTimeout(timers.get(orderId));
    const written = { ...hold, written: true };
    replace(hold, written);
    timers.set(
      orderId,
      setTimeout(() => replace(written, null), settleMs),
    );
    write(hold);
  }

  return {
    holds,

    /** 保留を始める。できない遷移・対象外の操作は、false（呼ぶ側が、そのまま書く） */
    start(input: { eventId: string; uid: string; order: Order; action: OrderAction }): boolean {
      const patch = transitionPatch(input.order, input.action);
      if (!patch || !isHoldable(input.action)) return false;
      const orderId = input.order.id;
      flush(orderId); // 同じ注文の、前の保留（「完成」の直後の「渡した」など）は、先に書く
      clearTimeout(timers.get(orderId));
      const hold: Hold = { orderId, number: input.order.number, ...input, to: patch.status, written: false };
      holds.value = [...holds.value.filter((h) => h.orderId !== orderId), hold];
      timers.set(
        orderId,
        setTimeout(() => flush(orderId), graceMs),
      );
      return true;
    },

    /** 「元に戻す」：何も書かずに、保留をやめる。もう書いてあれば、false */
    undo(orderId: string): boolean {
      const hold = find(orderId);
      if (!hold || hold.written) return false;
      clearTimeout(timers.get(orderId));
      replace(hold, null);
      return true;
    },

    flush,

    /** 保留中の操作を、すべて、すぐ書く（画面を閉じる・離れる前） */
    flushAll(): void {
      for (const h of holds.value) flush(h.orderId);
    },
  };
}

/** 保留中の操作を、表示に反映する（画面の中だけで、状態を進めて見せる）。注文ごとに、いちばん新しい保留を使う */
export function applyHolds<T extends { id: string; status: OrderStatus }>(orders: readonly T[], holds: readonly Hold[]): T[] {
  if (holds.length === 0) return [...orders];
  const to = new Map(holds.map((h) => [h.orderId, h.to]));
  return orders.map((o) => (to.has(o.id) ? { ...o, status: to.get(o.id)! } : o));
}
