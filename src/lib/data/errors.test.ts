import { describe, expect, it } from 'vitest';
import { AppError, classifyAuthError } from './errors';

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
