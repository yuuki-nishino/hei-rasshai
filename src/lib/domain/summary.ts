// 売上の集計（data-model.md §5.2）。ある日の全注文から、現金・PayPay・メニュー別を出す。純粋関数
import type { Day } from './day';
import type { OrderStatus, Payment } from './orderStatus';

/** 集計に使う、注文の最小限の形 */
export interface SummaryOrder {
  day: Day;
  number: number;
  status: OrderStatus;
  payment: Payment;
  total: number;
  items: { menuId: string; name: string; price: number; qty: number }[];
  createdAt: Date | null;
}

export interface ItemSummary {
  /** `menuId|price`。同じメニューでも、注文時の価格が違えば、別の行（途中で価格を変えても、過去分は変わらない） */
  key: string;
  menuId: string;
  /** そのキーの注文のうち、最も新しい注文の名前（途中で名前を直したときは、新しい名前に寄せる） */
  name: string;
  price: number;
  qty: number;
  subtotal: number;
}

export interface Summary {
  cashTotal: number;
  cashCount: number;
  paypayTotal: number;
  paypayCount: number;
  grandTotal: number;
  grandCount: number;
  /** subtotal の降順、同額なら name の順 */
  byItem: ItemSummary[];
}

/** a が b より新しいか（作成時刻。同じ・未確定なら、番号の大きい方） */
function isNewer(a: SummaryOrder, b: SummaryOrder): boolean {
  const ta = a.createdAt?.getTime() ?? Number.POSITIVE_INFINITY; // 未確定（書き込み直後）は、最も新しい
  const tb = b.createdAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta > tb;
  return a.day === b.day ? a.number > b.number : a.day > b.day;
}

/** 売上集計。取り消し（status = 'cancelled'）を除外してから集計する */
export function summarize(orders: readonly SummaryOrder[]): Summary {
  const summary: Summary = { cashTotal: 0, cashCount: 0, paypayTotal: 0, paypayCount: 0, grandTotal: 0, grandCount: 0, byItem: [] };
  const items = new Map<string, ItemSummary>();
  const newest = new Map<string, SummaryOrder>(); // キーごとの、名前を採る注文

  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    if (o.payment === 'cash') {
      summary.cashTotal += o.total;
      summary.cashCount++;
    } else {
      summary.paypayTotal += o.total;
      summary.paypayCount++;
    }
    for (const line of o.items) {
      const key = `${line.menuId}|${line.price}`;
      const row = items.get(key) ?? { key, menuId: line.menuId, name: line.name, price: line.price, qty: 0, subtotal: 0 };
      row.qty += line.qty;
      row.subtotal = row.price * row.qty;
      const prev = newest.get(key);
      if (!prev || isNewer(o, prev)) {
        newest.set(key, o);
        row.name = line.name;
      }
      items.set(key, row);
    }
  }
  summary.grandTotal = summary.cashTotal + summary.paypayTotal;
  summary.grandCount = summary.cashCount + summary.paypayCount;
  summary.byItem = [...items.values()].sort((a, b) => b.subtotal - a.subtotal || a.name.localeCompare(b.name, 'ja') || a.key.localeCompare(b.key));
  return summary;
}
