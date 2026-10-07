import { describe, expect, it } from 'vitest';
import { connectionStatus, OFFLINE_AFTER_MS, statusBarView } from '../../src/lib/domain/connection';

const T = 1_000_000;

describe('connectionStatus（data-access.md §6.1）', () => {
  it('通信できていて、fromCache でもない → オンライン', () => {
    expect(connectionStatus({ browserOnline: true, fromCacheSince: null, now: T })).toBe('online');
  });

  it('navigator.onLine が false → すぐオフライン', () => {
    expect(connectionStatus({ browserOnline: false, fromCacheSince: null, now: T })).toBe('offline');
  });

  it('fromCache が9秒続いた → まだオンライン', () => {
    expect(connectionStatus({ browserOnline: true, fromCacheSince: T - 9000, now: T })).toBe('online');
  });

  it('fromCache が10秒続いた → オフライン（ちょうど10秒を含む）', () => {
    expect(OFFLINE_AFTER_MS).toBe(10_000);
    expect(connectionStatus({ browserOnline: true, fromCacheSince: T - 10_000, now: T })).toBe('offline');
    expect(connectionStatus({ browserOnline: true, fromCacheSince: T - 60_000, now: T })).toBe('offline');
  });
});

describe('statusBarView（ヘッダーの表示）', () => {
  const view = (connection: 'online' | 'offline', pendingWrites = 0, pendingUnknown = false) => statusBarView({ connection, pendingWrites, pendingUnknown });

  it('オンラインで、未送信なし → オンライン', () => {
    expect(view('online')).toEqual({ connection: 'online', pendingCount: null });
  });

  it('未送信の件数がある → 未送信◯件', () => {
    expect(view('online', 3)).toEqual({ connection: 'pending', pendingCount: 3 });
  });

  it('件数は不明だが、未送信がある（再読み込み後）→ 未送信あり', () => {
    expect(view('online', 0, true)).toEqual({ connection: 'pending', pendingCount: null });
  });

  it('件数があれば、不明の印より、件数を出す', () => {
    expect(view('online', 2, true)).toEqual({ connection: 'pending', pendingCount: 2 });
  });

  it('オフラインは、未送信より優先する。数えられている件数は渡す', () => {
    expect(view('offline')).toEqual({ connection: 'offline', pendingCount: null });
    expect(view('offline', 2)).toEqual({ connection: 'offline', pendingCount: 2 });
    expect(view('offline', 0, true)).toEqual({ connection: 'offline', pendingCount: null });
  });
});
