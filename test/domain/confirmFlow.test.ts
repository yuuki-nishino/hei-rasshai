// 確定フローの状態遷移（order-confirm.md §4、testing.md §2 の confirmReducer）
import { describe, expect, it } from 'vitest';
import { canSubmit, confirmReducer, initialConfirmState, type ConfirmContext, type ConfirmEvent, type ConfirmState } from '../../src/lib/domain';

const ctx: ConfirmContext = {
  orderId: 'o1',
  day: '2026-08-01',
  draft: { items: [{ menuId: 'y', name: '焼きそば', price: 500, qty: 2 }], total: 1000, payment: 'cash', qr: true },
  tendered: 1000,
};
const order = { orderId: 'o1', number: 7, day: '2026-08-01', total: 1000, qr: true };

const run = (...events: ConfirmEvent[]) => events.reduce(confirmReducer, initialConfirmState);

describe('confirmReducer', () => {
  it('成功：idle → submitting → done', () => {
    expect(run({ type: 'submit', ctx })).toEqual({ kind: 'submitting', ctx });
    expect(run({ type: 'submit', ctx }, { type: 'succeeded', order })).toEqual({ kind: 'done', ctx, order, recovered: false });
  });

  it('失敗 → もう一度試す：同じ ctx（同じ orderId）で submitting に戻る', () => {
    const s = run({ type: 'submit', ctx }, { type: 'failed', reason: 'timeout' });
    expect(s).toEqual({ kind: 'failed', ctx, reason: 'timeout' });
    expect(confirmReducer(s, { type: 'retry' })).toEqual({ kind: 'submitting', ctx });
  });

  it('失敗 → やめる → found（登録されていた）：成功扱いで done（recovered）', () => {
    const s = run({ type: 'submit', ctx }, { type: 'failed', reason: 'timeout' }, { type: 'abandon' });
    expect(s).toEqual({ kind: 'abandoning', ctx });
    expect(confirmReducer(s, { type: 'found', order })).toEqual({ kind: 'done', ctx, order, recovered: true });
  });

  it('失敗 → やめる → voided：idle（「やめた」の知らせ）。閉じると知らせが消える', () => {
    const s = run({ type: 'submit', ctx }, { type: 'failed', reason: 'offline' }, { type: 'abandon' }, { type: 'voided' });
    expect(s).toEqual({ kind: 'idle', notice: 'voided' });
    expect(canSubmit(s)).toBe(true);
    expect(confirmReducer(s, { type: 'close' })).toEqual(initialConfirmState);
  });

  it('やめる → 確認できない → もう一度確認：void-or-find をやり直す', () => {
    const s = run({ type: 'submit', ctx }, { type: 'failed', reason: 'offline' }, { type: 'abandon' }, { type: 'unverifiable' });
    expect(s).toEqual({ kind: 'unverifiable', ctx });
    expect(canSubmit(s)).toBe(false); // 確認できない間は、次の注文を確定できない
    expect(confirmReducer(s, { type: 'recheck' })).toEqual({ kind: 'abandoning', ctx });
  });

  it('墓標で拒否された（voided）：もう一度試すはできない。新しい ctx（新しい orderId）で確定し直せる', () => {
    const s = run({ type: 'submit', ctx }, { type: 'failed', reason: 'voided' });
    expect(confirmReducer(s, { type: 'retry' })).toBe(s);
    const next = { ...ctx, orderId: 'o2' };
    expect(confirmReducer(s, { type: 'submit', ctx: next })).toEqual({ kind: 'submitting', ctx: next });
  });

  it('decide（#14 の復元）：もう一度確定する（同じ orderId）・やめる', () => {
    const decide: ConfirmState = { kind: 'decide', ctx };
    expect(confirmReducer(decide, { type: 'retry' })).toEqual({ kind: 'submitting', ctx });
    expect(confirmReducer(decide, { type: 'abandon' })).toEqual({ kind: 'abandoning', ctx });
  });

  it('done を閉じると idle に戻る', () => {
    expect(confirmReducer(run({ type: 'submit', ctx }, { type: 'succeeded', order }), { type: 'close' })).toEqual(initialConfirmState);
  });

  it('決められていない組み合わせは、状態を変えない（同じオブジェクト）', () => {
    const submitting = run({ type: 'submit', ctx });
    const cases: [ConfirmState, ConfirmEvent][] = [
      [submitting, { type: 'submit', ctx: { ...ctx, orderId: 'x' } }], // 送信中に、もう一度押しても始めない
      [submitting, { type: 'abandon' }],
      [submitting, { type: 'close' }],
      [initialConfirmState, { type: 'succeeded', order }],
      [initialConfirmState, { type: 'retry' }],
      [initialConfirmState, { type: 'close' }],
      [run({ type: 'submit', ctx }, { type: 'succeeded', order }), { type: 'failed', reason: 'timeout' }], // 成功の後の遅れた失敗
    ];
    for (const [s, e] of cases) expect(confirmReducer(s, e)).toBe(s);
  });
});
