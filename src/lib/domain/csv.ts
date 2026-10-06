// CSV（注文一覧）と、集計のテキスト（data-model.md §5.5、screens.md §3.6）。純粋関数
import { formatDay, type Day } from './day';
import { formatYen } from './order';
import type { OrderStatus, Payment } from './orderStatus';
import type { Summary } from './summary';

/** CSV に使う、注文の最小限の形 */
export interface CsvOrder {
  day: Day;
  number: number;
  status: OrderStatus;
  payment: Payment;
  total: number;
  items: { name: string; qty: number }[];
  note: string;
  createdAt: Date | null;
  readyAt: Date | null;
  doneAt: Date | null;
  cancelledAt: Date | null;
}

export const CSV_HEADER = ['日付', '番号', '状態', '支払い', '合計', '品目', 'メモ', '作成', '完成', '渡し', '取り消し'] as const;

const STATUS_LABEL: Record<OrderStatus, string> = { preparing: '調理中', ready: 'できあがり', done: 'お渡し済み', cancelled: '取り消し' };
const PAYMENT_LABEL: Record<Payment, string> = { cash: '現金', paypay: 'PayPay' };

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const formatTime = (d: Date | null) => (d ? timeFmt.format(d) : '');

/** 1つのセル：先頭が `= + - @`・タブ・`\r` なら、先頭に `'` を足し（表計算ソフトの式として実行されないように）、`"` で囲む */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** 注文一覧の CSV。UTF-8 の BOM 付き・CRLF。取り消しも含める（状態の列で区別する）。並べ替えはしない（呼び出し側の順） */
export function buildCsv(orders: readonly CsvOrder[]): string {
  const rows = orders.map((o) => [
    o.day,
    o.number,
    STATUS_LABEL[o.status],
    PAYMENT_LABEL[o.payment],
    o.total,
    o.items.map((i) => `${i.name}×${i.qty}`).join('; '),
    o.note,
    formatTime(o.createdAt),
    formatTime(o.readyAt),
    formatTime(o.doneAt),
    formatTime(o.cancelledAt),
  ]);
  const lines = [[...CSV_HEADER], ...rows].map((r) => r.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** `{イベント名}_{YYYY-MM-DD}_注文.csv`。イベント名の中の `/ \ : * ? " < > |` と制御文字は `_` にする */
export function csvFileName(eventName: string, day: Day): string {
  // eslint-disable-next-line no-control-regex
  const safe = eventName.replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '_').trim() || 'イベント';
  return `${safe}_${day}_注文.csv`;
}

/** 「集計をコピー」のテキスト（LINE などに貼れる形） */
export function buildSummaryText(eventName: string, day: Day, summary: Summary): string {
  const lines = [
    `${eventName} ${formatDay(day, { year: true })}の売上`,
    `現金：${formatYen(summary.cashTotal)}（${summary.cashCount}件）`,
    `PayPay：${formatYen(summary.paypayTotal)}（${summary.paypayCount}件）`,
    `合計：${formatYen(summary.grandTotal)}（${summary.grandCount}件）`,
  ];
  if (summary.byItem.length > 0) {
    lines.push('', 'メニュー別');
    for (const i of summary.byItem) lines.push(`${i.name} ${formatYen(i.price)}×${i.qty} ＝ ${formatYen(i.subtotal)}`);
  }
  return lines.join('\n');
}
