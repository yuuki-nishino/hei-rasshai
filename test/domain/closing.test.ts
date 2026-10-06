// レジ締め（testing.md §2 の closingView、data-model.md §5.3）
import { describe, expect, it } from 'vitest';
import { calcDiff, calcExpectedCash, closingView, diffKind, normalizeClosingNote, parseCashAmount } from '../../src/lib/domain';

describe('calcExpectedCash / calcDiff / diffKind', () => {
  it('あるはずの現金 ＝ 準備金 ＋ 現金売上。差額 ＝ 数えた現金 − あるはずの現金', () => {
    expect(calcExpectedCash(10000, 15000)).toBe(25000);
    expect(calcDiff(24900, 25000)).toBe(-100);
    expect(calcDiff(25000, 25000)).toBe(0);
    expect(calcDiff(25100, 25000)).toBe(100);
  });
  it('差額の符号：0 は一致、正は多い、負は不足', () => {
    expect(diffKind(0)).toBe('match');
    expect(diffKind(100)).toBe('over');
    expect(diffKind(-100)).toBe('short');
  });
});

describe('closingView', () => {
  const saved = { floatCash: 10000, expectedCash: 25000 };

  it('締めが無い：準備金の初期値は、イベントの準備金。「締め後に変更あり」は出ない', () => {
    expect(closingView({ cashTotal: 15000 }, null, 8000)).toEqual({ initialFloat: 8000, changedAfterClosing: false, recomputedExpected: null });
  });

  it('締めがある：準備金の初期値は、保存された準備金（イベントの値より優先）', () => {
    expect(closingView({ cashTotal: 15000 }, saved, 8000).initialFloat).toBe(10000);
  });

  it('現金売上が、締めたときと同じなら、変更なし', () => {
    expect(closingView({ cashTotal: 15000 }, saved, 8000)).toMatchObject({ changedAfterClosing: false, recomputedExpected: 25000 });
  });

  it('締めた後に、現金売上が変わった（注文の追加・取り消し・支払い方法の変更）→ 変更あり', () => {
    expect(closingView({ cashTotal: 15500 }, saved, 8000).changedAfterClosing).toBe(true); // 追加
    expect(closingView({ cashTotal: 14500 }, saved, 8000).changedAfterClosing).toBe(true); // 取り消し・支払い方法の変更
  });

  it('保存済みの準備金で再計算する（イベントの準備金や、画面で入力中の準備金では、変更ありにならない）', () => {
    // イベントの準備金が 8000 に変わっていても、保存済み（10000）で比べる
    expect(closingView({ cashTotal: 15000 }, saved, 99999).changedAfterClosing).toBe(false);
  });

  it('既知の制約：現金 → PayPay と、PayPay → 現金が、同額で相殺されると、検知できない', () => {
    expect(closingView({ cashTotal: 15000 }, saved, 8000).changedAfterClosing).toBe(false);
  });
});

describe('parseCashAmount', () => {
  it.each([
    ['0', 0],
    ['10000', 10000],
    ['１０，０００円', 10000],
    ['¥5,000', 5000],
    ['10000000', 10_000_000],
  ])('%s → %d', (s, v) => expect(parseCashAmount(s)).toBe(v));
  it.each(['', '  ', '-1', '1.5', 'abc', '1,00', '10000001'])('%s は拒否（null）', (s) => expect(parseCashAmount(s)).toBeNull());
});

describe('normalizeClosingNote', () => {
  it('前後の空白を除く。改行は空白に。200文字まで（絵文字は2文字）', () => {
    expect(normalizeClosingNote('  5番 現金→PayPay ¥500 ')).toBe('5番 現金→PayPay ¥500');
    expect(normalizeClosingNote('a\nb')).toBe('a b');
    expect(normalizeClosingNote('あ'.repeat(200))).toHaveLength(200);
    expect(normalizeClosingNote('あ'.repeat(201))).toBeNull();
    expect(normalizeClosingNote('🍜'.repeat(101))).toBeNull();
  });
});
