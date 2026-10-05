import { describe, expect, it } from 'vitest';
import { nextMenuOrder, parseMenuName, parsePrice, reorderMenu, sortMenu } from '../../src/lib/domain';

describe('parseMenuName', () => {
  it('前後の空白を除き、1〜40文字（絵文字は2文字）', () => {
    expect(parseMenuName('  焼きそば ')).toBe('焼きそば');
    expect(parseMenuName('あ'.repeat(40))).toBe('あ'.repeat(40));
    expect(parseMenuName('あ'.repeat(41))).toBeNull();
    expect(parseMenuName('🍜'.repeat(21))).toBeNull();
    expect(parseMenuName('   ')).toBeNull();
  });
});

describe('parsePrice', () => {
  it.each([
    ['500', 500],
    ['１，０００', 1000],
    ['1,000円', 1000],
    ['¥300', 300],
    ['1', 1],
    ['100000', 100000],
  ])('%s → %d', (s, v) => expect(parsePrice(s)).toBe(v));
  it.each(['', '0', '100001', '-1', '500.5', 'abc', '5 00 0円円'])('%s は拒否', (s) => expect(parsePrice(s)).toBeNull());
});

describe('sortMenu / nextMenuOrder', () => {
  it('order の昇順、同じ値なら id の順', () => {
    expect(sortMenu([{ id: 'b', order: 10 }, { id: 'a', order: 10 }, { id: 'c', order: 5 }]).map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
  it('追加は 最大 + 10（空なら 10）', () => {
    expect(nextMenuOrder([])).toBe(10);
    expect(nextMenuOrder([{ id: 'a', order: 10 }, { id: 'b', order: 35.5 }])).toBe(45.5);
  });
});

describe('reorderMenu', () => {
  const items = [
    { id: 'a', order: 10 },
    { id: 'b', order: 20 },
    { id: 'c', order: 30 },
  ];
  it('下へ：入れ替えて、変わる品だけを返す', () => {
    expect(reorderMenu(items, 'a', 'down')).toEqual([
      { id: 'b', order: 10 },
      { id: 'a', order: 20 },
    ]);
  });
  it('上へ', () => {
    expect(reorderMenu(items, 'c', 'up')).toEqual([
      { id: 'c', order: 20 },
      { id: 'b', order: 30 },
    ]);
  });
  it('端では動かない。見つからなければ何もしない', () => {
    expect(reorderMenu(items, 'a', 'up')).toEqual([]);
    expect(reorderMenu(items, 'c', 'down')).toEqual([]);
    expect(reorderMenu(items, 'x', 'up')).toEqual([]);
  });
  it('同じ order になっていても動き、全件を 10, 20, 30… に振り直す', () => {
    const same = [
      { id: 'a', order: 10 },
      { id: 'b', order: 10 },
      { id: 'c', order: 10 },
    ];
    expect(reorderMenu(same, 'c', 'up')).toEqual([
      { id: 'c', order: 20 },
      { id: 'b', order: 30 },
    ]);
  });
});
