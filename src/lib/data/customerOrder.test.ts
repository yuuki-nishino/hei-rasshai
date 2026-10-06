// 注文1件の購読のつなぎ直し（PR #44 のレビュー V2・再レビュー R1）。onSnapshot を差し替え、偽のタイマーで確かめる
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handlers = { next: (snap: unknown) => void; error: (e: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> };
const subscriptions: Handlers[] = [];

vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  onSnapshot: (_ref: unknown, _options: unknown, next: Handlers['next'], error: Handlers['error']) => {
    const unsubscribe = vi.fn();
    subscriptions.push({ next, error, unsubscribe });
    return unsubscribe;
  },
}));
vi.mock('../firebase/customer', () => ({ db: {} }));

const { watchOrder } = await import('./customerOrder');

const snapshotOf = (fromCache: boolean) => ({
  exists: () => true,
  data: () => ({ number: 1, total: 500, status: 'preparing', items: [{ name: '焼きそば', price: 500, qty: 1 }] }),
  metadata: { fromCache },
});

beforeEach(() => {
  subscriptions.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('watchOrder のつなぎ直し', () => {
  it('エラー（購読の終わり）のあと、2秒 → 4秒 → 8秒と、間隔を倍にして、つなぎ直す。上限は30秒', () => {
    const received: string[] = [];
    watchOrder('e', 'o', (s) => received.push(s.kind));
    expect(subscriptions).toHaveLength(1);

    const delays = [2000, 4000, 8000, 16000, 30000, 30000];
    delays.forEach((ms, k) => {
      subscriptions[k]!.error(new Error('resource-exhausted'));
      expect(received[received.length - 1]).toBe('error'); // つなぎ直すまでの間も、エラーを知らせる
      vi.advanceTimersByTime(ms - 1);
      expect(subscriptions).toHaveLength(k + 1); // まだ
      vi.advanceTimersByTime(1);
      expect(subscriptions).toHaveLength(k + 2); // つなぎ直した
    });
  });

  it('サーバーの結果が届いたら、間隔を戻す（次のエラーは、また2秒後）', () => {
    watchOrder('e', 'o', () => {});
    subscriptions[0]!.error(new Error('x'));
    vi.advanceTimersByTime(2000); // 2回目
    subscriptions[1]!.error(new Error('x'));
    vi.advanceTimersByTime(4000); // 3回目
    subscriptions[2]!.next(snapshotOf(false)); // つながった
    subscriptions[2]!.error(new Error('x'));
    vi.advanceTimersByTime(1999);
    expect(subscriptions).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(subscriptions).toHaveLength(4); // 2秒後（4秒ではなく）
  });

  it('キャッシュの結果（fromCache）では、間隔を戻さない（再レビュー R2）', () => {
    watchOrder('e', 'o', () => {});
    subscriptions[0]!.error(new Error('x'));
    vi.advanceTimersByTime(2000); // 2回目
    subscriptions[1]!.next(snapshotOf(true)); // キャッシュの結果
    subscriptions[1]!.error(new Error('x'));
    vi.advanceTimersByTime(3999);
    expect(subscriptions).toHaveLength(2); // 4秒（倍になったまま）
    vi.advanceTimersByTime(1);
    expect(subscriptions).toHaveLength(3);
  });

  it('止めたら、それ以上つなぎ直さない。つなぎ直しを待っている間に止めても、購読は増えない', () => {
    const stop = watchOrder('e', 'o', () => {});
    subscriptions[0]!.error(new Error('x'));
    stop();
    vi.advanceTimersByTime(60_000);
    expect(subscriptions).toHaveLength(1);
  });

  it('止めると、いまの購読を解除する。止めたあとの、遅れたエラーは、何も起こさない', () => {
    const received: string[] = [];
    const stop = watchOrder('e', 'o', (s) => received.push(s.kind));
    stop();
    expect(subscriptions[0]!.unsubscribe).toHaveBeenCalledTimes(1);
    subscriptions[0]!.error(new Error('late'));
    vi.advanceTimersByTime(60_000);
    expect(received).toEqual([]);
    expect(subscriptions).toHaveLength(1);
  });

  it('お客様に渡す項目だけを取り出す（支払い方法・メモなどが、文書にあっても、渡さない）', () => {
    const received: unknown[] = [];
    watchOrder('e', 'o', (s) => received.push(s));
    subscriptions[0]!.next({
      exists: () => true,
      data: () => ({ number: 3, total: 700, status: 'ready', payment: 'paypay', note: '辛さ抜き', createdBy: 'uid', items: [{ menuId: 'm', name: 'ラムネ', price: 200, qty: 1 }] }),
      metadata: { fromCache: false },
    });
    expect(received[0]).toEqual({ kind: 'doc', fromCache: false, order: { number: 3, status: 'ready', total: 700, items: [{ name: 'ラムネ', price: 200, qty: 1 }] } });
  });
});
