// メンバー・招待（data-access.md §3.3）。メンバー一覧・削除は #9
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase/staff';
import { toAppError, type AppError } from './errors';
import { assertOnline } from './online';
import type { Invite, Unsubscribe } from './types';

/** 招待の一覧（オーナー用。発行の新しい順） */
export function watchInvites(eventId: string, cb: (invites: Invite[]) => void, onError: (e: AppError) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'events', eventId, 'invites'),
    (snap) => {
      const invites = snap.docs.map((d) => {
        // 書き込み直後は、サーバーの時刻が未確定。見積もりの時刻で表示する
        const createdAt = d.get('createdAt', { serverTimestamps: 'estimate' }) as { toDate(): Date } | null;
        return { email: d.id, createdAt: createdAt?.toDate() ?? null };
      });
      invites.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      cb(invites);
    },
    (e) => onError(toAppError(e)),
  );
}

/**
 * 招待を作る・再発行する（オンライン必須）。email は normalizeInviteEmail 済みのもの。
 * 同じ相手には上書きし、期限が、その時点から1日になる
 */
export async function createInvite(eventId: string, email: string, uid: string): Promise<void> {
  const ref = doc(db, 'events', eventId, 'invites', email);
  await assertOnline(ref);
  try {
    await setDoc(ref, { createdBy: uid, createdAt: serverTimestamp() });
  } catch (e) {
    throw toAppError(e);
  }
}

/** 招待を取り消す（オンライン必須） */
export async function cancelInvite(eventId: string, email: string): Promise<void> {
  const ref = doc(db, 'events', eventId, 'invites', email);
  await assertOnline(ref);
  try {
    await deleteDoc(ref);
  } catch (e) {
    throw toAppError(e);
  }
}
