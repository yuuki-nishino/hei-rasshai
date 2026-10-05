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
 * 別のタブが開いていても、失敗しない：SDK（persistentMultipleTabManager）は、IndexedDB の削除の知らせ（versionchange）を受けると、
 * そのタブの Firestore を終了させる。終了したタブは使えなくなるため、呼ぶ前に、ほかのタブへ知らせて再読み込みさせる
 * （state/cacheClear.ts の BroadcastChannel。PR #34 のレビュー K1）。失敗は、IndexedDB そのもののエラーなど
 */
export async function clearLocalCache(): Promise<void> {
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (e) {
    throw toAppError(e);
  }
}
