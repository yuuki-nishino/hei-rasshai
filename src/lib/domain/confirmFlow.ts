// 注文の確定フローの状態遷移（order-confirm.md §4）。純粋な関数（reducer）。
// 副作用（Firestore・タイマー・localStorage）は外側（state/confirm.ts）で行う
import type { Day } from './day';
import type { CartLine } from './order';

/** 確定ボタンの時点で固定する、カートの内容（order-confirm.md §3 の draft） */
export interface ConfirmDraft {
  items: CartLine[];
  total: number;
  payment: 'cash' | 'paypay';
  qr: boolean;
}

/** 1回の確定の文脈。再試行でも orderId・day は変えない */
export interface ConfirmContext {
  orderId: string;
  day: Day;
  draft: ConfirmDraft;
  /** お預り（現金のとき。お釣りの表示用で、保存しない） */
  tendered: number;
}

/** 確定できた（または、登録されていた）注文の、画面に出す情報 */
export interface ConfirmedOrder {
  orderId: string;
  number: number;
  day: Day;
  total: number;
  qr: boolean;
}

/** 送れなかった理由（order-confirm.md §6）。voided：墓標があり、この注文IDでは登録できない（§5.1） */
export type FailReason = 'offline' | 'timeout' | 'permission' | 'conflict' | 'voided';

export type ConfirmState =
  /** notice：voided＝やめた扱いにした。blocked＝このイベントでは、いま注文を登録できない（メンバーでない・削除中。PR #39 のレビュー C3） */
  | { kind: 'idle'; notice: 'voided' | 'blocked' | null }
  | { kind: 'submitting'; ctx: ConfirmContext }
  | { kind: 'failed'; ctx: ConfirmContext; reason: FailReason }
  | { kind: 'abandoning'; ctx: ConfirmContext }
  | { kind: 'unverifiable'; ctx: ConfirmContext }
  | { kind: 'decide'; ctx: ConfirmContext }
  | { kind: 'done'; ctx: ConfirmContext; order: ConfirmedOrder; recovered: boolean };

export type ConfirmEvent =
  /** 確定を押す（idle・decide から）。voided の後に、新しい orderId で確定し直すときも */
  | { type: 'submit'; ctx: ConfirmContext }
  /** もう一度試す（failed・decide から。同じ orderId） */
  | { type: 'retry' }
  | { type: 'succeeded'; order: ConfirmedOrder }
  | { type: 'failed'; reason: FailReason }
  /** やめる（failed・decide から）→ void-or-find */
  | { type: 'abandon' }
  /** やめた扱いと分かっている注文（failed・voided）を、問い合わせずに閉じる。カートは残す（PR #39 のレビュー C1） */
  | { type: 'dismiss' }
  /** やめる処理が、権限で断られた（メンバーでない・削除中）。注文は登録されていない（注文は誰でも1件読めるので、voidOrFind がサーバーで無いと確かめた。PR #39 の再レビュー R2） */
  | { type: 'blocked' }
  /** void-or-find の結果 */
  | { type: 'found'; order: ConfirmedOrder }
  | { type: 'voided' }
  | { type: 'unverifiable' }
  /** 確認できないところから、もう一度確かめる（手動・自動） */
  | { type: 'recheck' }
  /** 結果の画面を閉じる・知らせを消す */
  | { type: 'close' };

export const initialConfirmState: ConfirmState = { kind: 'idle', notice: null };

/** 確定を始められるか（idle のときだけ。pending がある間は確定できない） */
export const canSubmit = (s: ConfirmState) => s.kind === 'idle';

/** 状態遷移。決められていない組み合わせは、状態を変えない（同じオブジェクトを返す） */
export function confirmReducer(s: ConfirmState, e: ConfirmEvent): ConfirmState {
  switch (e.type) {
    case 'submit':
      // decide の「もう一度確定する」は、同じ ctx（同じ orderId）で来る
      return s.kind === 'idle' || s.kind === 'decide' || (s.kind === 'failed' && s.reason === 'voided')
        ? { kind: 'submitting', ctx: e.ctx }
        : s;
    case 'retry':
      return (s.kind === 'failed' && s.reason !== 'voided') || s.kind === 'decide' ? { kind: 'submitting', ctx: s.ctx } : s;
    case 'succeeded':
      return s.kind === 'submitting' ? { kind: 'done', ctx: s.ctx, order: e.order, recovered: false } : s;
    case 'failed':
      return s.kind === 'submitting' ? { kind: 'failed', ctx: s.ctx, reason: e.reason } : s;
    case 'abandon':
      return (s.kind === 'failed' && s.reason !== 'voided') || s.kind === 'decide' ? { kind: 'abandoning', ctx: s.ctx } : s;
    case 'dismiss':
      return s.kind === 'failed' && s.reason === 'voided' ? { kind: 'idle', notice: 'voided' } : s;
    case 'blocked':
      return s.kind === 'abandoning' ? { kind: 'idle', notice: 'blocked' } : s;
    case 'found':
      // 登録されていた → 成功扱い（やめない）
      return s.kind === 'abandoning' ? { kind: 'done', ctx: s.ctx, order: e.order, recovered: true } : s;
    case 'voided':
      return s.kind === 'abandoning' ? { kind: 'idle', notice: 'voided' } : s;
    case 'unverifiable':
      return s.kind === 'abandoning' ? { kind: 'unverifiable', ctx: s.ctx } : s;
    case 'recheck':
      // 確認できない → やめる処理（void-or-find）をやり直す
      return s.kind === 'unverifiable' ? { kind: 'abandoning', ctx: s.ctx } : s;
    case 'close':
      return s.kind === 'done' || (s.kind === 'idle' && s.notice !== null) ? initialConfirmState : s;
  }
}
