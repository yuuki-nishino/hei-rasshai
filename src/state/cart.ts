// 注文のカート（screens.md §3.4）。タブを切り替えても消えないよう、メモリ上の共有の状態に置く（再読み込みでは消える）。
// イベントを変えたら空にする。QRの発行の選択は、hei:qr に保存する
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
import { currentEventId } from './event';
import { readStorage, writeStorage } from './storage';

export const cartLines = signal<CartLine[]>([]);
export const payment = signal<Payment>('cash');
/** お預りの入力（文字のまま。parseTendered で読む） */
export const tenderedText = signal('');
export const qr = signal(readStorage('hei:qr') !== 'false'); // 初期値は「発行する」

export const cartTotal = computed(() => calcTotal(cartLines.value));

export function setQr(on: boolean): void {
  qr.value = on;
  writeStorage('hei:qr', String(on));
}

/** カートを空にする（クリア・確定の後・イベントの切り替え）。QR の選択は残す */
export function clearCart(): void {
  cartLines.value = [];
  payment.value = 'cash';
  tenderedText.value = '';
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
  if (r.ok) cartLines.value = r.lines;
  return r;
}

export function changeLineQty(menuId: string, delta: number): void {
  cartLines.value = changeQty(cartLines.peek(), menuId, delta);
}

export function removeCartLine(menuId: string): void {
  cartLines.value = removeLine(cartLines.peek(), menuId);
}

/** 「現在の価格にする」 */
export function applyLineCurrentPrice(menuId: string, menu: readonly CartMenuItem[]): void {
  cartLines.value = applyCurrentPrice(cartLines.peek(), menuId, menu);
}

export function setPayment(p: Payment): void {
  payment.value = p;
}

export function setTendered(text: string): void {
  tenderedText.value = text;
}
