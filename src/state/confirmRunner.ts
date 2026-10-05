// 確定フローを動かす（order-confirm.md §5）。reducer（lib/domain/confirmFlow.ts）に、データアクセスの結果を流し込む。
// Firestore には依存しない（関数を受け取る）。偽のタイマーで、8秒の時間切れを単体テストするため
import {
  confirmReducer,
  type ConfirmContext,
  type ConfirmedOrder,
  type ConfirmEvent,
  type ConfirmState,
  type FailReason,
} from '../lib/domain/confirmFlow';

export const CONFIRM_TIMEOUT_MS = 8000;

export interface ConfirmDeps {
  confirmOrder(ctx: ConfirmContext): Promise<ConfirmedOrder>;
  voidOrFind(orderId: string): Promise<{ result: 'found'; order: ConfirmedOrder } | { result: 'voided' }>;
  /** 墓標があるか（確定が permission で拒否されたときの確認） */
  voidExists(orderId: string): Promise<boolean>;
}

/** 失敗の code（AppError の code）を、理由に分ける（order-confirm.md §6） */
function codeOf(e: unknown): string {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : 'unknown';
}

const TIMEOUT = Symbol('timeout');

/** p が ms 以内に終わらなければ TIMEOUT を返す。p は止めない（トランザクションは、裏で続く） */
function race<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<typeof TIMEOUT>((r) => (timer = setTimeout(() => r(TIMEOUT), ms)))]).finally(() => clearTimeout(timer));
}

export function createConfirmRunner(deps: ConfirmDeps, store: { get(): ConfirmState; set(s: ConfirmState): void }, timeoutMs = CONFIRM_TIMEOUT_MS) {
  const dispatch = (e: ConfirmEvent) => store.set(confirmReducer(store.get(), e));
  /** いまも、この注文の、この段階か（遅れて届いた結果で、別の注文を動かさない） */
  const still = (kind: ConfirmState['kind'], orderId: string) => {
    const s = store.get();
    return s.kind === kind && 'ctx' in s && s.ctx.orderId === orderId;
  };

  async function runConfirm(ctx: ConfirmContext) {
    const deadline = Date.now() + timeoutMs; // 確定を始めてから8秒で、必ず結果を出す（PR #39 のレビュー C2）
    let reason: FailReason;
    try {
      const r = await race(deps.confirmOrder(ctx), timeoutMs);
      if (r !== TIMEOUT) {
        if (still('submitting', ctx.orderId)) dispatch({ type: 'succeeded', order: r });
        return;
      }
      reason = 'timeout';
    } catch (e) {
      const code = codeOf(e);
      if (code === 'permission') {
        // 墓標があれば「やめた注文」（order-confirm.md §5.1）。無ければ権限の文言。
        // 確かめられない（失敗・残りの時間切れ）ときは、登録されたか分からないので timeout（もう一度試す・やめるで確かめる）
        const exists = await race(deps.voidExists(ctx.orderId), Math.max(0, deadline - Date.now())).catch(() => TIMEOUT);
        reason = exists === TIMEOUT ? 'timeout' : exists ? 'voided' : 'permission';
      } else {
        reason = code === 'offline' ? 'offline' : code === 'timeout' ? 'timeout' : 'conflict';
      }
    }
    if (still('submitting', ctx.orderId)) dispatch({ type: 'failed', reason });
  }

  async function runAbandon(ctx: ConfirmContext) {
    try {
      const r = await race(deps.voidOrFind(ctx.orderId), timeoutMs);
      if (!still('abandoning', ctx.orderId)) return;
      if (r === TIMEOUT) dispatch({ type: 'unverifiable' });
      else if (r.result === 'found') dispatch({ type: 'found', order: r.order });
      else dispatch({ type: 'voided' });
    } catch (e) {
      if (!still('abandoning', ctx.orderId)) return;
      // 権限で断られた（メンバーでない・イベントの削除中）：通信の問題ではない。注文も登録されていない
      // （voidOrFind が、サーバーで注文が無いと確かめたときだけ permission を投げる。確かめられなければ、その失敗＝確認できない）。
      // 「確認できない」にすると、何度確かめても抜けられないため、知らせて戻す（PR #39 のレビュー C3・再レビュー R1・R2）
      if (codeOf(e) === 'permission') dispatch({ type: 'blocked' });
      // 通信できない・そのほかの失敗：確認できない（墓標が遅れて書かれても、意図した結果なので問題ない）
      else dispatch({ type: 'unverifiable' });
    }
  }

  return {
    /** 確定を押す（idle のときだけ始まる）。voided の後に、新しい orderId で確定し直すときも */
    submit(ctx: ConfirmContext): boolean {
      const before = store.get();
      dispatch({ type: 'submit', ctx });
      if (store.get() === before) return false;
      void runConfirm(ctx);
      return true;
    },
    /** もう一度試す（同じ orderId） */
    retry(): void {
      dispatch({ type: 'retry' });
      const s = store.get();
      if (s.kind === 'submitting') void runConfirm(s.ctx);
    },
    /** やめる → void-or-find */
    abandon(): void {
      dispatch({ type: 'abandon' });
      const s = store.get();
      if (s.kind === 'abandoning') void runAbandon(s.ctx);
    },
    /** 確認できないところから、もう一度確かめる */
    recheck(): void {
      dispatch({ type: 'recheck' });
      const s = store.get();
      if (s.kind === 'abandoning') void runAbandon(s.ctx);
    },
    /** やめた扱いと分かっている注文を、問い合わせずに閉じる（カートは残す） */
    dismiss(): void {
      dispatch({ type: 'dismiss' });
    },
    close(): void {
      dispatch({ type: 'close' });
    },
  };
}
