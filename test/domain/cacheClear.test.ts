// testing.md §4 #28（24時間後の確認）の判断の部分
import { describe, expect, it } from 'vitest';
import { decideCacheClear, lostMemberships, mergeClearMark } from '../../src/lib/domain';

const H = 3600 * 1000;
const mark = { since: 1_000_000, events: ['e1'] };

describe('decideCacheClear', () => {
  it('印が無ければ何もしない', () => {
    expect(decideCacheClear(null, 0, true)).toBe('none');
  });
  it('未送信が無ければ、すぐ消す', () => {
    expect(decideCacheClear(mark, mark.since, false)).toBe('clear');
    expect(decideCacheClear(mark, mark.since + 48 * H, false)).toBe('clear');
  });
  it('#28：未送信があれば、24時間未満は持ち越す。24時間を超えたら、確認を出す', () => {
    expect(decideCacheClear(mark, mark.since + 24 * H - 1, true)).toBe('defer');
    expect(decideCacheClear(mark, mark.since + 24 * H, true)).toBe('ask');
  });
});

describe('lostMemberships / mergeClearMark', () => {
  it('前に見ていて、今は無いイベント', () => {
    expect(lostMemberships(['e1', 'e2', 'e3'], ['e2', 'e4'])).toEqual(['e1', 'e3']);
    expect(lostMemberships([], ['e1'])).toEqual([]);
  });
  it('印は、最初の時刻を残し、イベントを重ねずに足す', () => {
    expect(mergeClearMark(null, ['e1'], 5)).toEqual({ since: 5, events: ['e1'] });
    expect(mergeClearMark({ since: 1, events: ['e1'] }, ['e1', 'e2'], 5)).toEqual({ since: 1, events: ['e1', 'e2'] });
  });
});
