// 端末のキャッシュ（IndexedDB）の消去（data-access.md §8）
import { clearIndexedDbPersistence, terminate, waitForPendingWrites } from 'firebase/firestore';
import { db } from '../firebase/staff';
import { toAppError } from './errors';

/** 未送信の書き込みがあるか。waitForPendingWrites が ms 以内に終わらなければ、あるとみなす */
export async function hasPendingWrites(ms = 1500): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<true>((resolve) => {
    timer = setTimeout(() => resolve(true), ms);
  });
  try {
    return await Promise.race([waitForPendingWrites(db).then(() => false), timeout]);
  } catch {
    return true; // 確かめられないときは、消さない側に倒す
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Firestore を終了し、端末のキャッシュを丸ごと消す（未送信も消える）。この後は db を使えないため、呼んだ側で画面を再読み込みする。
 * 別のタブが開いていると消せない（failed-precondition → AppError('conflict')）
 */
export async function clearLocalCache(): Promise<void> {
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (e) {
    throw toAppError(e);
  }
}
