// 注文の状態遷移と、調理画面の表示に使う計算（data-model.md §3、screens.md §3.5）
import type { Day } from './day';

export type OrderStatus = 'preparing' | 'ready' | 'done' | 'cancelled';
export type Payment = 'cash' | 'paypay';

/** 調理画面の操作（data-access.md §3.5） */
export type OrderAction = 'ready' | 'backToPreparing' | 'done' | 'backToReady' | 'cancel' | 'restore';

/** 遷移の判定・書き換える項目の計算に使う、注文の最小限の形 */
export interface StatusOrder {
  status: OrderStatus;
  cancelledFrom: Exclude<OrderStatus, 'cancelled'> | null;
}

/** 'now'：サーバー時刻（serverTimestamp）を書く。null：消す。無い項目は、変えない */
export type TimeValue = 'now' | null;

export interface TransitionPatch {
  status: OrderStatus;
  cancelledFrom?: Exclude<OrderStatus, 'cancelled'> | null;
  readyAt?: TimeValue;
  doneAt?: TimeValue;
  cancelledAt?: TimeValue;
}

/**
 * 遷移で、書き換える項目（data-model.md §3 の表）。できない遷移は null（書く前に拒否する）。
 * どの更新でも、updatedBy・updatedAt を書く（呼ぶ側）。ルール（okTransition など）と同じ遷移だけを許す
 */
export function transitionPatch(order: StatusOrder, action: OrderAction): TransitionPatch | null {
  const { status } = order;
  switch (action) {
    case 'ready':
      return status === 'preparing' ? { status: 'ready', readyAt: 'now' } : null;
    case 'backToPreparing':
      return status === 'ready' ? { status: 'preparing', readyAt: null } : null;
    case 'done':
      return status === 'ready' ? { status: 'done', doneAt: 'now' } : null;
    case 'backToReady':
      return status === 'done' ? { status: 'ready', doneAt: null } : null;
    case 'cancel':
      return status === 'preparing' || status === 'ready' || status === 'done'
        ? { status: 'cancelled', cancelledFrom: status, cancelledAt: 'now' }
        : null;
    case 'restore':
      // 取り消し前の状態に戻す。時刻（readyAt・doneAt）は、取り消し前のまま
      return status === 'cancelled' && order.cancelledFrom ? { status: order.cancelledFrom, cancelledFrom: null, cancelledAt: null } : null;
  }
}

/** カードに出す操作（screens.md §3.5 の表。先頭が主の操作） */
export function availableActions(status: OrderStatus): OrderAction[] {
  switch (status) {
    case 'preparing':
      return ['ready', 'cancel'];
    case 'ready':
      return ['done', 'backToPreparing', 'cancel'];
    case 'done':
      return ['backToReady', 'cancel'];
    case 'cancelled':
      return ['restore'];
  }
}

export const ACTION_LABEL: Record<OrderAction, string> = {
  ready: '完成',
  done: '渡した',
  backToPreparing: '調理中に戻す',
  backToReady: '渡したを戻す',
  cancel: '取り消し',
  restore: '取り消しを戻す',
};

/** 並び順：(day, number) の昇順（複数日の開催で、前日の調理中が残っても、番号の並びが崩れない） */
export function sortOrders<T extends { day: Day; number: number }>(orders: readonly T[]): T[] {
  return [...orders].sort((a, b) => (a.day === b.day ? a.number - b.number : a.day < b.day ? -1 : 1));
}

/** 経過分数（now - createdAt）。createdAt が未確定（null）なら 0。負にならない */
export function elapsedMinutes(createdAt: Date | null, now: number): number {
  return createdAt ? Math.max(0, Math.floor((now - createdAt.getTime()) / 60_000)) : 0;
}

/** 今日以外の注文の、日付の印（'10/3'）。今日なら null */
export function dayMark(day: Day, today: Day): string | null {
  if (day === today) return null;
  const [, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${m}/${d}`;
}

/**
 * 取り消しの確認を押した時点の、最新の注文で判断する（ダイアログを開いている間に、ほかのメンバーが状態を変えることがある。
 * PR #42 のレビュー M1）。cancel：最新の状態から取り消す（お渡し済みも取り消せる）。already：すでに取り消されている（書かない）。
 * missing：見つからない（書かない）
 */
export function planCancel(latest: StatusOrder | undefined): 'cancel' | 'already' | 'missing' {
  if (!latest) return 'missing';
  return latest.status === 'cancelled' ? 'already' : 'cancel';
}
