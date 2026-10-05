// オンライン必須の書き込みの前の確認（data-access.md §3.9）
import { getDocFromServer, type DocumentReference } from 'firebase/firestore';
import { AppError, toAppError } from './errors';

export const ONLINE_CHECK_TIMEOUT_MS = 8000;

/**
 * サーバーに届くかを、getDocFromServer で確かめる。届かない（unavailable・8秒で応答なし）なら AppError('offline') を投げる。
 * permission-denied・not-found は、サーバーに届いた証拠なので、通信ありとする（まだ無い文書でも使える）
 */
export async function assertOnline(ref: DocumentReference): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError('offline')), ONLINE_CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([getDocFromServer(ref), timeout]);
  } catch (e) {
    const err = toAppError(e);
    if (err.code === 'permission' || err.code === 'not-found') return;
    throw err.code === 'timeout' ? new AppError('offline', { cause: e }) : err;
  } finally {
    clearTimeout(timer);
  }
}
