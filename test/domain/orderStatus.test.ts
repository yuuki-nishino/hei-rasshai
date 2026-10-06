// 状態遷移（data-model.md §3）と、調理画面の計算（testing.md §2 の canTransition / 遷移で書く項目）
import { describe, expect, it } from 'vitest';
import {
  availableActions,
  dayMark,
  elapsedMinutes,
  sortOrders,
  transitionPatch,
  type OrderAction,
  type OrderStatus,
} from '../../src/lib/domain';

const STATUSES: OrderStatus[] = ['preparing', 'ready', 'done', 'cancelled'];
const ACTIONS: OrderAction[] = ['ready', 'backToPreparing', 'done', 'backToReady', 'cancel', 'restore'];

describe('transitionPatch：data-model.md §3 の全遷移', () => {
  it.each([
    ['完成', { status: 'preparing', cancelledFrom: null }, 'ready', { status: 'ready', readyAt: 'now' }],
    ['調理中に戻す', { status: 'ready', cancelledFrom: null }, 'backToPreparing', { status: 'preparing', readyAt: null }],
    ['渡した', { status: 'ready', cancelledFrom: null }, 'done', { status: 'done', doneAt: 'now' }],
    ['渡したを戻す', { status: 'done', cancelledFrom: null }, 'backToReady', { status: 'ready', doneAt: null }],
    ['取り消し（調理中から）', { status: 'preparing', cancelledFrom: null }, 'cancel', { status: 'cancelled', cancelledFrom: 'preparing', cancelledAt: 'now' }],
    ['取り消し（できあがりから）', { status: 'ready', cancelledFrom: null }, 'cancel', { status: 'cancelled', cancelledFrom: 'ready', cancelledAt: 'now' }],
    ['取り消し（お渡し済みから）', { status: 'done', cancelledFrom: null }, 'cancel', { status: 'cancelled', cancelledFrom: 'done', cancelledAt: 'now' }],
    ['取り消しを戻す（調理中へ）', { status: 'cancelled', cancelledFrom: 'preparing' }, 'restore', { status: 'preparing', cancelledFrom: null, cancelledAt: null }],
    ['取り消しを戻す（お渡し済みへ。時刻は取り消し前のまま）', { status: 'cancelled', cancelledFrom: 'done' }, 'restore', { status: 'done', cancelledFrom: null, cancelledAt: null }],
  ] as const)('%s', (_label, order, action, expected) => {
    expect(transitionPatch(order, action)).toEqual(expected);
  });

  it('許される遷移は、上の9つだけ。ほかの組み合わせは、書く前に拒否する（null）', () => {
    const allowed = new Set([
      'preparing:ready',
      'ready:backToPreparing',
      'ready:done',
      'done:backToReady',
      'preparing:cancel',
      'ready:cancel',
      'done:cancel',
      'cancelled:restore',
    ]);
    for (const status of STATUSES) {
      for (const action of ACTIONS) {
        const patch = transitionPatch({ status, cancelledFrom: status === 'cancelled' ? 'ready' : null }, action);
        expect(patch !== null, `${status} + ${action}`).toBe(allowed.has(`${status}:${action}`));
      }
    }
  });

  it('取り消しを戻すとき、取り消し前の状態（cancelledFrom）が分からなければ拒否', () => {
    expect(transitionPatch({ status: 'cancelled', cancelledFrom: null }, 'restore')).toBeNull();
  });

  it('カードに出す操作は、すべて遷移できる（表と食い違わない）。主の操作が先頭', () => {
    for (const status of STATUSES) {
      for (const action of availableActions(status)) {
        expect(transitionPatch({ status, cancelledFrom: status === 'cancelled' ? 'done' : null }, action), `${status} + ${action}`).not.toBeNull();
      }
    }
    expect(availableActions('preparing')[0]).toBe('ready');
    expect(availableActions('ready')[0]).toBe('done');
  });
});

describe('sortOrders / elapsedMinutes / dayMark', () => {
  it('(day, number) の昇順。前日の調理中が残っても、日付が先', () => {
    const sorted = sortOrders([
      { day: '2026-08-02', number: 1 },
      { day: '2026-08-01', number: 12 },
      { day: '2026-08-02', number: 2 },
      { day: '2026-08-01', number: 3 },
    ]);
    expect(sorted.map((o) => `${o.day}#${o.number}`)).toEqual(['2026-08-01#3', '2026-08-01#12', '2026-08-02#1', '2026-08-02#2']);
  });

  it('経過分数：切り捨て。未確定（null）は0。時計のずれで負にならない', () => {
    const t = new Date('2026-08-01T10:00:00Z');
    expect(elapsedMinutes(t, t.getTime() + 59_999)).toBe(0);
    expect(elapsedMinutes(t, t.getTime() + 60_000)).toBe(1);
    expect(elapsedMinutes(t, t.getTime() + 12 * 60_000 + 30_000)).toBe(12);
    expect(elapsedMinutes(null, Date.now())).toBe(0);
    expect(elapsedMinutes(t, t.getTime() - 5_000)).toBe(0);
  });

  it('日付の印：今日以外だけ（10/3 の形）', () => {
    expect(dayMark('2026-10-03', '2026-10-04')).toBe('10/3');
    expect(dayMark('2026-10-04', '2026-10-04')).toBeNull();
  });
});
