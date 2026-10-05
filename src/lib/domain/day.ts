// 日付（data-model.md：Day は Asia/Tokyo の暦日 'YYYY-MM-DD'）
export type Day = string;

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Asia/Tokyo の暦日（端末のタイムゾーンによらない） */
export function toDay(date: Date = new Date()): Day {
  return fmt.format(date); // en-CA は YYYY-MM-DD
}

/** 'YYYY-MM-DD' の形で、実在する日付か */
export function isValidDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** '2026-08-01' → '8月1日（土）'。year：年も付ける */
export function formatDay(day: Day, { year = false } = {}): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const w = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${year ? `${y}年` : ''}${m}月${d}日（${w}）`;
}

/** イベントの期間。同じ日なら1つだけ */
export function formatDayRange(start: Day, end: Day): string {
  return start === end ? formatDay(start) : `${formatDay(start)}〜${formatDay(end)}`;
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** 日時（Asia/Tokyo）。'8月1日（土）14:05' */
export function formatDateTime(date: Date): string {
  return `${formatDay(toDay(date))}${timeFmt.format(date)}`;
}
