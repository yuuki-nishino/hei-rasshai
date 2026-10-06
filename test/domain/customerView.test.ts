// お客様画面の状態の判定（testing.md §2 の customerView。screens.md §4.1 の表）
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_STATUS_TEXT,
  customerView,
  formatClock,
  parseOrderLink,
  shouldVibrate,
  SLOW_AFTER_MS,
  type CustomerOrder,
} from '../../src/lib/domain/customerView';

const order: CustomerOrder = { number: 7, status: 'preparing', items: [{ name: '焼きそば', price: 500, qty: 2 }], total: 1000 };

describe('customerView', () => {
  it('まだ何も届いていない → loading。8秒続いたら slow（「通信が不安定です」を添える）', () => {
    expect(customerView(null, 0)).toEqual({ state: 'loading', slow: false });
    expect(customerView(null, SLOW_AFTER_MS - 1)).toEqual({ state: 'loading', slow: false });
    expect(customerView(null, SLOW_AFTER_MS)).toEqual({ state: 'loading', slow: true });
  });

  it('文書が無く、サーバーの結果（fromCache = false）→ notFound', () => {
    expect(customerView({ kind: 'doc', order: null, fromCache: false }, 0)).toEqual({ state: 'notFound' });
  });

  it('文書が無く、キャッシュの結果（fromCache = true。オフライン）→ notFound にしない。loading（8秒続いたら slow）', () => {
    expect(customerView({ kind: 'doc', order: null, fromCache: true }, 0)).toEqual({ state: 'loading', slow: false });
    expect(customerView({ kind: 'doc', order: null, fromCache: true }, SLOW_AFTER_MS)).toEqual({ state: 'loading', slow: true });
  });

  it('エラー → error', () => {
    expect(customerView({ kind: 'error' }, 0)).toEqual({ state: 'error' });
  });

  it('文書がある → active。fromCache は、そのまま渡す（「通信が不安定です」を出すため）', () => {
    expect(customerView({ kind: 'doc', order, fromCache: false }, 0)).toEqual({ state: 'active', order, fromCache: false });
    expect(customerView({ kind: 'doc', order, fromCache: true }, 99999)).toEqual({ state: 'active', order, fromCache: true });
  });

  it('お客様に渡す注文の型には、支払い方法・メモ・スタッフの情報が無い', () => {
    const keys = Object.keys(order).sort();
    expect(keys).toEqual(['items', 'number', 'status', 'total']);
  });
});

describe('shouldVibrate', () => {
  it('調理中 → できあがり、のときだけ振動する', () => {
    expect(shouldVibrate('preparing', 'ready')).toBe(true);
  });
  it('最初の表示では、振動しない（できあがりの注文を、あとから開いたとき）', () => {
    expect(shouldVibrate(null, 'ready')).toBe(false);
  });
  it('ほかの変化では、振動しない', () => {
    expect(shouldVibrate('ready', 'ready')).toBe(false);
    expect(shouldVibrate('ready', 'done')).toBe(false);
    expect(shouldVibrate('ready', 'preparing')).toBe(false);
    expect(shouldVibrate('done', 'ready')).toBe(false);
    expect(shouldVibrate('cancelled', 'ready')).toBe(false);
    expect(shouldVibrate('preparing', 'cancelled')).toBe(false);
  });
});

describe('CUSTOMER_STATUS_TEXT（SPEC 6.7）', () => {
  it('バッジと案内文', () => {
    expect(CUSTOMER_STATUS_TEXT.preparing).toEqual({ badge: '調理中', message: 'ただいま調理中です。できあがるまでこのままお待ちください' });
    expect(CUSTOMER_STATUS_TEXT.ready).toEqual({ badge: 'お待ち！', message: '受け渡し口までお越しください' });
    expect(CUSTOMER_STATUS_TEXT.done).toEqual({ badge: 'お渡し済み', message: '毎度おおきに！' });
    expect(CUSTOMER_STATUS_TEXT.cancelled.badge).toBe('取り消し');
  });
});

describe('parseOrderLink', () => {
  const id = 'AbCdEfGhIjKlMnOpQrSt'; // 20文字
  it('e・o が英数字20文字なら、取り出す', () => {
    expect(parseOrderLink(`?e=${id}&o=${id.toLowerCase()}`)).toEqual({ eventId: id, orderId: id.toLowerCase() });
  });
  it.each(['', '?e=abc&o=def', `?e=${id}`, `?o=${id}`, `?e=${id}&o=${id}x`, `?e=${id}&o=${id.slice(1)}`, `?e=${id}&o=${id.slice(0, 19)}-`, `?e=${id}&o=${'あ'.repeat(20)}`])(
    '%s は不正（null）',
    (search) => {
      expect(parseOrderLink(search)).toBeNull();
    },
  );
});

describe('formatClock', () => {
  it('Asia/Tokyo の時刻（24時間制）', () => {
    expect(formatClock(new Date('2026-08-01T05:05:09Z'))).toBe('14:05:09');
  });
});
