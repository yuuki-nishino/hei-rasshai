import { describe, expect, it } from 'vitest';
import { formatDay, formatDayRange, isValidDay, toDay } from '../../src/lib/domain';

describe('toDay', () => {
  it('Asia/Tokyo の暦日を返す（UTC では前日の 15:00 以降が、翌日になる）', () => {
    expect(toDay(new Date('2026-07-31T14:59:59Z'))).toBe('2026-07-31');
    expect(toDay(new Date('2026-07-31T15:00:00Z'))).toBe('2026-08-01');
  });
});

describe('isValidDay', () => {
  it.each(['2026-08-01', '2028-02-29'])('%s は正しい', (s) => expect(isValidDay(s)).toBe(true));
  it.each(['', '2026-8-1', '2026/08/01', '2026-02-30', '2027-02-29', '2026-13-01'])('%s は正しくない', (s) => expect(isValidDay(s)).toBe(false));
});

describe('formatDay / formatDayRange', () => {
  it('月・日・曜日', () => {
    expect(formatDay('2026-08-01')).toBe('8月1日（土）');
    expect(formatDay('2026-08-01', { year: true })).toBe('2026年8月1日（土）');
  });
  it('同じ日なら1つ、違えば「〜」でつなぐ', () => {
    expect(formatDayRange('2026-08-01', '2026-08-01')).toBe('8月1日（土）');
    expect(formatDayRange('2026-08-01', '2026-08-02')).toBe('8月1日（土）〜8月2日（日）');
  });
});
