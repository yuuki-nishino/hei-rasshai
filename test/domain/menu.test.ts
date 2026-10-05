import { describe, expect, it } from 'vitest';
import { nextMenuOrder, parseBulkMenu, parseMenuName, parsePrice, reorderMenu, sortMenu } from '../../src/lib/domain';

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
    ['１００，０００', 100000],
    [' 500 ', 500],
    ['100000', 100000],
  ])('%s → %d', (s, v) => expect(parsePrice(s)).toBe(v));
  it.each(['', '0', '100001', '-1', '500.5', 'abc', '5 00 0円円', '1,00', '1,0,0', ',100', '10000,0'])('%s は拒否', (s) => expect(parsePrice(s)).toBeNull());
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

describe('parseBulkMenu（data-model.md §5.6、testing.md §2）', () => {
  it('例：空白・カンマ・全角の空白と数字・「円」→ 3件', () => {
    expect(parseBulkMenu('たこ焼き 500\nラムネ,200\n焼きそば\u3000６００円')).toEqual({
      ok: [
        { line: 1, name: 'たこ焼き', price: 500 },
        { line: 2, name: 'ラムネ', price: 200 },
        { line: 3, name: '焼きそば', price: 600 },
      ],
      errors: [],
    });
  });

  it.each([
    ['コロン', 'かき氷:300', 'かき氷', 300],
    ['全角のコロン', 'かき氷：300', 'かき氷', 300],
    ['タブ', 'かき氷\t300', 'かき氷', 300],
    ['¥ 付き', 'かき氷 ¥300', 'かき氷', 300],
    ['￥ 付き', 'かき氷 ￥３００', 'かき氷', 300],
    ['全角のカンマ', 'かき氷，300', 'かき氷', 300],
    ['3桁区切り', 'ビール 1,000', 'ビール', 1000],
    ['全角の3桁区切り', 'ビール\u3000１，０００円', 'ビール', 1000],
    ['区切りが連続', 'ビール ,  500', 'ビール', 500],
    ['名前に空白', 'たこ焼き 8個入り 600', 'たこ焼き 8個入り', 600],
    ['前後の空白', '  ラムネ 200  ', 'ラムネ', 200],
  ])('%s', (_label, text, name, price) => {
    expect(parseBulkMenu(text)).toEqual({ ok: [{ line: 1, name, price }], errors: [] });
  });

  it('空行は無視し、行番号は元の行で数える（CRLF も可）', () => {
    expect(parseBulkMenu('\r\nたこ焼き 500\r\n\r\n  \r\nラムネ 200').ok.map((l) => l.line)).toEqual([2, 5]);
  });

  it.each([
    ['価格なし', 'たこ焼き', '価格がありません'],
    ['名前なし', '500円', '品名がありません'],
    ['価格が0', 'たこ焼き 0', '価格は1〜100,000円'],
    ['価格が範囲外', 'たこ焼き 100001', '価格は1〜100,000円'],
    ['1,0,0（末尾の0だけが価格になり、範囲外）', '焼き 1,0,0', '価格は1〜100,000円'],
    ['名前が41文字', `${'あ'.repeat(41)} 500`, '品名は40文字まで'],
  ])('エラー行：%s', (_label, text, reason) => {
    const r = parseBulkMenu(`ラムネ 200\n${text}`);
    expect(r.ok).toHaveLength(1);
    expect(r.errors).toEqual([{ line: 2, text, reason: expect.stringContaining(reason) }]);
  });
});
