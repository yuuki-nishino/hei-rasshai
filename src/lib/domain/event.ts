// イベントの入力の検査と、メンバーの表示名（data-model.md §2.2・§2.3、data-access.md §3.9）
import { isValidDay, type Day } from './day';

export interface EventInput {
  name: string;
  startDate: Day;
  endDate: Day;
  floatCash: number;
}

/** 作成フォームの入力（文字列のまま） */
export interface EventForm {
  name: string;
  startDate: string;
  endDate: string;
  floatCash: string;
}

export type EventFormErrors = Partial<Record<keyof EventForm, string>>;

export const EVENT_NAME_MAX = 60;
export const FLOAT_CASH_MAX = 10_000_000; // firestore.rules の validEvent と合わせる

/** ルール（validEvent）と同じ条件で検査する。全角数字・桁区切りのカンマは受け付ける。
 * 文字数は、ルールの size() と同じく UTF-16 の単位（JavaScript の length）で数える（#7 で Emulator で確認） */
export function validateEventForm(form: EventForm): { ok: true; value: EventInput } | { ok: false; errors: EventFormErrors } {
  const errors: EventFormErrors = {};
  const name = form.name.trim();
  // 長さは、ルールの size() と同じく UTF-16 の単位で数える（絵文字の多くは2文字になる）
  if (name.length === 0) errors.name = 'イベント名を入れてください';
  else if (name.length > EVENT_NAME_MAX) errors.name = `イベント名は${EVENT_NAME_MAX}文字までです`;

  if (!isValidDay(form.startDate)) errors.startDate = '開始日を選んでください';
  if (!isValidDay(form.endDate)) errors.endDate = '終了日を選んでください';
  else if (!errors.startDate && form.endDate < form.startDate) errors.endDate = '終了日は、開始日以降にしてください';

  const cashText = form.floatCash
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s]/g, '');
  const floatCash = cashText === '' ? 0 : Number(cashText);
  if (!/^\d*$/.test(cashText) || !Number.isSafeInteger(floatCash) || floatCash > FLOAT_CASH_MAX) {
    errors.floatCash = `0円から${FLOAT_CASH_MAX.toLocaleString('ja-JP')}円の整数で入れてください`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, startDate: form.startDate, endDate: form.endDate, floatCash } };
}

/**
 * 選んでいるイベントから、外れたか（PR #32 のレビュー E1）。サーバーで確かめた一覧（fromCache = false）で、
 * 自分の members が無いときだけ true（イベントが消された・メンバーから外された・別のアカウントでログインした）。
 * 表示用の一覧ではなく members で見るのは、イベントの取得の一時的な失敗で、選択を外さないため
 */
export function isSelectionGone(selectedId: string | null, meta: { fromCache: boolean; memberOf: readonly string[] }): boolean {
  return selectedId !== null && !meta.fromCache && !meta.memberOf.includes(selectedId);
}

export const DISPLAY_NAME_MAX = 60;

/**
 * members の displayName（data-access.md §3.9）。Googleの表示名の前後の空白を除いて使い、
 * 無い・空ならメールの @ より前。60文字を超えたら切り詰める（ルールが61文字以上を拒否するため）。
 * 文字数は、ルールと同じく UTF-16 の単位。絵文字（サロゲートペア）の途中では切らない
 */
export function memberDisplayName(user: { displayName: string | null; email: string | null }): string {
  const name = user.displayName?.trim() || (user.email ?? '').split('@')[0] || '';
  let out = '';
  for (const ch of name) {
    if (out.length + ch.length > DISPLAY_NAME_MAX) break;
    out += ch;
  }
  return out;
}
