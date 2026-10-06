// 売上の集計（testing.md §2 の summarize、data-model.md §5.2）
import { describe, expect, it } from 'vitest';
import { summarize, type SummaryOrder } from '../../src/lib/domain';

const line = (menuId: string, name: string, price: number, qty: number) => ({ menuId, name, price, qty });
let n = 0;
function order(patch: Partial<SummaryOrder> & { items: SummaryOrder['items'] }): SummaryOrder {
  const total = patch.items.reduce((s, i) => s + i.price * i.qty, 0);
  return { day: '2026-08-01', number: ++n, status: 'done', payment: 'cash', total, createdAt: new Date(2026, 7, 1, 10, n), ...patch };
}

describe('summarize', () => {
  it('空：すべて0', () => {
    expect(summarize([])).toEqual({ cashTotal: 0, cashCount: 0, paypayTotal: 0, paypayCount: 0, grandTotal: 0, grandCount: 0, byItem: [] });
  });

  it('取り消しは、除外する（現金・PayPay・メニュー別のすべてから）', () => {
    const s = summarize([
      order({ items: [line('y', '焼きそば', 500, 2)] }),
      order({ status: 'cancelled', items: [line('y', '焼きそば', 500, 5)] }),
      order({ status: 'cancelled', payment: 'paypay', items: [line('r', 'ラムネ', 200, 1)] }),
    ]);
    expect(s).toMatchObject({ cashTotal: 1000, cashCount: 1, paypayTotal: 0, paypayCount: 0, grandTotal: 1000, grandCount: 1 });
    expect(s.byItem).toHaveLength(1);
    expect(s.byItem[0]).toMatchObject({ menuId: 'y', qty: 2, subtotal: 1000 });
  });

  it('現金とPayPayを分ける。合計・件数は、その和。調理中・できあがり・お渡し済みは、すべて数える', () => {
    const s = summarize([
      order({ status: 'preparing', items: [line('y', '焼きそば', 500, 1)] }),
      order({ status: 'ready', payment: 'paypay', items: [line('t', 'たこ焼き', 400, 1)] }),
      order({ status: 'done', payment: 'paypay', items: [line('t', 'たこ焼き', 400, 2)] }),
      order({ status: 'done', items: [line('r', 'ラムネ', 200, 1)] }),
    ]);
    expect(s).toMatchObject({ cashTotal: 700, cashCount: 2, paypayTotal: 1200, paypayCount: 2, grandTotal: 1900, grandCount: 4 });
  });

  it('同じ品の複数注文は、数量と小計を合算する', () => {
    const s = summarize([order({ items: [line('y', '焼きそば', 500, 2)] }), order({ items: [line('y', '焼きそば', 500, 3)] })]);
    expect(s.byItem).toEqual([{ key: 'y|500', menuId: 'y', name: '焼きそば', price: 500, qty: 5, subtotal: 2500 }]);
  });

  it('価格を変えた品は、別の行になる（過去分は変わらない）。キーは menuId と注文時の価格', () => {
    const s = summarize([order({ items: [line('y', '焼きそば', 500, 2)] }), order({ items: [line('y', '焼きそば', 600, 1)] })]);
    expect(s.byItem.map((i) => [i.key, i.qty, i.subtotal])).toEqual([
      ['y|500', 2, 1000],
      ['y|600', 1, 600],
    ]);
  });

  it('名前を変えても、同じ行（menuId）。名前は、最も新しい注文のもの', () => {
    const s = summarize([
      order({ createdAt: new Date(2026, 7, 1, 12, 0), items: [line('y', '焼きそば大盛り', 500, 1)] }), // 新しい
      order({ createdAt: new Date(2026, 7, 1, 10, 0), items: [line('y', '焼きそば', 500, 1)] }), // 古い（配列では後ろ）
    ]);
    expect(s.byItem).toHaveLength(1);
    expect(s.byItem[0]).toMatchObject({ name: '焼きそば大盛り', qty: 2 });
  });

  it('作成時刻が同じ・未確定のときは、番号の大きい方（未確定は、最も新しい）', () => {
    const t = new Date(2026, 7, 1, 10, 0);
    const same = summarize([order({ number: 5, createdAt: t, items: [line('y', '旧', 500, 1)] }), order({ number: 9, createdAt: t, items: [line('y', '新', 500, 1)] })]);
    expect(same.byItem[0]!.name).toBe('新');
    const pending = summarize([order({ createdAt: t, items: [line('y', '旧', 500, 1)] }), order({ createdAt: null, items: [line('y', '書いたばかり', 500, 1)] })]);
    expect(pending.byItem[0]!.name).toBe('書いたばかり');
  });

  it('取り消した注文の名前は、名前の決定にも使わない', () => {
    const s = summarize([
      order({ createdAt: new Date(2026, 7, 1, 10, 0), items: [line('y', '焼きそば', 500, 1)] }),
      order({ status: 'cancelled', createdAt: new Date(2026, 7, 1, 12, 0), items: [line('y', '取り消しの名前', 500, 1)] }),
    ]);
    expect(s.byItem[0]!.name).toBe('焼きそば');
  });

  it('並び順：小計の降順、同額なら名前の順', () => {
    const s = summarize([
      order({ items: [line('a', 'ラムネ', 200, 1), line('b', 'かき氷', 200, 1), line('c', '焼きそば', 500, 2), line('d', 'あんず飴', 100, 1)] }),
    ]);
    expect(s.byItem.map((i) => i.name)).toEqual(['焼きそば', 'かき氷', 'ラムネ', 'あんず飴']);
  });

  it('1000番以上でも、集計は変わらない', () => {
    const s = summarize([order({ number: 1234, items: [line('y', '焼きそば', 500, 1)] })]);
    expect(s.grandCount).toBe(1);
  });
});
