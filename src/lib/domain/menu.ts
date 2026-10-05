// メニュー（data-model.md §2.5、data-access.md §3.4）
export const MENU_MAX = 100;
export const MENU_NAME_MAX = 40;
export const PRICE_MIN = 1;
export const PRICE_MAX = 100_000;
export const ORDER_STEP = 10;

/** 並べ替えに使う最小限の形 */
export interface MenuOrderItem {
  id: string;
  order: number;
}

/** 名前：前後の空白を除き、1〜40文字（ルールと同じく UTF-16 の単位で数える）。不正なら null */
export function parseMenuName(input: string): string | null {
  const name = input.trim();
  return name.length >= 1 && name.length <= MENU_NAME_MAX ? name : null;
}

/** 価格：1〜100,000 の整数。全角数字・3桁ごとのカンマ・「円」「¥」を受け付ける。不正なら null */
export function parsePrice(input: string): number | null {
  const text = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ',')
    .replace(/\s/g, '')
    .replace(/^[¥￥]/, '')
    .replace(/円$/, '');
  // カンマは、3桁ごとの区切りだけを受け付ける（「1,000」は通り、「1,00」は通らない。PR #36 のレビュー M7）
  if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(text)) return null;
  const digits = text.replace(/,/g, '');
  const price = Number(digits);
  return Number.isSafeInteger(price) && price >= PRICE_MIN && price <= PRICE_MAX ? price : null;
}

export const MENU_NAME_ERROR = `名前は1〜${MENU_NAME_MAX}文字で入れてください`;
export const PRICE_ERROR = `価格は${PRICE_MIN}〜${PRICE_MAX.toLocaleString('ja-JP')}円の整数で入れてください`;

/** 表示の順：order の昇順、同じ値なら id の順（端末によらず、決まった順になる） */
export function sortMenu<T extends MenuOrderItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 追加する品の order：最大 + 10（空なら 10） */
export function nextMenuOrder(items: readonly MenuOrderItem[]): number {
  return items.reduce((max, i) => Math.max(max, i.order), 0) + ORDER_STEP;
}

/**
 * id の品を、上・下へ1つ動かし、全件の order を 10, 20, 30… に振り直す（同じ値になっていても動く）。
 * 書き換えが要る品だけを返す。端で動かせないとき・見つからないときは []
 */
export function reorderMenu(items: readonly MenuOrderItem[], id: string, dir: 'up' | 'down'): { id: string; order: number }[] {
  const sorted = sortMenu(items);
  const i = sorted.findIndex((x) => x.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= sorted.length) return [];
  [sorted[i], sorted[j]] = [sorted[j]!, sorted[i]!];
  return sorted.map((x, k) => ({ id: x.id, order: (k + 1) * ORDER_STEP, before: x.order })).filter((x) => x.order !== x.before).map(({ id, order }) => ({ id, order }));
}

/** まとめて追加の1行（data-model.md §5.6） */
export interface ParsedLine {
  /** 行番号（1から） */
  line: number;
  name: string;
  price: number;
}

export interface BulkMenuResult {
  ok: ParsedLine[];
  errors: { line: number; text: string; reason: string }[];
}

/** 全角の数字・空白（U+3000）・カンマ・コロン・円記号を、半角にそろえる */
function normalizeBulkLine(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/，/g, ',')
    .replace(/：/g, ':')
    .replace(/￥/g, '¥');
}

// 行末の「任意の ¥（後ろに空白があってもよい）＋ 数字 ＋ 任意の 円」を価格、その前を名前とする。区切りは、空白・カンマ・コロン。
// 数字は、3桁ごとのカンマ（1,000）か、カンマなし（1000）だけ。正規化した文に使う
const PRICE = String.raw`(?:¥\s*)?(\d{1,3}(?:,\d{3})+|\d+)\s*円?`;
const BULK_LINE = new RegExp(String.raw`^(.+?)([\s,:]+)${PRICE}$`);
const PRICE_ONLY = new RegExp(`^${PRICE}$`);
const PRICE_TAIL = new RegExp(`${PRICE}$`);
// 行頭の箇条書きの記号（メモからの貼り付け）
const BULLET = /^[-*•・]\s*/;

/**
 * メニューのまとめて追加（data-model.md §5.6）。1行に「名前 価格」。空行は無視する。
 * エラー行は、行番号と理由を返す（エラーがある間は、追加しない）。
 * 正規化（全角 → 半角）は、区切りと価格を見つけるためだけに使い、品名は元の文のまま取り出す（PR #37 のレビュー B3）
 */
export function parseBulkMenu(text: string): BulkMenuResult {
  const result: BulkMenuResult = { ok: [], errors: [] };
  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim().replace(BULLET, '');
    if (t === '') return;
    const s = normalizeBulkLine(t); // 1文字 → 1文字の置き換えなので、t と同じ長さ（位置で、元の文を切り出せる）
    const err = (reason: string) => result.errors.push({ line, text: raw.trim(), reason });
    if (PRICE_ONLY.test(s)) return err('品名がありません');
    const m = BULK_LINE.exec(s);
    if (!m) {
      // 価格の形はあるのに、品名との間に区切りが無い（「焼きそば600円」。レビュー B4）
      return err(PRICE_TAIL.test(s) ? '品名と価格の間に、空白かカンマを入れてください' : '価格がありません（「品名 価格」の形で書いてください）');
    }
    const [, nameNorm, sep, priceText] = m as unknown as [string, string, string, string];
    // 「ポテト1,500」：3桁区切りのカンマを、区切りと読んでしまう。品名の末尾の数字と価格をつなぐと3桁区切りになるなら、エラー（レビュー B1）
    if (/^,+$/.test(sep) && !s.slice(nameNorm.length + sep.length).startsWith('¥')) {
      const tail = /\d{1,3}$/.exec(nameNorm)?.[0];
      if (tail && /^\d{1,3}(?:,\d{3})+$/.test(`${tail},${priceText}`)) {
        return err('品名と価格の間に、空白を入れてください（「ポテト1,500」は、品名「ポテト1」500円と読めてしまうため）');
      }
    }
    const name = parseMenuName(t.slice(0, nameNorm.length));
    const price = Number(priceText.replace(/,/g, ''));
    if (name === null) err(`品名は${MENU_NAME_MAX}文字までです`);
    else if (!(price >= PRICE_MIN && price <= PRICE_MAX)) err(`価格は${PRICE_MIN}〜${PRICE_MAX.toLocaleString('ja-JP')}円にしてください`);
    else result.ok.push({ line, name, price });
  });
  return result;
}
