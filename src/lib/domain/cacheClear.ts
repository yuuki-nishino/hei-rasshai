// メンバーでなくなったときの、端末のキャッシュの消去の判断（data-access.md §8）
export const CACHE_CLEAR_ASK_AFTER_MS = 24 * 60 * 60 * 1000;

/** 消去待ちの印（localStorage の hei:clearPending） */
export interface ClearPendingMark {
  /** 最初に消去が必要になった時刻（ms） */
  since: number;
  /** 外れたイベント。消去までは、一覧に出さず、開けない */
  events: string[];
}

export type CacheClearDecision = 'none' | 'clear' | 'defer' | 'ask';

/**
 * - 印が無い → none
 * - 未送信が無い → clear（すぐ消す）
 * - 未送信があり、24時間未満 → defer（持ち越す。未送信が送られるのを待つ）
 * - 未送信が、24時間たっても残る → ask（外されたイベントの未送信は、どのみち拒否されるため、待ち続けることがある。消してよいか確かめる）
 */
export function decideCacheClear(mark: ClearPendingMark | null, now: number, pending: boolean): CacheClearDecision {
  if (!mark) return 'none';
  if (!pending) return 'clear';
  return now - mark.since >= CACHE_CLEAR_ASK_AFTER_MS ? 'ask' : 'defer';
}

/** 前に見ていたイベントのうち、サーバーで確かめた自分の members から消えたもの（外された・抜けた・イベントが消えた） */
export function lostMemberships(known: readonly string[], memberOf: readonly string[]): string[] {
  return known.filter((id) => !memberOf.includes(id));
}

/** 印に、外れたイベントを足す（時刻は、最初のものを残す） */
export function mergeClearMark(mark: ClearPendingMark | null, events: readonly string[], now: number): ClearPendingMark {
  return { since: mark?.since ?? now, events: [...new Set([...(mark?.events ?? []), ...events])] };
}

/**
 * サーバーで、もう一度メンバーだと確かめられたイベントを、印から外す（参加し直した場合。PR #34 のレビュー K3）。
 * 空になったら null（消去は要らない）
 */
export function pruneClearMark(mark: ClearPendingMark | null, memberOf: readonly string[]): ClearPendingMark | null {
  if (!mark) return null;
  const events = mark.events.filter((id) => !memberOf.includes(id));
  return events.length === 0 ? null : { ...mark, events };
}
