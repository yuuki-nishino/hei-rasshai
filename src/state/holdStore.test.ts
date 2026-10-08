// 「完成」「渡した」の猶予（#45）。偽のタイマーで、保留・元に戻す・すぐ書く を確かめる
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '../lib/data/types';
import { applyHolds, createHoldStore, type Hold } from './holdStore';

const GRACE = 5000;
const SETTLE = 1500;

const order = (patch: Partial<Order> = {}): Order =>
  ({ id: 'o1', number: 7, day: '2026-08-01', status: 'preparing', cancelledFrom: null, ...patch }) as Order;

let write: ReturnType<typeof vi.fn<(h: Hold) => void>>;
let store: ReturnType<typeof createHoldStore>;
const start = (o: Order, action: 'ready' | 'done' | 'backToPreparing' | 'cancel' = 'ready') => store.start({ eventId: 'e1', uid: 'u1', order: o, action });

beforeEach(() => {
  vi.useFakeTimers();
  write = vi.fn();
  store = createHoldStore({ graceMs: GRACE, settleMs: SETTLE, write });
});
afterEach(() => vi.useRealTimers());

describe('保留の開始', () => {
  it('「完成」「渡した」は、保留する（書かない）。見せる状態は、操作のあと', () => {
    expect(start(order())).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(store.holds.value).toMatchObject([{ orderId: 'o1', number: 7, action: 'ready', to: 'ready', written: false }]);
    expect(start(order({ id: 'o2', status: 'ready' }), 'done')).toBe(true);
    expect(store.holds.value[1]).toMatchObject({ to: 'done' });
  });

  it('対象外の操作・できない遷移は、保留しない（false。呼ぶ側が、そのまま書く）', () => {
    expect(start(order({ status: 'ready' }), 'backToPreparing')).toBe(false);
    expect(start(order(), 'cancel')).toBe(false);
    expect(start(order({ status: 'ready' }), 'ready')).toBe(false); // できあがりに「完成」
    expect(store.holds.value).toEqual([]);
  });
});

describe('猶予', () => {
  it('猶予の間は書かず、過ぎたら、1回だけ書く', () => {
    start(order());
    vi.advanceTimersByTime(GRACE - 1);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toMatchObject({ orderId: 'o1', action: 'ready', eventId: 'e1', uid: 'u1' });
    vi.advanceTimersByTime(60_000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('書いたあとも、購読に反映されるまでの間は、見せる状態を保ち、「元に戻す」は効かない。そのあと消える', () => {
    start(order());
    vi.advanceTimersByTime(GRACE);
    expect(store.holds.value).toMatchObject([{ written: true, to: 'ready' }]);
    expect(store.undo('o1')).toBe(false);
    vi.advanceTimersByTime(SETTLE);
    expect(store.holds.value).toEqual([]);
  });

  it('「元に戻す」：何も書かず、保留が消える。タイマーが過ぎても、書かない', () => {
    start(order());
    vi.advanceTimersByTime(3000);
    expect(store.undo('o1')).toBe(true);
    expect(store.holds.value).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('保留が無い注文の「元に戻す」は、false', () => {
    expect(store.undo('nothing')).toBe(false);
  });
});

describe('すぐ書く（flush）', () => {
  it('flush：すぐ書く。タイマーの二重の書き込みは無い', () => {
    start(order());
    store.flush('o1');
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(GRACE * 2);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('flushAll：保留中の、すべての注文を書く（画面を閉じる・離れる前）', () => {
    start(order({ id: 'a', number: 1 }));
    start(order({ id: 'b', number: 2, status: 'ready' }), 'done');
    store.flushAll();
    expect(write.mock.calls.map((c) => c[0].orderId).sort()).toEqual(['a', 'b']);
    store.flushAll();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('同じ注文に続けて操作（「完成」→「渡した」）：前の保留を先に書き、次を保留する', () => {
    start(order());
    vi.advanceTimersByTime(2000);
    // 画面に見えている注文は、保留を反映した状態（できあがり）
    expect(start(order({ status: 'ready' }), 'done')).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toMatchObject({ action: 'ready' });
    expect(store.holds.value).toMatchObject([{ action: 'done', to: 'done', written: false }]);
    // 前の保留の、書き込み済みの印が消える時刻に、新しい保留が消えない
    vi.advanceTimersByTime(SETTLE);
    expect(store.holds.value).toHaveLength(1);
    vi.advanceTimersByTime(GRACE);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]![0]).toMatchObject({ action: 'done' });
  });

  it('続けて操作したあと、新しい保留を「元に戻す」と、前の保留（書き込み済み）は残り、新しい分だけ書かれない', () => {
    start(order());
    start(order({ status: 'ready' }), 'done');
    expect(store.undo('o1')).toBe(true);
    vi.advanceTimersByTime(GRACE * 2);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toMatchObject({ action: 'ready' });
  });
});

describe('applyHolds（表示への反映）', () => {
  it('保留中の注文だけ、状態を進めて見せる。ほかの項目と、ほかの注文は、そのまま', () => {
    start(order());
    const shown = applyHolds([order({ note: 'ねぎ抜き' }), order({ id: 'o2', number: 8 })], store.holds.value);
    expect(shown[0]).toMatchObject({ id: 'o1', status: 'ready', note: 'ねぎ抜き' });
    expect(shown[1]).toMatchObject({ id: 'o2', status: 'preparing' });
  });

  it('保留が無ければ、そのまま', () => {
    const o = order();
    expect(applyHolds([o], [])).toEqual([o]);
  });
});
