// 注文（data-access.md §3.5、order-confirm.md §5）
import {
  collection,
  doc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  type DocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore';
import type { ConfirmContext } from '../domain/confirmFlow';
import { db } from '../firebase/staff';
import { toAppError } from './errors';
import type { Order, OrderLine } from './types';

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
    items: (d.items as OrderLine[]).map((i) => ({ menuId: i.menuId, name: i.name, price: i.price, qty: i.qty })),
    total: d.total,
    payment: d.payment,
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
  const lines = items.map((i) => ({ menuId: i.menuId, name: i.name, price: i.price, qty: i.qty }));
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
