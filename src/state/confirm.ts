// 注文の確定フロー（order-confirm.md）。状態は reducer（lib/domain/confirmFlow.ts）、動かすのは confirmRunner.ts。
// ここでは、データアクセス・端末の保存（hei:pending:{eventId}）とつなぎ、確定できたらカートを空にする。
// 確認できない（unverifiable）の間は、15秒ごと・online イベントで、自動で確かめ直す（§5.4）。
// 接続状態（fromCache の解消）をきっかけにするのは、接続状態を作る #19 で足す
import { effect, signal } from '@preact/signals';
import { confirmOrder, findOrderOnServer, newOrderId, voidExistsOnServer, voidOrFind } from '../lib/data/orders';
import type { Order } from '../lib/data/types';
import { initialConfirmState, type ConfirmContext, type ConfirmedOrder, type ConfirmState } from '../lib/domain/confirmFlow';
import { toDay } from '../lib/domain/day';
import { parseTendered } from '../lib/domain/order';
import { cartLines, cartTotal, clearCart, payment, qr, tenderedText } from './cart';
import { createConfirmRunner, type PendingRecord } from './confirmRunner';
import { currentEventId } from './event';
import { readStorage, writeStorage } from './storage';

export const RECHECK_INTERVAL_MS = 15_000;

export const confirmState = signal<ConfirmState>(initialConfirmState);
/** 手動の「もう一度確認」を、裏の処理の途中で押した（「確認中です」と出す） */
export const recheckBusy = signal(false);

const toConfirmed = (o: Order): ConfirmedOrder => ({ orderId: o.id, number: o.number, day: o.day, total: o.total, qr: o.qr });

const pendingKey = (eventId: string) => `hei:pending:${eventId}`;

/** 端末に残っている、確定の途中の記録 */
export function readPending(eventId: string): PendingRecord | null {
  try {
    const raw = readStorage(pendingKey(eventId));
    const p = raw ? (JSON.parse(raw) as PendingRecord) : null;
    return p && typeof p.ctx?.orderId === 'string' && Array.isArray(p.ctx.draft?.items) ? p : null;
  } catch {
    return null;
  }
}

let runner: ReturnType<typeof createConfirmRunner> | null = null;
let runnerKey = '';

function runnerFor(eventId: string, uid: string) {
  const key = `${eventId}/${uid}`;
  if (!runner || runnerKey !== key) {
    runnerKey = key;
    confirmState.value = initialConfirmState; // 別のイベントの確定の状態を、持ち込まない
    runner = createConfirmRunner(
      {
        confirmOrder: async (ctx) => toConfirmed(await confirmOrder(eventId, ctx, uid)),
        voidOrFind: async (orderId) => {
          const r = await voidOrFind(eventId, orderId, uid);
          return r.result === 'found' ? { result: 'found', order: toConfirmed(r.order) } : r;
        },
        voidExists: (orderId) => voidExistsOnServer(eventId, orderId),
        findOrder: async (orderId) => {
          const o = await findOrderOnServer(eventId, orderId);
          return o && toConfirmed(o);
        },
        pending: {
          save: (p) => writeStorage(pendingKey(eventId), JSON.stringify(p)),
          clear: () => writeStorage(pendingKey(eventId), null),
        },
      },
      {
        get: () => confirmState.peek(),
        set: (s) => {
          // 確定できた（または、登録されていた）ら、カートを空にする
          if (s.kind === 'done' && confirmState.peek().kind !== 'done') clearCart();
          if (s.kind !== 'unverifiable') recheckBusy.value = false;
          confirmState.value = s;
        },
      },
    );
  }
  return runner;
}

/**
 * イベントに入ったとき（と、ログインし直したとき）：端末に確定の途中の記録が残っていれば、確かめる（order-confirm.md §5.3）
 */
export function resumePending(eventId: string, uid: string): void {
  const r = runnerFor(eventId, uid);
  const p = readPending(eventId);
  if (p) r.restore(p);
}

/** いまのカートで確定を始める。始められなければ false（送信中・前の注文の確認中など） */
export function startConfirm(eventId: string, uid: string): boolean {
  if (cartLines.peek().length === 0 || readPending(eventId)) return false;
  return runnerFor(eventId, uid).submit(newContext(eventId));
}

/** 墓標で拒否された注文を、同じ品目のまま、新しい orderId で確定し直す（order-confirm.md §5.1。古い pending は置き換わる） */
export function resubmitWithNewId(eventId: string, uid: string): void {
  const s = confirmState.peek();
  if (s.kind !== 'failed' || s.reason !== 'voided') return;
  runnerFor(eventId, uid).submit({ ...s.ctx, orderId: newOrderId(eventId), day: toDay() });
}

function newContext(eventId: string): ConfirmContext {
  const items = cartLines.peek().map((l) => ({ ...l }));
  return {
    orderId: newOrderId(eventId),
    day: toDay(), // 確定ボタンの時点の日付。再試行でも変えない
    draft: { items, total: cartTotal.peek(), payment: payment.peek(), qr: qr.peek() },
    tendered: payment.peek() === 'cash' ? (parseTendered(tenderedText.peek()) ?? 0) : 0,
  };
}

export const retryConfirm = (eventId: string, uid: string) => runnerFor(eventId, uid).retry();
export const abandonConfirm = (eventId: string, uid: string) => runnerFor(eventId, uid).abandon();
/** 手動の「もう一度確認」。裏の処理の途中なら「確認中です」 */
export function recheckConfirm(eventId: string, uid: string): void {
  recheckBusy.value = runnerFor(eventId, uid).recheck() === 'busy';
}
export const dismissConfirm = () => runner?.dismiss();
export const closeConfirm = () => runner?.close();

// 確認できない間は、15秒ごとと、online イベントで、自動で確かめ直す（電波が弱いだけだと online は出ないため、時間でも試す）
const kick = () => runner?.kick();
if (typeof window !== 'undefined') window.addEventListener('online', kick);
effect(() => {
  if (confirmState.value.kind !== 'unverifiable') return;
  const id = setInterval(kick, RECHECK_INTERVAL_MS);
  return () => clearInterval(id);
});

// イベントを離れたら、確定の状態を持ち越さない（記録は端末に残り、戻ったときに確かめる）
effect(() => {
  const id = currentEventId.value;
  if (runner && !runnerKey.startsWith(`${id}/`)) {
    runner = null;
    runnerKey = '';
    confirmState.value = initialConfirmState;
  }
});
