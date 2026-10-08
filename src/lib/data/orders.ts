// 注文（data-access.md §3.5、order-confirm.md §5）
import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentSnapshot,
  type QuerySnapshot,
  type Timestamp,
} from 'firebase/firestore';
import type { ConfirmContext } from '../domain/confirmFlow';
import { NOTE_MAX } from '../domain/note';
import { sortOrders, transitionPatch, type OrderAction, type TimeValue } from '../domain/orderStatus';
import { db } from '../firebase/staff';
import { AppError, toAppError } from './errors';
import { withTimeout } from './online';
import type { Order, OrderLine, Payment, Unsubscribe } from './types';

const ordersCol = (eventId: string) => collection(db, 'events', eventId, 'orders');

/** 新しい注文ID（確定ボタンを押した時点で作り、再試行で使い回す。order-confirm.md §3） */
export function newOrderId(eventId: string): string {
  return doc(ordersCol(eventId)).id;
}

const toDate = (v: unknown) => (v ? (v as Timestamp).toDate() : null);

export function toOrder(snap: DocumentSnapshot): Order {
  const d = snap.data({ serverTimestamps: 'estimate' })!;
  return {
    id: snap.id,
    number: d.number,
    day: d.day,
    items: (d.items as OrderLine[]).map((i) => ({ menuId: i.menuId, name: i.name, price: i.price, qty: i.qty, ...(i.cook === false ? { cook: false } : {}) })),
    total: d.total,
    payment: d.payment,
    note: typeof d.note === 'string' ? d.note : '', // 無い注文（#40 より前）は、空
    status: d.status,
    cancelledFrom: d.cancelledFrom ?? null,
    qr: d.qr === true,
    createdAt: toDate(d.createdAt),
    readyAt: toDate(d.readyAt),
    doneAt: toDate(d.doneAt),
    cancelledAt: toDate(d.cancelledAt),
    createdBy: d.createdBy,
    updatedBy: d.updatedBy,
    updatedAt: toDate(d.updatedAt),
    pending: snap.metadata.hasPendingWrites,
  };
}

/**
 * 確定（order-confirm.md §5.1）。トランザクションで、カウンターを1つ進めて番号を付け、注文を作る。
 * 同じ orderId の注文が既にあれば、それを返す（冪等。再試行で二重にならない）。
 * QR あり → 調理中（preparing）、QR なし → 確定と同時にお渡し済み（done）。
 * 失敗は AppError（墓標がある orderId は permission）。時間切れは、呼ぶ側（8秒）で扱う。
 *
 * 同時の確定（2台が同じ日のカウンターを同時に進める）では、サーバーは、後のコミットを「やり直し（aborted）」ではなく、
 * ルールの拒否（permission-denied）として返す（ルールは、コミットの時点のカウンターで評価されるため）。
 * そのため、permission のときは、墓標が無いことを確かめてから、同じ orderId で数回やり直す（同じ orderId なので二重にならない）。
 * #13 で、Emulator の並行テストで分かった（testing.md §4 #4）
 */
export async function confirmOrder(eventId: string, ctx: ConfirmContext, uid: string): Promise<Order> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await confirmOnce(eventId, ctx, uid);
    } catch (e) {
      const err = toAppError(e);
      if (err.code !== 'permission' || attempt >= CONFIRM_ATTEMPTS) throw err;
      // 墓標がある（やめた注文）・確かめられないなら、やり直さない
      if (await voidExistsOnServer(eventId, ctx.orderId).catch(() => true)) throw err;
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 150 * attempt)); // 同時に走る相手と、ずらす
    }
  }
}

const CONFIRM_ATTEMPTS = 5;

