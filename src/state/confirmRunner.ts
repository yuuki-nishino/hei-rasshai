// 確定フローを動かす（order-confirm.md §5）。reducer（lib/domain/confirmFlow.ts）に、データアクセスの結果を流し込む。
// Firestore・localStorage には依存しない（関数を受け取る）。偽のタイマーで、8秒の時間切れを単体テストするため
//
// - pending（確定の途中の記録）は、トランザクションを始める前に保存し、「やめる」の前に abandoning にして保存し直す。
//   解決（done・idle）したら消す（order-confirm.md §3）
// - 確かめる処理（確定・やめる・確認）は、同時に1つだけ。8秒の時間切れは Promise.race なので、裏の処理は続く。
//   「実行中」は、裏の処理が終わるまでとし、その間は、自動のきっかけ（15秒ごと・online）を無視する（§5.4）
import {
  confirmReducer,
  type ConfirmContext,
  type ConfirmedOrder,
  type ConfirmEvent,
  type ConfirmState,
  type FailReason,
} from '../lib/domain/confirmFlow';

export const CONFIRM_TIMEOUT_MS = 8000;

/** 端末に保存する、確定の途中の記録（hei:pending:{eventId}） */
export interface PendingRecord {
  ctx: ConfirmContext;
  abandoning: boolean;
}

export interface ConfirmDeps {
  confirmOrder(ctx: ConfirmContext): Promise<ConfirmedOrder>;
  voidOrFind(orderId: string): Promise<{ result: 'found'; order: ConfirmedOrder } | { result: 'voided' }>;
  /** 墓標があるか（サーバーで） */
  voidExists(orderId: string): Promise<boolean>;
  /** 注文があるか（サーバーで）。無ければ null */
  findOrder(orderId: string): Promise<ConfirmedOrder | null>;
  pending: { save(p: PendingRecord): void; clear(): void };
}

/** 失敗の code（AppError の code）を取り出す */
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
  const dispatch = (e: ConfirmEvent) => {
    const before = store.get();
    const after = confirmReducer(before, e);
    if (after === before) return;
    // 解決した（成功・やめた・登録できない・閉じた）ら、pending を消す
    if ((after.kind === 'done' || after.kind === 'idle') && before.kind !== 'done' && before.kind !== 'idle') deps.pending.clear();
    store.set(after);
  };
  /** いまも、この注文の、この段階か（遅れて届いた結果で、別の注文を動かさない） */
  const still = (kind: ConfirmState['kind'], orderId: string) => {
    const s = store.get();
    return s.kind === kind && 'ctx' in s && s.ctx.orderId === orderId;
  };

  /** 裏で動いている、確かめる処理（終わるまで、次の確認を始めない） */
  let inflight: Promise<unknown> | null = null;
  function track<T>(p: Promise<T>): Promise<T> {
    const tracked = p.finally(() => {
      if (inflight === tracked) inflight = null;
    });
    inflight = tracked;
    tracked.catch(() => {}); // 結果は、呼んだ側で扱う
    return p;
  }

  async function runConfirm(ctx: ConfirmContext) {
    const deadline = Date.now() + timeoutMs; // 確定を始めてから8秒で、必ず結果を出す（PR #39 のレビュー C2）
    let reason: FailReason;
    try {
      const r = await race(track(deps.confirmOrder(ctx)), timeoutMs);
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
      const r = await race(track(deps.voidOrFind(ctx.orderId)), timeoutMs);
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

  /** 確認（find。order-confirm.md §5.3 の 2）：注文と墓標を、サーバーで確かめる */
  async function runFind(ctx: ConfirmContext) {
    const check = async (): Promise<{ result: 'found'; order: ConfirmedOrder } | { result: 'voided' | 'missing' }> => {
      const order = await deps.findOrder(ctx.orderId);
      if (order) return { result: 'found', order };
      try {
        return (await deps.voidExists(ctx.orderId)) ? { result: 'voided' } : { result: 'missing' };
      } catch (e) {
        // 墓標を読む権限が無い（メンバーでない）：注文は無いと確かめてある。決めてもらう（やめる → 登録できないの知らせ）
        if (codeOf(e) === 'permission') return { result: 'missing' };
        throw e;
      }
    };
    try {
      const r = await race(track(check()), timeoutMs);
      if (!still('checking', ctx.orderId)) return;
      if (r === TIMEOUT) dispatch({ type: 'unverifiable' });
      else if (r.result === 'found') dispatch({ type: 'found', order: r.order });
      else dispatch({ type: r.result });
    } catch {
      if (still('checking', ctx.orderId)) dispatch({ type: 'unverifiable' });
    }
  }

  /** いまの状態に合わせて、確かめる処理を始める */
  function runFor(s: ConfirmState) {
    if (s.kind === 'submitting') void runConfirm(s.ctx);
    else if (s.kind === 'abandoning') void runAbandon(s.ctx);
    else if (s.kind === 'checking') void runFind(s.ctx);
  }

  return {
    /** 確定を押す（idle のときだけ始まる）。voided の後に、新しい orderId で確定し直すときも */
    submit(ctx: ConfirmContext): boolean {
      const before = store.get();
      dispatch({ type: 'submit', ctx });
      if (store.get() === before) return false;
      deps.pending.save({ ctx, abandoning: false }); // トランザクションを始める前に保存する
      void runConfirm(ctx);
      return true;
    },
    /** もう一度試す（同じ orderId）。decide の「もう一度確定する」も */
    retry(): void {
      dispatch({ type: 'retry' });
      const s = store.get();
      if (s.kind === 'submitting') {
        deps.pending.save({ ctx: s.ctx, abandoning: false });
        void runConfirm(s.ctx);
      }
    },
    /** やめる → void-or-find（始める前に abandoning を保存する） */
    abandon(): void {
      dispatch({ type: 'abandon' });
      const s = store.get();
      if (s.kind === 'abandoning') {
        deps.pending.save({ ctx: s.ctx, abandoning: true });
        void runAbandon(s.ctx);
      }
    },
    /** 確認できないところから、手動で確かめ直す。裏の処理が終わっていなければ 'busy'（「確認中です」） */
    recheck(): 'started' | 'busy' | 'ignored' {
      if (inflight) return 'busy';
      const before = store.get();
      dispatch({ type: 'recheck' });
      if (store.get() === before) return 'ignored';
      runFor(store.get());
      return 'started';
    },
    /** 自動のきっかけ（15秒ごと・online）：確認できない状態で、裏の処理が無ければ、確かめ直す */
    kick(): void {
      if (!inflight && store.get().kind === 'unverifiable') this.recheck();
    },
    /** 端末に残っていた pending から復元する（idle のときだけ） */
    restore(p: PendingRecord): boolean {
      if (inflight) return false;
      const before = store.get();
      dispatch({ type: 'restore', ctx: p.ctx, abandoning: p.abandoning });
      if (store.get() === before) return false;
      runFor(store.get());
      return true;
    },
    /** やめた扱いと分かっている注文を、問い合わせずに閉じる（カートは残す） */
    dismiss(): void {
      dispatch({ type: 'dismiss' });
    },
    close(): void {
      dispatch({ type: 'close' });
    },
    /** 裏で、確かめる処理が動いているか */
    busy(): boolean {
      return inflight !== null;
    },
  };
}
