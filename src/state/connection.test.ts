// online イベントの処理（PR #48 の再レビュー R1・R2）。偽のタイマーと、偽の window で確かめる
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reconnectNow = vi.fn<() => Promise<void>>();
vi.mock('../lib/data/online', () => ({ reconnectNow: () => reconnectNow() }));
vi.mock('../lib/data/writes', async () => {
  const { signal } = await import('@preact/signals');
  return { pendingWrites: signal(0), pendingUnknown: signal(false) };
});

const win = new EventTarget();
vi.stubGlobal('window', win);
vi.stubGlobal('navigator', { onLine: true });
const { browserOnline } = await import('./online');
const { connection, reportSnapshot, resetConnection } = await import('./connection');

beforeEach(() => {
  vi.useFakeTimers();
  reconnectNow.mockReset().mockResolvedValue();
  browserOnline.value = true;
});
afterEach(() => {
  resetConnection();
  vi.useRealTimers();
});

const goOnline = () => {
  browserOnline.value = true;
  win.dispatchEvent(new Event('online'));
};

describe('connection', () => {
  it('fromCache が10秒続くと、オフラインになる。サーバーに届けば、オンラインに戻る', () => {
    reportSnapshot(true);
    expect(connection.value).toBe('online');
    vi.advanceTimersByTime(10_100);
    expect(connection.value).toBe('offline');
    reportSnapshot(false);
    expect(connection.value).toBe('online');
  });

  it('オフラインのとき online が来ると、すぐ再接続させ、数え直す（すぐオンライン表示。まだつながらなければ、10秒でまたオフライン）', () => {
    browserOnline.value = false;
    reportSnapshot(true);
    vi.advanceTimersByTime(10_100);
    expect(connection.value).toBe('offline');

    goOnline();
    expect(reconnectNow).toHaveBeenCalledTimes(1);
    expect(connection.value).toBe('online');
    vi.advanceTimersByTime(9_000);
    expect(connection.value).toBe('online');
    vi.advanceTimersByTime(1_100);
    expect(connection.value).toBe('offline');
  });

  it('購読していない（fromCache の記録が無い）ときは、online が来ても何もしない', () => {
    goOnline();
    expect(reconnectNow).not.toHaveBeenCalled();
  });

  it('reconnectNow が失敗しても、例外を外に出さない（R1）', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    reconnectNow.mockRejectedValue(new Error('失敗'));
    reportSnapshot(true);
    goOnline();
    await vi.advanceTimersByTimeAsync(0);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
