// 注文のカートと金額（screens.md §3.4、data-model.md §2.6）
import { PRICE_MAX } from './menu';

export const ORDER_LINES_MAX = 50; // 1注文の行数（ルールと同じ）
export const QTY_MAX = 99; // 1行の数量（data-model.md §2.6）
/** お預りの上限：ありうる合計の最大（100,000円 × 99個 × 50品）。「ちょうど」が、どの合計でも入るように（PR #38 のレビュー C1） */
export const TENDERED_MAX = PRICE_MAX * QTY_MAX * ORDER_LINES_MAX;

/** カートの1行。カートに入れた時点の名前・価格を持つ（保存する items と同じ形） */
export interface CartLine {
  menuId: string;
  name: string;
  price: number;
  qty: number;
}

/** カートの計算に使う、メニューの最小限の形 */
export interface CartMenuItem {
  id: string;
  name: string;
  price: number;
  soldOut: boolean;
}

/** 合計：Σ price × qty（カートの保持する価格。保存される items と、必ず一致する） */
export function calcTotal(lines: readonly Pick<CartLine, 'price' | 'qty'>[]): number {
  return lines.reduce((sum, l) => sum + l.price * l.qty, 0);
}

/** お釣り：お預り − 合計。負なら不足 */
export function calcChange(total: number, tendered: number): number {
  return tendered - total;
}

export type CartAddResult = { ok: true; lines: CartLine[] } | { ok: false; reason: 'soldOut' | 'qtyMax' | 'linesMax' };

/**
 * メニューをタップ：数量 +1。すでにカートにある行は、その行の名前・価格のまま（現在の価格に変えない）。
 * 売り切れは追加しない。数量は99まで、行は50まで
 */
export function addToCart(lines: readonly CartLine[], item: CartMenuItem): CartAddResult {
  if (item.soldOut) return { ok: false, reason: 'soldOut' };
  const i = lines.findIndex((l) => l.menuId === item.id);
  if (i >= 0) {
    if (lines[i]!.qty >= QTY_MAX) return { ok: false, reason: 'qtyMax' };
    return { ok: true, lines: lines.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l)) };
  }
  if (lines.length >= ORDER_LINES_MAX) return { ok: false, reason: 'linesMax' };
  return { ok: true, lines: [...lines, { menuId: item.id, name: item.name, price: item.price, qty: 1 }] };
}

/** 数量の増減。0以下になったら行を消す。99を超えない */
export function changeQty(lines: readonly CartLine[], menuId: string, delta: number): CartLine[] {
  return lines
    .map((l) => (l.menuId === menuId ? { ...l, qty: Math.min(QTY_MAX, l.qty + delta) } : l))
    .filter((l) => l.qty > 0);
}

export function removeLine(lines: readonly CartLine[], menuId: string): CartLine[] {
  return lines.filter((l) => l.menuId !== menuId);
}

/** 行の、いまのメニューとの違い（カートに入れた後で、メニューが変わった場合） */
export interface LineNotice {
  /** 価格が変わった：いまの価格（変わっていなければ null） */
  currentPrice: number | null;
  soldOut: boolean;
  /** メニューから削除された（カートの名前・価格のまま確定できる） */
  deleted: boolean;
}

export function lineNotice(line: CartLine, menu: readonly CartMenuItem[]): LineNotice {
  const m = menu.find((x) => x.id === line.menuId);
  if (!m) return { currentPrice: null, soldOut: false, deleted: true };
  return { currentPrice: m.price !== line.price ? m.price : null, soldOut: m.soldOut, deleted: false };
}

/** 「現在の価格にする」：その行の名前・価格を、いまのメニューに合わせる */
export function applyCurrentPrice(lines: readonly CartLine[], menuId: string, menu: readonly CartMenuItem[]): CartLine[] {
  const m = menu.find((x) => x.id === menuId);
  return m ? lines.map((l) => (l.menuId === menuId ? { ...l, name: m.name, price: m.price } : l)) : [...lines];
}

/** お預りの入力：0以上の整数（全角数字・3桁ごとのカンマ・「円」「¥」を受け付ける）。空は0。不正なら null */
export function parseTendered(input: string): number | null {
  const text = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ',')
    .replace(/\s/g, '')
    .replace(/^[¥￥]/, '')
    .replace(/円$/, '');
  if (text === '') return 0;
  if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(text)) return null;
  const n = Number(text.replace(/,/g, ''));
  return Number.isSafeInteger(n) && n <= TENDERED_MAX ? n : null;
}

/** 金額の表示：¥1,200 */
export function formatYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}
