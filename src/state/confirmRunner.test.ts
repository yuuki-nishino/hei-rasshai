// 確定フローを動かす部分（8秒の時間切れ・遅れた結果・やめる）。偽のタイマーで確かめる（testing.md §2 の confirmReducer）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialConfirmState, type ConfirmContext, type ConfirmedOrder, type ConfirmState } from '../lib/domain/confirmFlow';
import { CONFIRM_TIMEOUT_MS, createConfirmRunner, type ConfirmDeps, type InflightTracker, type PendingRecord } from './confirmRunner';

const ctx: ConfirmContext = {
  orderId: 'o1',
  day: '2026-08-01',
  draft: { items: [{ menuId: 'y', name: '焼きそば', price: 500, qty: 1 }], total: 500, payment: 'cash', qr: true },
  tendered: 0,
};
const order: ConfirmedOrder = { orderId: 'o1', number: 3, day: '2026-08-01', total: 500, qr: true };

/** 外から解決できる Promise */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(deps: Partial<ConfirmDeps>, tracker?: InflightTracker) {
  let state: ConfirmState = initialConfirmState;
  const saved: (PendingRecord | null)[] = [];
  const runner = createConfirmRunner(
    {
      confirmOrder: () => new Promise(() => {}),
      voidOrFind: () => new Promise(() => {}),
      voidExists: async () => false,
      findOrder: async () => null,
      pending: { save: (p) => saved.push(p), clear: () => saved.push(null) },
      ...deps,
    },
    { get: () => state, set: (s) => (state = s) },
    undefined,
    tracker,
  );
  return { runner, state: () => state, saved };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createConfirmRunner', () => {
  it('成功すれば done', async () => {
    const { runner, state } = setup({ confirmOrder: async () => order });
    expect(runner.submit(ctx)).toBe(true);
    await flush();
    expect(state()).toMatchObject({ kind: 'done', order });
  });

  it('8秒で応答がなければ「送れていません」（timeout）。7.999秒では、まだ送信中', async () => {
    const { runner, state } = setup({});
    runner.submit(ctx);
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS - 1);
    expect(state().kind).toBe('submitting');
    await vi.advanceTimersByTimeAsync(1);
    expect(state()).toMatchObject({ kind: 'failed', reason: 'timeout' });
  });

  it('時間切れの後に、遅れて成功が届いても、画面は動かない（再試行・やめるで、登録を確かめる）', async () => {
    const late = deferred<ConfirmedOrder>();
    const { runner, state } = setup({ confirmOrder: () => late.promise });
    runner.submit(ctx);
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS);
    late.resolve(order);
    await flush();
    expect(state()).toMatchObject({ kind: 'failed', reason: 'timeout' });
  });

  it('もう一度試す：同じ orderId で、もう一度 confirmOrder を呼ぶ（冪等）', async () => {
    const calls: string[] = [];
    let n = 0;
    const { runner, state } = setup({
      confirmOrder: async (c) => {
        calls.push(c.orderId);
        if (n++ === 0) throw { code: 'offline' };
        return order;
      },
    });
    runner.submit(ctx);
    await flush();
    expect(state()).toMatchObject({ kind: 'failed', reason: 'offline' });
    runner.retry();
    await flush();
    expect(state()).toMatchObject({ kind: 'done' });
    expect(calls).toEqual(['o1', 'o1']);
  });

  it('送信中に、もう一度押しても、始めない', () => {
    const confirmOrder = vi.fn(() => new Promise<ConfirmedOrder>(() => {}));
    const { runner } = setup({ confirmOrder });
    expect(runner.submit(ctx)).toBe(true);
    expect(runner.submit({ ...ctx, orderId: 'o2' })).toBe(false);
    expect(confirmOrder).toHaveBeenCalledTimes(1);
  });

  it('permission で拒否：墓標があれば voided（やめた注文）、なければ permission', async () => {
    const a = setup({ confirmOrder: async () => Promise.reject({ code: 'permission' }), voidExists: async () => true });
    a.runner.submit(ctx);
    await flush();
    expect(a.state()).toMatchObject({ kind: 'failed', reason: 'voided' });
    const b = setup({ confirmOrder: async () => Promise.reject({ code: 'permission' }), voidExists: async () => false });
    b.runner.submit(ctx);
    await flush();
    expect(b.state()).toMatchObject({ kind: 'failed', reason: 'permission' });
  });

  it('permission の後の墓標の確認も、確定を始めてから8秒で打ち切る。分からないので timeout（レビュー C2）', async () => {
    const rejectAt7s = () => new Promise<ConfirmedOrder>((_, reject) => setTimeout(() => reject({ code: 'permission' }), 7000));
    const { runner, state } = setup({ confirmOrder: rejectAt7s, voidExists: () => new Promise(() => {}) });
    runner.submit(ctx);
    await vi.advanceTimersByTimeAsync(7999);
    expect(state().kind).toBe('submitting');
    await vi.advanceTimersByTimeAsync(1);
    expect(state()).toMatchObject({ kind: 'failed', reason: 'timeout' });
  });

  it('墓標の確認が失敗したときも、分からないので timeout', async () => {
    const { runner, state } = setup({ confirmOrder: async () => Promise.reject({ code: 'permission' }), voidExists: async () => Promise.reject({ code: 'offline' }) });
    runner.submit(ctx);
    await flush();
    expect(state()).toMatchObject({ kind: 'failed', reason: 'timeout' });
  });

  it('やめた扱い（voided）の「確定せずに戻る」は、問い合わせない（レビュー C1）', async () => {
    const voidOrFind = vi.fn(() => new Promise<{ result: 'voided' }>(() => {}));
    const { runner, state } = setup({ confirmOrder: async () => Promise.reject({ code: 'permission' }), voidExists: async () => true, voidOrFind });
    runner.submit(ctx);
    await flush();
    runner.dismiss();
    expect(state()).toEqual({ kind: 'idle', notice: 'voided' });
    expect(voidOrFind).not.toHaveBeenCalled();
  });

  it('やめるが権限で断られた（メンバーでない・削除中）：確認できないではなく、知らせて idle（レビュー C3）', async () => {
    const { runner, state } = setup({ confirmOrder: async () => Promise.reject({ code: 'permission' }), voidOrFind: async () => Promise.reject({ code: 'permission' }) });
    runner.submit(ctx);
    await flush();
    runner.abandon();
    await flush();
    expect(state()).toEqual({ kind: 'idle', notice: 'blocked' });
  });

  it('そのほかの失敗は conflict（「もう一度試してください」）', async () => {
    const { runner, state } = setup({ confirmOrder: async () => Promise.reject({ code: 'unknown' }) });
    runner.submit(ctx);
    await flush();
    expect(state()).toMatchObject({ kind: 'failed', reason: 'conflict' });
  });

  it('やめる：found なら done（成功扱い）、voided なら idle', async () => {
    const a = setup({ confirmOrder: async () => Promise.reject({ code: 'offline' }), voidOrFind: async () => ({ result: 'found', order }) });
    a.runner.submit(ctx);
    await flush();
    a.runner.abandon();
    await flush();
    expect(a.state()).toMatchObject({ kind: 'done', recovered: true });

    const b = setup({ confirmOrder: async () => Promise.reject({ code: 'offline' }), voidOrFind: async () => ({ result: 'voided' }) });
    b.runner.submit(ctx);
    await flush();
    b.runner.abandon();
    await flush();
    expect(b.state()).toEqual({ kind: 'idle', notice: 'voided' });
  });

  it('やめるが8秒で応答なし → 確認できない。裏の処理が終わるまで「もう一度確認」は busy。終わったら、void-or-find をやり直す（§5.4）', async () => {
    let calls = 0;
    const { runner, state } = setup({
      confirmOrder: async () => Promise.reject({ code: 'offline' }),
      voidOrFind: () =>
        ++calls === 1
          ? new Promise((_, reject) => setTimeout(() => reject({ code: 'offline' }), 10_000)) // 10秒後に、裏で失敗する
          : Promise.resolve({ result: 'voided' as const }),
    });
    runner.submit(ctx);
    await flush();
    runner.abandon();
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS);
    expect(state()).toMatchObject({ kind: 'unverifiable', via: 'abandon' });
    expect(runner.recheck()).toBe('busy'); // 裏の void-or-find が、まだ終わっていない
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runner.recheck()).toBe('started');
    await flush();
    expect(state()).toEqual({ kind: 'idle', notice: 'voided' });
    expect(calls).toBe(2);
  });

  describe('pending の保存（#14、order-confirm.md §3）', () => {
    it('確定の前に保存し、やめるの前に abandoning にして保存し直す。解決したら消す', async () => {
      const { runner, saved } = setup({ confirmOrder: async () => Promise.reject({ code: 'offline' }), voidOrFind: async () => ({ result: 'voided' }) });
      runner.submit(ctx);
      expect(saved).toEqual([{ ctx, abandoning: false }]); // トランザクションを始める前
      await flush();
      runner.abandon();
      expect(saved[1]).toEqual({ ctx, abandoning: true }); // void-or-find を始める前
      await flush();
      expect(saved[2]).toBeNull(); // voided → 消す
    });

    it('成功したら消す。確認できない・決めてもらう（decide）の間は残す', async () => {
      const a = setup({ confirmOrder: async () => order });
      a.runner.submit(ctx);
      await flush();
      expect(a.saved).toEqual([{ ctx, abandoning: false }, null]);

      const b = setup({ findOrder: async () => null, voidExists: async () => false });
      b.runner.restore({ ctx, abandoning: false });
      await flush();
      expect(b.state()).toEqual({ kind: 'decide', ctx });
      expect(b.saved).toEqual([]); // 残す
    });
  });

  describe('復元（#14、order-confirm.md §5.3、testing.md §4 #17・#19）', () => {
    it('#17：注文あり → done（登録されていました）', async () => {
      const { runner, state, saved } = setup({ findOrder: async () => order });
      expect(runner.restore({ ctx, abandoning: false })).toBe(true);
      expect(state().kind).toBe('checking');
      await flush();
      expect(state()).toMatchObject({ kind: 'done', order, recovered: true });
      expect(saved).toEqual([null]);
    });

    it('#19：注文が無く、墓標がある（abandoning なし）→ やめた扱いで idle。「登録されていません」の決めてもらう画面にならない', async () => {
      const { runner, state } = setup({ findOrder: async () => null, voidExists: async () => true });
      runner.restore({ ctx, abandoning: false });
      await flush();
      expect(state()).toEqual({ kind: 'idle', notice: 'voided' });
    });

    it('#17：どちらも無い → decide。もう一度確定する（同じ orderId）・やめる', async () => {
      const confirmOrder = vi.fn(async () => order);
      const { runner, state } = setup({ confirmOrder, findOrder: async () => null, voidExists: async () => false });
      runner.restore({ ctx, abandoning: false });
      await flush();
      expect(state().kind).toBe('decide');
      runner.retry();
      await flush();
      expect(confirmOrder).toHaveBeenCalledWith(ctx);
      expect(state()).toMatchObject({ kind: 'done' });
    });

    it('#17：abandoning → やめる処理の続き（void-or-find）', async () => {
      const voidOrFind = vi.fn(async () => ({ result: 'voided' as const }));
      const { runner, state } = setup({ voidOrFind });
      runner.restore({ ctx, abandoning: true });
      expect(state().kind).toBe('abandoning');
      await flush();
      expect(voidOrFind).toHaveBeenCalledWith('o1');
      expect(state()).toEqual({ kind: 'idle', notice: 'voided' });
    });

    it('#17：確認できない（オフライン）→ unverifiable（find）。もう一度確認で、同じ確認をやり直す', async () => {
      let n = 0;
      const { runner, state } = setup({ findOrder: async () => (n++ === 0 ? Promise.reject({ code: 'offline' }) : order) });
      runner.restore({ ctx, abandoning: false });
      await flush();
      expect(state()).toMatchObject({ kind: 'unverifiable', via: 'find' });
      expect(runner.recheck()).toBe('started');
      await flush();
      expect(state()).toMatchObject({ kind: 'done', recovered: true });
    });

    it('墓標を読む権限が無い（メンバーでない）→ decide（やめると、登録できないの知らせになる）', async () => {
      const { runner, state } = setup({ findOrder: async () => null, voidExists: async () => Promise.reject({ code: 'permission' }) });
      runner.restore({ ctx, abandoning: false });
      await flush();
      expect(state().kind).toBe('decide');
    });

    it('idle でなければ、復元しない', async () => {
      const { runner } = setup({});
      runner.submit(ctx);
      expect(runner.restore({ ctx: { ...ctx, orderId: 'o2' }, abandoning: false })).toBe(false);
    });
  });

  describe('自動の再確認と同時実行（#14、order-confirm.md §5.4、testing.md §4 #27）', () => {
    it('#27：裏の処理が終わるまで、自動のきっかけ（kick）は何もしない。終わった後の kick で、確かめ直す', async () => {
      let calls = 0;
      const { runner, state } = setup({
        findOrder: () => {
          calls++;
          return calls === 1 ? new Promise((_, reject) => setTimeout(() => reject({ code: 'offline' }), 20_000)) : Promise.resolve(order);
        },
      });
      runner.restore({ ctx, abandoning: false });
      await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS);
      expect(state().kind).toBe('unverifiable');
      runner.kick(); // 15秒ごと・online のきっかけ
      runner.kick();
      expect(calls).toBe(1);
      expect(runner.busy()).toBe(true);
      await vi.advanceTimersByTimeAsync(12_000); // 裏の処理が終わる
      expect(runner.busy()).toBe(false);
      runner.kick();
      await flush();
      expect(calls).toBe(2);
      expect(state()).toMatchObject({ kind: 'done' });
    });

    it('裏の処理が終わったら onSettled を呼ぶ（「確認中です」を消す。PR #41 のレビュー P1）', async () => {
      const onSettled = vi.fn();
      const tracker: InflightTracker = { current: null, onSettled };
      const { runner, state } = setup(
        { findOrder: () => new Promise((_, reject) => setTimeout(() => reject({ code: 'offline' }), 10_000)) },
        tracker,
      );
      runner.restore({ ctx, abandoning: false });
      await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS);
      expect(runner.recheck()).toBe('busy');
      expect(onSettled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2000); // 裏の処理が、unverifiable のまま終わる
      expect(state().kind).toBe('unverifiable');
      expect(onSettled).toHaveBeenCalledTimes(1);
    });

    it('目印をランナーの外に持つと、ランナーを作り直しても、前の裏の処理が終わるまで復元しない（レビュー P2）', async () => {
      const tracker: InflightTracker = { current: null };
      const slow = deferred<ConfirmedOrder>();
      const a = setup({ confirmOrder: () => slow.promise }, tracker);
      a.runner.submit(ctx); // 書き込みが遅い間に、イベントを離れる（ランナー a を捨てる）
      const findOrder = vi.fn(async () => order);
      const b = setup({ findOrder }, tracker); // 戻って、新しいランナー
      expect(b.runner.restore({ ctx, abandoning: false })).toBe(false);
      expect(findOrder).not.toHaveBeenCalled();
      slow.resolve(order); // 前の書き込みが終わる
      await flush();
      expect(tracker.current).toBeNull();
      expect(b.runner.restore({ ctx, abandoning: false })).toBe(true);
      await flush();
      expect(b.state()).toMatchObject({ kind: 'done', recovered: true });
    });

    it('unverifiable でなければ、kick は何もしない', () => {
      const confirmOrder = vi.fn(async () => order);
      const { runner } = setup({ confirmOrder });
      runner.kick();
      expect(confirmOrder).not.toHaveBeenCalled();
    });
  });
});