/** 1回分の確定のトランザクション */
async function confirmOnce(eventId: string, ctx: ConfirmContext, uid: string): Promise<Order> {
  const orderRef = doc(ordersCol(eventId), ctx.orderId);
  const counterRef = doc(db, 'events', eventId, 'counters', ctx.day);
  const { items, total, payment, qr } = ctx.draft;
  const note = ctx.draft.note ?? ''; // 古い pending（メモの項目なし）は、空
  const lines = items.map((i) => ({ menuId: i.menuId, name: i.name, price: i.price, qty: i.qty, ...(i.cook === false ? { cook: false } : {}) }));
  try {
    const result = await runTransaction(db, async (tx) => {
      const o = await tx.get(orderRef);
      if (o.exists()) return { existing: toOrder(o), number: 0 };
      const counter = await tx.get(counterRef);
      const number = (counter.exists() ? (counter.get('n') as number) : 0) + 1;
      tx.set(counterRef, { n: number });
      tx.set(orderRef, {
        number,
        day: ctx.day,
        items: lines,
        total,
        payment,
        note,
        status: qr ? 'preparing' : 'done',
        cancelledFrom: null,
        qr,
        createdAt: serverTimestamp(),
        readyAt: null,
        doneAt: qr ? null : serverTimestamp(),
        cancelledAt: null,
        createdBy: uid,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      });
      return { existing: null, number };
    });
    if (result.existing) return result.existing;
    // 書いた内容から組み立てる（読み直さない：確定の直後に通信が切れても、成功を失敗と取り違えないため）。時刻は未確定（null）
    return {
      id: ctx.orderId,
      number: result.number,
      day: ctx.day,
      items: lines,
      total,
      payment,
      note,
      status: qr ? 'preparing' : 'done',
      cancelledFrom: null,
      qr,
      createdAt: null,
      readyAt: null,
      doneAt: null,
      cancelledAt: null,
      createdBy: uid,
      updatedBy: uid,
      updatedAt: null,
      pending: false,
    };
  } catch (e) {
    throw toAppError(e);
  }
}

/**
 * やめる（void-or-find。order-confirm.md §5.2）。注文があれば返し（成功扱い）、なければ墓標を作る。
 * 直前に注文が登録された競合（ルールが墓標を拒否）は、注文を読み直して found にする。
 * permission を投げるのは、サーバーで注文が無いと確かめたうえで、墓標を作る権限が無いとき（メンバーでない・削除中）だけ
 */
export async function voidOrFind(eventId: string, orderId: string, uid: string): Promise<{ result: 'found'; order: Order } | { result: 'voided' }> {
  const orderRef = doc(ordersCol(eventId), orderId);
  const voidRef = doc(db, 'events', eventId, 'voids', orderId);
  try {
    return await runTransaction(db, async (tx) => {
      const o = await tx.get(orderRef);
      if (o.exists()) return { result: 'found' as const, order: toOrder(o) };
      const v = await tx.get(voidRef);
      if (!v.exists()) tx.set(voidRef, { createdBy: uid, createdAt: serverTimestamp() });
      return { result: 'voided' as const };
    });
  } catch (e) {
    const err = toAppError(e);
    if (err.code === 'permission') {
      // 注文は、誰でも1件読める（ルールの orders の get: if true）。メンバーでなくても、サーバーで注文の有無を確かめられる。
      // 確かめられなかった（通信の失敗など）ときは、その失敗を投げる（permission のままだと「登録されていません」と言い切ってしまう。
      // PR #39 の再レビュー R1）
      let o;
      try {
        o = await getDocFromServer(orderRef);
      } catch (readError) {
        throw toAppError(readError);
      }
      if (o.exists()) return { result: 'found', order: toOrder(o) };
    }
    throw err; // permission：サーバーで、注文が無いと確かめた（墓標は、権限で作れない）
  }
}

/** サーバーで、注文を確かめる（キャッシュを使わない）。無ければ null。通信できなければ AppError('offline') */
export async function findOrderOnServer(eventId: string, orderId: string): Promise<Order | null> {
  try {
    const snap = await getDocFromServer(doc(ordersCol(eventId), orderId));
    return snap.exists() ? toOrder(snap) : null;
  } catch (e) {
    throw toAppError(e);
  }
}

/** サーバーで、墓標があるか（確定が permission で拒否されたときの確認。order-confirm.md §5.1） */
export async function voidExistsOnServer(eventId: string, orderId: string): Promise<boolean> {
  try {
    return (await getDocFromServer(doc(db, 'events', eventId, 'voids', orderId))).exists();
  } catch (e) {
    throw toAppError(e);
  }
}

/** 購読の補足。fromCache：サーバーで確かめていない一覧（接続状態の推定に使う。#19） */
export interface OrdersMeta {
  fromCache: boolean;
}

function handleSnapshot(snap: QuerySnapshot, cb: (orders: Order[], meta: OrdersMeta) => void) {
  cb(
    sortOrders(snap.docs.map(toOrder)),
    { fromCache: snap.metadata.fromCache },
  );
}

/**
 * 調理中・できあがりの注文（status in [preparing, ready]）の購読。(day, number) の昇順。
 * includeMetadataChanges：未送信（pending）の印と、fromCache の変化を受け取る。
 * Shell の階層で、イベントを選んでいる間は、常に購読する（data-access.md §5）
 */
export function watchActiveOrders(eventId: string, cb: (orders: Order[], meta: OrdersMeta) => void, onError: (e: AppError) => void): Unsubscribe {
  return onSnapshot(
    query(ordersCol(eventId), where('status', 'in', ['preparing', 'ready'])),
    { includeMetadataChanges: true },
    (snap) => handleSnapshot(snap, cb),
    (e) => onError(toAppError(e)),
  );
}

