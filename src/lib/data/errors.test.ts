import { describe, expect, it } from 'vitest';
import { AppError, classifyAuthError, toAppError } from './errors';

const authError = (code: string) => Object.assign(new Error(code), { code });

describe('classifyAuthError（screens.md §3.1）', () => {
  it.each(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'])(
    '%s は、本人の取り消し（何も表示しない）',
    (code) => {
      expect(classifyAuthError(authError(code))).toBe('cancelled');
    },
  );

  it.each([
    ['auth/network-request-failed', 'offline'],
    ['auth/popup-blocked', 'popup-blocked'],
    ['auth/internal-error', 'unknown'],
  ])('%s は、AppError(%s)', (code, expected) => {
    const result = classifyAuthError(authError(code));
    expect(result).toBeInstanceOf(AppError);
    expect((result as AppError).code).toBe(expected);
    expect((result as AppError).cause).toBeInstanceOf(Error);
  });

  it('code の無いエラー・エラーでない値は、unknown', () => {
    expect((classifyAuthError(new Error('x')) as AppError).code).toBe('unknown');
    expect((classifyAuthError(undefined) as AppError).code).toBe('unknown');
  });
});

describe('toAppError（data-access.md §4）', () => {
  it.each([
    ['unavailable', 'offline'],
    ['deadline-exceeded', 'timeout'],
    ['permission-denied', 'permission'],
    ['not-found', 'not-found'],
    ['aborted', 'conflict'],
    ['failed-precondition', 'conflict'],
    ['invalid-argument', 'validation'],
    ['internal', 'unknown'],
  ])('%s → %s', (code, expected) => {
    const e = toAppError(authError(code));
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe(expected);
  });

  it('AppError は、そのまま返す。code の無いものは unknown', () => {
    const original = new AppError('offline');
    expect(toAppError(original)).toBe(original);
    expect(toAppError('x').code).toBe('unknown');
  });
});
