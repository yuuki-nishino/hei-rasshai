// 注文の確定フロー（order-confirm.md）。状態は reducer（lib/domain/confirmFlow.ts）、動かすのは confirmRunner.ts。
// ここでは、データアクセスとつなぎ、確定できたらカートを空にする。
// pending の保存・起動時の復元・自動の再確認は #14
import { signal } from '@preact/signals';
import { confirmOrder, newOrderId, voidExistsOnServer, voidOrFind } from '../lib/data/orders';
import type { Order } from '../lib/data/types';
import { initialConfirmState, type ConfirmContext, type ConfirmedOrder, type ConfirmState } from '../lib/domain/confirmFlow';
import { toDay } from '../lib/domain/day';
import { parseTendered } from '../lib/domain/order';
import { cartLines, cartTotal, clearCart, payment, qr, tenderedText } from './cart';
import { createConfirmRunner } from './confirmRunner';

export const confirmState = signal<ConfirmState>(initialConfirmState);

const toConfirmed = (o: Order): ConfirmedOrder => ({ orderId: o.id, number: o.number, day: o.day, total: o.total, qr: o.qr });

let runner: ReturnType<typeof createConfirmRunner> | null = null;
let runnerKey = '';

function runnerFor(eventId: string, uid: string) {
  const key = `${eventId}/${uid}`;
  if (!runner || runnerKey !== key) {
    runnerKey = key;
    runner = createConfirmRunner(
      {
        confirmOrder: async (ctx) => toConfirmed(await confirmOrder(eventId, ctx, uid)),
        voidOrFind: async (orderId) => {
          const r = await voidOrFind(eventId, orderId, uid);
          return r.result === 'found' ? { result: 'found', order: toConfirmed(r.order) } : r;
        },
        voidExists: (orderId) => voidExistsOnServer(eventId, orderId),
      },
      {
        get: () => confirmState.peek(),
        set: (s) => {
          // 確定できた（または、登録されていた）ら、カートを空にする
          if (s.kind === 'done' && confirmState.peek().kind !== 'done') clearCart();
          confirmState.value = s;
        },
      },
    );
  }
  return runner;
}

/** いまのカートで確定を始める。始められなければ false（送信中など） */
export function startConfirm(eventId: string, uid: string): boolean {
  if (cartLines.peek().length === 0) return false;
  return runnerFor(eventId, uid).submit(newContext(eventId));
}

/** 墓標で拒否された注文を、同じ品目のまま、新しい orderId で確定し直す（order-confirm.md §5.1） */
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
export const recheckConfirm = (eventId: string, uid: string) => runnerFor(eventId, uid).recheck();
export const dismissConfirm = () => runner?.dismiss();
export const closeConfirm = () => runner?.close();
