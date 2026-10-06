// レジ締め（data-access.md §3.7）。締めは、サーバーの確かな値でだけ行う（オンライン必須）
import { doc, getDocFromServer, serverTimestamp, setDoc, type Timestamp } from 'firebase/firestore';
import { calcDiff, CASH_MAX, CLOSING_NOTE_MAX } from '../domain/closing';
import { db } from '../firebase/staff';
import { AppError, toAppError } from './errors';
import { assertOnline, withTimeout } from './online';
import type { Closing } from './types';

const closingRef = (eventId: string, day: string) => doc(db, 'events', eventId, 'closings', day);

/**
 * その日のレジ締めを、サーバーから取得する（無ければ null）。キャッシュを使わない：
 * 締め済みかどうか・「締め後に変更あり」の判定が、古い値にならないように。通信できなければ AppError('offline')
 */
export async function getClosing(eventId: string, day: string): Promise<Closing | null> {
  try {
    const snap = await withTimeout(getDocFromServer(closingRef(eventId, day)));
    if (!snap.exists()) return null;
    const d = snap.data({ serverTimestamps: 'estimate' });
    return {
      day,
      floatCash: d.floatCash,
      expectedCash: d.expectedCash,
      actualCash: d.actualCash,
      diff: d.diff,
      note: typeof d.note === 'string' ? d.note : '',
      closedAt: d.closedAt ? (d.closedAt as Timestamp).toDate() : null,
      closedBy: d.closedBy,
    };
  } catch (e) {
    const err = toAppError(e);
    throw err.code === 'timeout' ? new AppError('offline', { cause: e }) : err;
  }
}

export interface ClosingInput {
  floatCash: number;
  /** あるはずの現金（準備金 ＋ 現金売上）。**呼び出す側が、fetchOrdersOfDayFromServer で集計した値**から計算して渡す（部分的なキャッシュで締めないため） */
  expectedCash: number;
  actualCash: number;
  note: string;
}

function validationError(message: string): AppError {
  return Object.assign(new AppError('validation'), { message });
}

/**
 * レジ締めを保存する（オンライン必須。data-access.md §3.9）。何度でも上書きできる。
 * diff は、ここで actualCash − expectedCash を計算して書く（ルールが、この式を検査する）。
 * 書く前に、サーバーへの到達を確かめる（assertOnline）。オフラインなら、書かずに AppError('offline')
 */
export async function saveClosing(eventId: string, day: string, input: ClosingInput, uid: string): Promise<void> {
  const { floatCash, expectedCash, actualCash, note } = input;
  const money = [floatCash, expectedCash, actualCash];
  if (!money.every(Number.isInteger) || floatCash < 0 || actualCash < 0 || floatCash > CASH_MAX || actualCash > CASH_MAX) {
    throw validationError(`金額は、0円から${CASH_MAX.toLocaleString('ja-JP')}円の整数で入れてください`);
  }
  if (note.length > CLOSING_NOTE_MAX) throw validationError(`メモは${CLOSING_NOTE_MAX}文字までです`);
  const ref = closingRef(eventId, day);
  await assertOnline(ref);
  try {
    await withTimeout(
      setDoc(ref, { floatCash, expectedCash, actualCash, diff: calcDiff(actualCash, expectedCash), note, closedAt: serverTimestamp(), closedBy: uid }),
    );
  } catch (e) {
    throw toAppError(e);
  }
}
