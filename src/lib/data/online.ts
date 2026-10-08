// オンライン必須の書き込みの前の確認（data-access.md §3.9）
import { disableNetwork, enableNetwork, getDocFromServer, type DocumentReference } from 'firebase/firestore';
import { db } from '../firebase/staff';
import { AppError, toAppError } from './errors';

export const ONLINE_CHECK_TIMEOUT_MS = 8000;

/**
 * サーバーに届くかを、getDocFromServer で確かめる。届かない（unavailable・8秒で応答なし）なら AppError('offline') を投げる。
 * permission-denied・not-found は、サーバーに届いた証拠なので、通信ありとする（まだ無い文書でも使える）
 */
export async function assertOnline(ref: DocumentReference): Promise<void> {
  try {
    await withTimeout(getDocFromServer(ref));
  } catch (e) {
    const err = toAppError(e);
    if (err.code === 'permission' || err.code === 'not-found') return;
    throw err.code === 'timeout' ? new AppError('offline', { cause: e }) : err;
  }
}

/** 8秒で応答がなければ、AppError('timeout') で失敗させる（元の処理は、止めない） */
export async function withTimeout<T>(p: Promise<T>, ms = ONLINE_CHECK_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError('timeout')), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Firestore に、すぐ再接続させる。通信が戻っても、SDK は再接続を（間隔を空けて）待つため、表示の戻りが遅れる。
 * ネットワークを一度止めて入れ直すと、待たずに再接続する。未送信の書き込みは、そのまま残る（#19）
 */
export async function reconnectNow(): Promise<void> {
  try {
    await disableNetwork(db);
  } finally {
    await enableNetwork(db).catch(() => {});
  }
}
