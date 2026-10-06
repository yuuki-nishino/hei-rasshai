import { describe, expect, it } from 'vitest';
import { addDays, formatDateTime, formatDay, formatDayRange, isValidDay, toDay } from '../../src/lib/domain';

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

describe('formatDateTime', () => {
  it('Asia/Tokyo の日付と、24時間制の時刻', () => {
    expect(formatDateTime(new Date('2026-08-01T05:05:00Z'))).toBe('8月1日（土）14:05');
    expect(formatDateTime(new Date('2026-07-31T15:00:00Z'))).toBe('8月1日（土）00:00');
  });
});

describe('addDays', () => {
  it('月・年をまたぐ。うるう日を数える', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-08-01', 0)).toBe('2026-08-01');
  });
});
