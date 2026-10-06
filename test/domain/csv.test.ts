// CSV・集計テキスト（testing.md §2、data-model.md §5.5）
import { describe, expect, it } from 'vitest';
import { buildCsv, buildSummaryText, csvCell, csvFileName, summarize, type CsvOrder } from '../../src/lib/domain';

const at = (h: number, m: number, s: number) => new Date(Date.UTC(2026, 7, 1, h - 9, m, s)); // JST の h:m:s
const base: CsvOrder = {
  day: '2026-08-01',
  number: 1,
  status: 'done',
  payment: 'cash',
  total: 1200,
  items: [
    { name: '焼きそば', qty: 2 },
    { name: 'ラムネ', qty: 1 },
  ],
  note: '',
  createdAt: at(10, 0, 5),
  readyAt: at(10, 3, 0),
  doneAt: at(10, 4, 9),
  cancelledAt: null,
};

describe('csvCell', () => {
  it('"で囲み、中の"は""にする', () => expect(csvCell('a"b,c')).toBe('"a""b,c"'));
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])('先頭が %j なら、先頭に \' を足す', (s) => {
    expect(csvCell(s)).toBe(`"'${s}"`);
  });
  it('先頭以外の = + - @ は、そのまま', () => expect(csvCell('a=b-c')).toBe('"a=b-c"'));
  it('数値は、文字にして囲む', () => expect(csvCell(1200)).toBe('"1200"'));
  it('改行を含むセルも、囲んで保つ', () => expect(csvCell('a\nb')).toBe('"a\nb"'));
});

describe('buildCsv', () => {
  it('BOM 付き・CRLF・見出しの列', () => {
    const csv = buildCsv([]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿"日付","番号","状態","支払い","合計","品目","メモ","作成","完成","渡し","取り消し"\r\n');
  });

  it('1件：状態・支払い・品目（; 区切り）・JST の時刻', () => {
    const lines = buildCsv([base]).split('\r\n');
    expect(lines[1]).toBe('"2026-08-01","1","お渡し済み","現金","1200","焼きそば×2; ラムネ×1","","10:00:05","10:03:00","10:04:09",""');
    expect(lines[2]).toBe(''); // 末尾の CRLF
  });

  it('取り消しも含める（状態と取り消し時刻で区別）。PayPay・メモ', () => {
    const csv = buildCsv([{ ...base, status: 'cancelled', payment: 'paypay', note: '5番と取り違え', doneAt: null, cancelledAt: at(10, 9, 0) }]);
    expect(csv).toContain('"取り消し","PayPay","1200"');
    expect(csv).toContain('"5番と取り違え"');
    expect(csv).toContain('"10:09:00"');
  });

  it('メモ・品名が式で始まっても、無害化される', () => {
    const csv = buildCsv([{ ...base, note: '=HYPERLINK("x")', items: [{ name: '-焼き', qty: 1 }] }]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"'-焼き×1"`); // 品目のセルは、先頭が - なので無害化される
  });

  it('0時台の時刻は、「00:05:00」（24 を使わない）', () => {
    const csv = buildCsv([{ ...base, createdAt: at(0, 5, 0) }]);
    expect(csv).toContain('"00:05:00"');
  });

  it('1000番以上でも、そのまま出す', () => {
    expect(buildCsv([{ ...base, number: 1234 }])).toContain('"2026-08-01","1234"');
  });
});

describe('csvFileName', () => {
  it('{イベント名}_{日付}_注文.csv', () => expect(csvFileName('夏祭り', '2026-08-01')).toBe('夏祭り_2026-08-01_注文.csv'));
  it('/ \\ : * ? " < > | を _ にする', () => expect(csvFileName('a/b\\c:d*e?f"g<h>i|j', '2026-08-01')).toBe('a_b_c_d_e_f_g_h_i_j_2026-08-01_注文.csv'));
  it('制御文字も _ にする。空なら「イベント」', () => {
    expect(csvFileName('a\nb', '2026-08-01')).toBe('a_b_2026-08-01_注文.csv');
    expect(csvFileName('  ', '2026-08-01')).toBe('イベント_2026-08-01_注文.csv');
  });
});

describe('buildSummaryText', () => {
  const orders = [
    { ...base, total: 1000, items: [{ menuId: 'y', name: '焼きそば', price: 500, qty: 2 }] },
    { ...base, number: 2, payment: 'paypay' as const, total: 200, items: [{ menuId: 'r', name: 'ラムネ', price: 200, qty: 1 }] },
  ];

  it('現金・PayPay・合計（件数つき）と、メニュー別', () => {
    const text = buildSummaryText('夏祭り', '2026-08-01', summarize(orders));
    expect(text).toBe(
      ['夏祭り 2026年8月1日（土）の売上', '現金：¥1,000（1件）', 'PayPay：¥200（1件）', '合計：¥1,200（2件）', '', 'メニュー別', '焼きそば ¥500×2 ＝ ¥1,000', 'ラムネ ¥200×1 ＝ ¥200'].join('\n'),
    );
  });

  it('0件なら、メニュー別を出さない', () => {
    expect(buildSummaryText('夏祭り', '2026-08-01', summarize([]))).toBe(
      ['夏祭り 2026年8月1日（土）の売上', '現金：¥0（0件）', 'PayPay：¥0（0件）', '合計：¥0（0件）'].join('\n'),
    );
  });
});
