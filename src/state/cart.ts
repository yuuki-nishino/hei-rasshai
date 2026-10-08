// 注文のカート（screens.md §3.4）。タブを切り替えても消えないよう、メモリ上の共有の状態に置く（再読み込みでは消える）。
// イベントを変えたら空にする。QRの発行は、カートの中身から自動で決める（調理が必要な商品があればオン。#52）。手で変えたら、その選択を使う
import { computed, effect, signal } from '@preact/signals';
import type { Payment } from '../lib/data/types';
import {
  addToCart,
  applyCurrentPrice,
  calcTotal,
  changeQty,
  removeLine,
  type CartAddResult,
  type CartLine,
  type CartMenuItem,
} from '../lib/domain/order';
import { defaultQr } from '../lib/domain/cooking';
import { currentEventId } from './event';

export const cartLines = signal<CartLine[]>([]);
export const payment = signal<Payment>('cash');
/** お預りの入力（文字のまま。parseTendered で読む） */
export const tenderedText = signal('');
/** メモの入力（文字のまま。normalizeNote で整える） */
export const noteText = signal('');
/** QRの手での選択（null＝自動）。カートの「調理が必要か」が変わったときと、カートを空にしたときに、自動へ戻す */
const qrChoice = signal<boolean | null>(null);
export const qr = computed(() => qrChoice.value ?? defaultQr(cartLines.value));

export const cartTotal = computed(() => calcTotal(cartLines.value));

export function setQr(on: boolean): void {
  qrChoice.value = on;
}

/** カートの行を置き換える。調理が必要かどうかが変わったら、QRの選択を自動へ戻す（食べ物を足したのに、QRなしのまま、にならないように） */
function setLines(next: CartLine[]): void {
  if (defaultQr(cartLines.peek()) !== defaultQr(next)) qrChoice.value = null;
  cartLines.value = next;
}

/** カートを空にする（クリア・確定の後・イベントの切り替え） */
export function clearCart(): void {
  cartLines.value = [];
  qrChoice.value = null;
  payment.value = 'cash';
  tenderedText.value = '';
  noteText.value = '';
}

let cartEventId = currentEventId.peek();
effect(() => {
  const id = currentEventId.value;
  if (id !== cartEventId) {
    cartEventId = id;
    clearCart();
  }
});

// カートの操作（画面から呼ぶ）
export function addItemToCart(item: CartMenuItem): CartAddResult {
  const r = addToCart(cartLines.peek(), item);
  if (r.ok) setLines(r.lines);
  return r;
}

export function changeLineQty(menuId: string, delta: number): void {
  setLines(changeQty(cartLines.peek(), menuId, delta));
}

export function removeCartLine(menuId: string): void {
  setLines(removeLine(cartLines.peek(), menuId));
}

/** 「現在の価格にする」 */
export function applyLineCurrentPrice(menuId: string, menu: readonly CartMenuItem[]): void {
  setLines(applyCurrentPrice(cartLines.peek(), menuId, menu));
}

export function setPayment(p: Payment): void {
  payment.value = p;
}

export function setTendered(text: string): void {
  tenderedText.value = text;
}

export function setNote(text: string): void {
  noteText.value = text;
}
