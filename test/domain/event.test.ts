import { describe, expect, it } from 'vitest';
import { memberDisplayName, validateEventForm, type EventForm } from '../../src/lib/domain';

const form = (patch: Partial<EventForm> = {}): EventForm => ({
  name: '夏まつり',
  startDate: '2026-08-01',
  endDate: '2026-08-02',
  floatCash: '10000',
  ...patch,
});

describe('validateEventForm', () => {
  it('正しい入力は、型を整えて返す（名前の前後の空白を除く）', () => {
    expect(validateEventForm(form({ name: '  夏まつり  ' }))).toEqual({
      ok: true,
      value: { name: '夏まつり', startDate: '2026-08-01', endDate: '2026-08-02', floatCash: 10000 },
    });
  });

  it('準備金：空は0円。全角数字・カンマを受け付ける。上限は10,000,000円', () => {
    const cash = (floatCash: string) => {
      const r = validateEventForm(form({ floatCash }));
      return r.ok ? r.value.floatCash : 'error';
    };
    expect(cash('')).toBe(0);
    expect(cash('１０，０００')).toBe(10000);
    expect(cash('10,000')).toBe(10000);
    expect(cash('10000000')).toBe(10000000);
    expect(cash('10000001')).toBe('error');
    expect(cash('-1')).toBe('error');
    expect(cash('100.5')).toBe('error');
    expect(cash('abc')).toBe('error');
  });

  it('名前：空・空白だけ・61文字は拒否。60文字は許可。絵文字は2文字と数える（ルールと同じ）', () => {
    expect(validateEventForm(form({ name: '' })).ok).toBe(false);
    expect(validateEventForm(form({ name: '   ' })).ok).toBe(false);
    expect(validateEventForm(form({ name: 'あ'.repeat(61) })).ok).toBe(false);
    expect(validateEventForm(form({ name: 'あ'.repeat(60) })).ok).toBe(true);
    expect(validateEventForm(form({ name: '🍜'.repeat(30) })).ok).toBe(true);
    expect(validateEventForm(form({ name: '🍜'.repeat(31) })).ok).toBe(false);
  });

  it('日付：終了日が開始日より前・不正な日付は拒否。同じ日は許可', () => {
    expect(validateEventForm(form({ endDate: '2026-07-31' }))).toMatchObject({ ok: false, errors: { endDate: expect.any(String) } });
    expect(validateEventForm(form({ startDate: '2026-02-30' }))).toMatchObject({ ok: false, errors: { startDate: expect.any(String) } });
    expect(validateEventForm(form({ endDate: '2026-08-01' })).ok).toBe(true);
  });
});

describe('memberDisplayName（testing.md §4 #26 の計算部分）', () => {
  it('Googleの表示名を、前後の空白を除いて使う', () => {
    expect(memberDisplayName({ displayName: ' 山田 太郎 ', email: 'taro@example.com' })).toBe('山田 太郎');
  });

  it('表示名が null・空なら、メールの @ より前', () => {
    expect(memberDisplayName({ displayName: null, email: 'taro@example.com' })).toBe('taro');
    expect(memberDisplayName({ displayName: '  ', email: 'taro@example.com' })).toBe('taro');
  });

  it('61文字以上は、60文字に切り詰める。絵文字は2文字と数え、途中では切らない', () => {
    expect(memberDisplayName({ displayName: 'あ'.repeat(61), email: null })).toBe('あ'.repeat(60));
    expect(memberDisplayName({ displayName: '🍜'.repeat(31), email: null })).toBe('🍜'.repeat(30));
    expect(memberDisplayName({ displayName: `あ${'🍜'.repeat(30)}`, email: null })).toBe(`あ${'🍜'.repeat(29)}`); // 59文字
  });
});
