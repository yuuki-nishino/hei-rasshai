// 孤立した members の掃除の条件（data-access.md §3.2、testing.md §4 #15・#16a・#16b の判定部分）
import { describe, expect, it, vi } from 'vitest';
import { resolveMyEvents, type EventFetch, type MyEventsDeps, type ServerCheck } from './myEvents';
import type { EventDoc } from './types';

const ev = (id: string, startDate: string, name = id): EventDoc => ({
  id,
  name,
  startDate,
  endDate: startDate,
  floatCash: 0,
  ownerUid: 'o',
  deleting: false,
});

function deps(fetches: Record<string, EventFetch>, server: Record<string, ServerCheck> = {}) {
  return {
    getEvent: vi.fn(async (id: string) => fetches[id]!),
    getEventFromServer: vi.fn(async (id: string) => server[id] ?? 'error'),
    deleteMyMember: vi.fn(async () => {}),
  } satisfies MyEventsDeps;
}

describe('resolveMyEvents', () => {
  it('取得できたイベントを、開始日の新しい順に出す（同じ日は名前順）', async () => {
    const d = deps({
      a: { kind: 'found', event: ev('a', '2026-08-01', 'b') },
      b: { kind: 'found', event: ev('b', '2026-09-01') },
      c: { kind: 'found', event: ev('c', '2026-08-01', 'a') },
    });
    expect((await resolveMyEvents(['a', 'b', 'c'], d)).map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect(d.getEventFromServer).not.toHaveBeenCalled();
  });

  it('#15：サーバーで存在しないと確かめられたときだけ、自分の members を消し、一覧に出さない', async () => {
    const d = deps({ x: { kind: 'missing' } }, { x: 'missing' });
    expect(await resolveMyEvents(['x'], d)).toEqual([]);
    expect(d.deleteMyMember).toHaveBeenCalledWith('x');
  });

  it('#16a：permission-denied のイベントは、一覧に出さない。members も消さない（サーバーへの確認もしない）', async () => {
    const d = deps({ x: { kind: 'denied' } });
    expect(await resolveMyEvents(['x'], d)).toEqual([]);
    expect(d.getEventFromServer).not.toHaveBeenCalled();
    expect(d.deleteMyMember).not.toHaveBeenCalled();
  });

  it.each<ServerCheck>(['error', 'denied', 'exists'])('#16b：キャッシュで存在しなくても、サーバーの確認が %s なら、members を消さない', async (check) => {
    const d = deps({ x: { kind: 'missing' } }, { x: check });
    expect(await resolveMyEvents(['x'], d)).toEqual([]);
    expect(d.deleteMyMember).not.toHaveBeenCalled();
  });

  it('#16b：取得が通信エラー（キャッシュにも無い）なら、消さない。ほかのイベントは出す', async () => {
    const d = deps({ x: { kind: 'error' }, a: { kind: 'found', event: ev('a', '2026-08-01') } });
    expect((await resolveMyEvents(['x', 'a'], d)).map((e) => e.id)).toEqual(['a']);
    expect(d.getEventFromServer).not.toHaveBeenCalled();
    expect(d.deleteMyMember).not.toHaveBeenCalled();
  });

  it('掃除に失敗しても、一覧は返す', async () => {
    const d = deps({ x: { kind: 'missing' }, a: { kind: 'found', event: ev('a', '2026-08-01') } }, { x: 'missing' });
    d.deleteMyMember.mockRejectedValueOnce(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await resolveMyEvents(['x', 'a'], d)).map((e) => e.id)).toEqual(['a']);
    warn.mockRestore();
  });
});
