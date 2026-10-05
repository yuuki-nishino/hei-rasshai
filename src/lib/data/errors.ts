// データアクセスのエラー（data-access.md §4）。UI は code で表示を分ける
// Firebase SDK を import しない（エラーの code の文字列だけを見る）。単体テストのため
export type AppErrorCode =
  | 'offline' // 通信できない
  | 'timeout' // 8秒で応答がない
  | 'permission' // 権限がない（メンバーでなくなった、など）
  | 'not-found'
  | 'conflict' // 競合（他の端末が先に変更した）
  | 'validation' // 入力・遷移が不正
  | 'popup-blocked' // ログインのポップアップが、ブラウザに止められた
  | 'unknown';

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = 'AppError';
    this.code = code;
  }
}

function codeOf(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
}

// Firestore のエラーを AppError に変換する（data-access.md §4）。AppError は、そのまま返す
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  switch (codeOf(e)) {
    case 'unavailable':
      return new AppError('offline', { cause: e });
    case 'deadline-exceeded':
      return new AppError('timeout', { cause: e });
    case 'permission-denied':
      return new AppError('permission', { cause: e });
    case 'not-found':
      return new AppError('not-found', { cause: e });
    case 'aborted':
    case 'failed-precondition':
      return new AppError('conflict', { cause: e });
    case 'invalid-argument':
      return new AppError('validation', { cause: e });
    default:
      return new AppError('unknown', { cause: e });
  }
}

// ログインの失敗の分類（screens.md §3.1）。'cancelled' は、本人が閉じた・取り消した（何も表示しない）
export function classifyAuthError(e: unknown): 'cancelled' | AppError {
  switch (codeOf(e)) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': // ボタンの連打で、前のポップアップが取り消された
    case 'auth/user-cancelled':
      return 'cancelled';
    case 'auth/network-request-failed':
      return new AppError('offline', { cause: e });
    case 'auth/popup-blocked':
      return new AppError('popup-blocked', { cause: e });
    default:
      return new AppError('unknown', { cause: e });
  }
}
