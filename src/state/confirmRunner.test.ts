// 確定フローを動かす部分（8秒の時間切れ・遅れた結果・やめる）。偽のタイマーで確かめる（testing.md §2 の confirmReducer）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialConfirmState, type ConfirmContext, type ConfirmedOrder, type ConfirmState } from '../lib/domain/confirmFlow';
import { CONFIRM_TIMEOUT_MS, createConfirmRunner, type ConfirmDeps } from './confirmRunner';

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

function setup(deps: Partial<ConfirmDeps>) {
  let state: ConfirmState = initialConfirmState;
  const runner = createConfirmRunner(
    {
      confirmOrder: () => new Promise(() => {}),
      voidOrFind: () => new Promise(() => {}),
      voidExists: async () => false,
      ...deps,
    },
    { get: () => state, set: (s) => (state = s) },
  );
  return { runner, state: () => state };
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

  it('やめるが、失敗・8秒で応答なし → 確認できない（unverifiable）。もう一度確認で、void-or-find をやり直す', async () => {
    let calls = 0;
    const { runner, state } = setup({
      confirmOrder: async () => Promise.reject({ code: 'offline' }),
      voidOrFind: () => (++calls === 1 ? new Promise(() => {}) : Promise.resolve({ result: 'voided' as const })),
    });
    runner.submit(ctx);
    await flush();
    runner.abandon();
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS);
    expect(state().kind).toBe('unverifiable');
    runner.recheck();
    await flush();
    expect(state()).toEqual({ kind: 'idle', notice: 'voided' });
    expect(calls).toBe(2);
  });
});