/** その日の注文（全状態）の購読。調理画面の「済みも表示」用 */
export function watchOrdersOfDay(eventId: string, day: string, cb: (orders: Order[], meta: OrdersMeta) => void, onError: (e: AppError) => void): Unsubscribe {
  return onSnapshot(
    query(ordersCol(eventId), where('day', '==', day)),
    { includeMetadataChanges: true },
    (snap) => handleSnapshot(snap, cb),
    (e) => onError(toAppError(e)),
  );
}

function validationError(message: string): AppError {
  return Object.assign(new AppError('validation'), { message });
}

const timeValue = (v: TimeValue) => (v === 'now' ? serverTimestamp() : null);

/**
 * 状態を変える（完成・渡した・取り消しなど。data-model.md §3）。できない遷移は、書く前に AppError('validation')。
 * 書き込みは、オフラインでも受け付ける（サーバーが受け取るまで、Promise は終わらない）。
 * 画面は待たずに進め、拒否されたとき（他のメンバーが先に別の操作をした場合など）に知らせる
 */
export function transitionOrder(eventId: string, order: Pick<Order, 'id' | 'status' | 'cancelledFrom'>, action: OrderAction, uid: string): Promise<void> {
  const patch = transitionPatch(order, action);
  if (!patch) return Promise.reject(validationError('その操作は、いまの状態ではできません'));
  const data: Record<string, unknown> = { status: patch.status, updatedBy: uid, updatedAt: serverTimestamp() };
  if (patch.cancelledFrom !== undefined) data.cancelledFrom = patch.cancelledFrom;
  if (patch.readyAt !== undefined) data.readyAt = timeValue(patch.readyAt);
  if (patch.doneAt !== undefined) data.doneAt = timeValue(patch.doneAt);
  if (patch.cancelledAt !== undefined) data.cancelledAt = timeValue(patch.cancelledAt);
  return updateDoc(doc(ordersCol(eventId), order.id), data).catch((e: unknown) => {
    throw toAppError(e);
  });
}

/** 支払い方法の変更（現金とPayPayの取り違えの訂正。状態は変えない）。オフラインでも受け付ける */
export function changePayment(eventId: string, orderId: string, payment: Payment, uid: string): Promise<void> {
  return updateDoc(doc(ordersCol(eventId), orderId), { payment, updatedBy: uid, updatedAt: serverTimestamp() }).catch((e: unknown) => {
    throw toAppError(e);
  });
}

/**
 * メモの変更（確定後も、調理画面のカードから。SPEC 4.3）。note は、normalizeNote 済みのもの（空にもできる）。
 * 状態は変えない。オフラインでも受け付ける。複数人が同時に直したときは、後から届いた方が勝つ
 */
export function changeNote(eventId: string, orderId: string, note: string, uid: string): Promise<void> {
  if (note.length > NOTE_MAX) return Promise.reject(validationError(`メモは${NOTE_MAX}文字までです`));
  return updateDoc(doc(ordersCol(eventId), orderId), { note, updatedBy: uid, updatedAt: serverTimestamp() }).catch((e: unknown) => {
    throw toAppError(e);
  });
}

/**
 * その日の注文を、**サーバーから**取得する（レジ締め用。キャッシュを使わない）。
 * 部分的なキャッシュで締めないため、通信できなければ AppError('offline')（8秒で応答がなければ、同じく offline）
 */
export async function fetchOrdersOfDayFromServer(eventId: string, day: string): Promise<Order[]> {
  try {
    const snap = await withTimeout(getDocsFromServer(query(ordersCol(eventId), where('day', '==', day))));
    return sortOrders(snap.docs.map(toOrder));
  } catch (e) {
    const err = toAppError(e);
    throw err.code === 'timeout' ? new AppError('offline', { cause: e }) : err;
  }
}

/**
 * その日の注文を取得する（売上用。`getDocs`：通信できればサーバー、できなければキャッシュ）。
 * `fromCache` が true のとき、一部の注文が欠けている可能性がある（画面に警告を出す）。常時購読はしない
 */
export async function fetchOrdersOfDay(eventId: string, day: string): Promise<{ orders: Order[]; fromCache: boolean }> {
  try {
    const snap = await getDocs(query(ordersCol(eventId), where('day', '==', day)));
    return { orders: sortOrders(snap.docs.map(toOrder)), fromCache: snap.metadata.fromCache };
  } catch (e) {
    throw toAppError(e);
  }
}
