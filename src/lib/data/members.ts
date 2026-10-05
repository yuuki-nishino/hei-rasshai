// メンバー・招待（data-access.md §3.3）
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase/staff';
import { toAppError, type AppError } from './errors';
import { assertOnline, withTimeout } from './online';
import type { Invite, Member, Unsubscribe } from './types';

/** メンバーの一覧（オーナーが先、あとは表示名の順） */
export function watchMembers(eventId: string, cb: (members: Member[]) => void, onError: (e: AppError) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'events', eventId, 'members'),
    (snap) => {
      const members = snap.docs.map((d) => ({
        uid: d.id,
        role: d.get('role') === 'owner' ? ('owner' as const) : ('member' as const),
        displayName: String(d.get('displayName') ?? ''),
        email: String(d.get('email') ?? ''),
      }));
      members.sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName, 'ja') : a.role === 'owner' ? -1 : 1));
      cb(members);
    },
    (e) => onError(toAppError(e)),
  );
}

/**
 * メンバーを外す（オンライン必須）。オーナーが他のメンバーを外す、またはメンバーが自分で抜ける。
 * オーナー自身は抜けられない（ルールが拒否する。イベントの削除のみ）
 */
export async function removeMember(eventId: string, uid: string): Promise<void> {
  const ref = doc(db, 'events', eventId, 'members', uid);
  await assertOnline(ref);
  try {
    await withTimeout(deleteDoc(ref));
  } catch (e) {
    throw toAppError(e);
  }
}

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
    await withTimeout(setDoc(ref, { createdBy: uid, createdAt: serverTimestamp() })); // 時間切れは timeout（PR #33 のレビュー J1）
  } catch (e) {
    throw toAppError(e);
  }
}

/** 招待を取り消す（オンライン必須） */
export async function cancelInvite(eventId: string, email: string): Promise<void> {
  const ref = doc(db, 'events', eventId, 'invites', email);
  await assertOnline(ref);
  try {
    await withTimeout(deleteDoc(ref));
  } catch (e) {
    throw toAppError(e);
  }
}
