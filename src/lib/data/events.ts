// イベント（data-access.md §3.2）
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { memberDisplayName, type EventInput } from '../domain/event';
import { db } from '../firebase/staff';
import type { AuthUser } from './auth';
import { AppError, toAppError } from './errors';
import { resolveMyEvents, type EventFetch, type ServerCheck } from './myEvents';
import { assertOnline } from './online';
import type { EventDoc, Unsubscribe } from './types';

function toEventDoc(snap: DocumentSnapshot): EventDoc {
  const d = snap.data()!;
  return {
    id: snap.id,
    name: d.name,
    startDate: d.startDate,
    endDate: d.endDate,
    floatCash: d.floatCash,
    ownerUid: d.ownerUid,
    deleting: d.deleting === true,
  };
}

const myEventsDeps = (uid: string) => ({
  async getEvent(eventId: string): Promise<EventFetch> {
    try {
      const snap = await getDoc(doc(db, 'events', eventId)); // オフラインなら、キャッシュから
      return snap.exists() ? { kind: 'found', event: toEventDoc(snap) } : { kind: 'missing' };
    } catch (e) {
      return toAppError(e).code === 'permission' ? { kind: 'denied' } : { kind: 'error' };
    }
  },
  async getEventFromServer(eventId: string): Promise<ServerCheck> {
    try {
      return (await getDocFromServer(doc(db, 'events', eventId))).exists() ? 'exists' : 'missing';
    } catch (e) {
      return toAppError(e).code === 'permission' ? 'denied' : 'error';
    }
  },
  deleteMyMember: (eventId: string) => deleteDoc(doc(db, 'events', eventId, 'members', uid)),
});

/**
 * 自分がメンバーのイベントの一覧を購読する（開始日の新しい順）。
 * members のコレクショングループを購読し、親のイベントを getDoc（キャッシュも使う）で取得する。
 * オフラインで起動しても、キャッシュにあるイベントを出す（SPEC 7.3）。孤立の掃除は myEvents.ts。
 * fromCache：サーバーで確かめていない一覧（オフライン）。0件のとき、画面は「イベントがありません」と言い切らない
 */
export function watchMyEvents(
  uid: string,
  cb: (events: EventDoc[], meta: { fromCache: boolean }) => void,
  onError: (e: AppError) => void,
): Unsubscribe {
  const deps = myEventsDeps(uid);
  let latest = 0; // 古いスナップショットの結果が、後から届いて上書きしないように
  const unsubscribe = onSnapshot(
    query(collectionGroup(db, 'members'), where('uid', '==', uid)),
    { includeMetadataChanges: true }, // キャッシュ → サーバーの確認、の切り替わりを受け取る
    (snap) => {
      const run = ++latest;
      const fromCache = snap.metadata.fromCache;
      const eventIds = snap.docs.map((d) => d.ref.parent.parent!.id);
      void resolveMyEvents(eventIds, deps).then((events) => {
        if (run === latest) cb(events, { fromCache });
      });
    },
    (e) => onError(toAppError(e)),
  );
  return () => {
    latest = -1;
    unsubscribe();
  };
}

/**
 * イベントを作る（オンライン必須。data-access.md §3.9）。イベント＋オーナーの members を1バッチで書き、eventId を返す。
 * creators に登録されていないアカウントは、AppError('permission')
 */
export async function createEvent(input: EventInput, user: AuthUser): Promise<string> {
  const eventRef = doc(collection(db, 'events'));
  await assertOnline(eventRef);
  const batch = writeBatch(db);
  batch.set(eventRef, { ...input, ownerUid: user.uid, deleting: false, createdAt: serverTimestamp() });
  batch.set(doc(eventRef, 'members', user.uid), {
    uid: user.uid,
    role: 'owner',
    displayName: memberDisplayName(user),
    email: (user.email ?? '').toLowerCase(),
    joinedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (e) {
    throw toAppError(e);
  }
  return eventRef.id;
}
