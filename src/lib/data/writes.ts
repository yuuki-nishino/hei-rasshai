// 未送信の書き込みの数え上げ（data-access.md §6.2）。
// 「渡した」「取り消し」は、書いた直後に注文が購読の範囲から外れ、hasPendingWrites では数えられないため、アプリ側で数える
import { signal } from '@preact/signals';
import { waitForPendingWrites } from 'firebase/firestore';
import { db } from '../firebase/staff';
import { toAppError, type AppError } from './errors';

/** 未送信の書き込みの数（この画面を開いてからの分） */
export const pendingWrites = signal(0);
/** 数は分からないが、未送信がある（再読み込みの直後） */
export const pendingUnknown = signal(false);

/**
 * 書き込みを数える。サーバーが受け取る（または、拒否する）まで、未送信として数える。
 * 拒否されたとき（他のメンバーが先に別の操作をした場合など）は、onRejected で知らせる
 */
export function trackWrite(p: Promise<void>, onRejected: (e: AppError) => void): void {
  pendingWrites.value++;
  p.then(
    () => {},
    (e: unknown) => {
      try {
        onRejected(toAppError(e));
      } catch (err) {
        console.error(err); // 通知の失敗で、unhandled rejection にしない（PR #48 のレビュー C4）
      }
    },
  ).finally(() => {
    pendingWrites.value--;
  });
}

/**
 * 再読み込みの直後に、前の画面の未送信が残っているかを確かめる。
 * waitForPendingWrites が waitMs で終わらなければ、「未送信あり」（件数は不明）にし、終わったら消す
 */
export async function checkPendingAfterReload(waitMs = 1500): Promise<void> {
  const settled = waitForPendingWrites(db).then(
    () => true,
    () => true, // 確かめられないときは、表示しない（Firestore を終了したときなど）
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), waitMs);
  });
  const done = await Promise.race([settled, timeout]);
  clearTimeout(timer);
  if (done) return;
  pendingUnknown.value = true;
  await settled;
  pendingUnknown.value = false;
}
