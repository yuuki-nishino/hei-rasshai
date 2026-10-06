// データアクセス層の型（data-access.md §2）。Firestore の型を UI に漏らさない
import type { Day } from '../domain/day';

export interface EventDoc {
  id: string;
  name: string;
  startDate: Day;
  endDate: Day;
  floatCash: number;
  ownerUid: string;
  deleting: boolean;
}

export interface Member {
  uid: string;
  role: 'owner' | 'member';
  displayName: string;
  email: string;
}

export type { OrderStatus, Payment } from '../domain/orderStatus';
import type { OrderStatus, Payment } from '../domain/orderStatus';

export interface OrderLine {
  menuId: string;
  name: string;
  price: number;
  qty: number;
}

/** 注文（data-model.md §2.6）。時刻は、書き込み直後（サーバー時刻の確定前）に null になり得る */
export interface Order {
  id: string;
  number: number;
  day: string;
  items: OrderLine[];
  total: number;
  payment: Payment;
  /** メモ（無い注文は、空） */
  note: string;
  status: OrderStatus;
  cancelledFrom: Exclude<OrderStatus, 'cancelled'> | null;
  qr: boolean;
  createdAt: Date | null;
  readyAt: Date | null;
  doneAt: Date | null;
  cancelledAt: Date | null;
  createdBy: string;
  updatedBy: string;
  updatedAt: Date | null;
  /** この注文に、未送信の書き込みがある（metadata.hasPendingWrites） */
  pending: boolean;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  order: number;
  soldOut: boolean;
}

/** 招待。期限（発行の1日後）は、画面で inviteExpiresAt で計算する。createdAt は、書き込み直後は見積もりの時刻 */
export interface Invite {
  email: string;
  createdAt: Date | null;
}

/** watchMyEvents の補足。memberOf：自分の members があるイベントのID（表示できないものも含む） */
export interface MyEventsMeta {
  fromCache: boolean;
  memberOf: string[];
}

export type Unsubscribe = () => void;
