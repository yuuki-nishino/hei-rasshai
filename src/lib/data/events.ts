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
import { assertOnline, withTimeout } from './online';
import type { EventDoc, MyEventsMeta, Unsubscribe } from './types';

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
 * fromCache：サーバーで確かめていない一覧（オフライン）。0件のとき、画面は「イベントがありません」と言い切らない。
 * memberOf：自分の members があるイベントのID（表示できないものも含む）。選んでいるイベントから外れたかの判定に使う
 */
export function watchMyEvents(
  uid: string,
  cb: (events: EventDoc[], meta: MyEventsMeta) => void,
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
      const memberOf = snap.docs.map((d) => d.ref.parent.parent!.id);
      void resolveMyEvents(memberOf, deps).then((events) => {
        if (run === latest) cb(events, { fromCache, memberOf });
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
 * 招待を受けて参加する（オンライン必須。screens.md §3.3、security-rules.md §4）。
 * 1. members/{自分} を getDocFromServer で確かめる。あれば 'already'。permission-denied は「メンバーではない」。
 *    通信できなければ AppError('offline')（この取得が、オンラインの確認を兼ねる）
 * 2. メンバー作成＋招待の削除を1バッチで書く。招待が無い・期限切れ・別のアカウント・削除中のイベントは、AppError('permission')
 * 書き込みが8秒で終わらなければ AppError('timeout')。送信待ちは端末に残り、つながり直したときに通ることがある。
 * もう一度呼ぶと、1. で「すでにメンバー」と分かるため、二重にはならない（送信待ちと重なっても、バッチの失敗の後に確かめ直す。J2）
 */
export async function joinEvent(eventId: string, user: AuthUser): Promise<'joined' | 'already'> {
  const memberRef = doc(db, 'events', eventId, 'members', user.uid);
  // サーバーで、メンバーか確かめる。permission-denied は「メンバーではない」
  const isMemberOnServer = async (): Promise<boolean> => {
    try {
      return (await withTimeout(getDocFromServer(memberRef))).exists();
    } catch (e) {
      const err = toAppError(e);
      if (err.code === 'permission') return false;
      throw err.code === 'timeout' ? new AppError('offline', { cause: e }) : err;
    }
  };
  if (await isMemberOnServer()) return 'already';
  const email = (user.email ?? '').toLowerCase();
  const batch = writeBatch(db);
  batch.set(memberRef, { uid: user.uid, role: 'member', displayName: memberDisplayName(user), email, joinedAt: serverTimestamp() });
  batch.delete(doc(db, 'events', eventId, 'invites', email));
  try {
    await withTimeout(batch.commit()); // 確認の後に通信が切れても、止まったままにしない（PR #33 のレビュー J1）
  } catch (e) {
    const err = toAppError(e);
    // 前回の時間切れで残った送信待ちが、確認の後に先に通ると、今回のバッチは「既存のメンバーの上書き」として拒否される。
    // そのときは、もう一度だけ確かめ、メンバーなら参加できている（PR #33 の再レビュー J2）
    if (err.code === 'permission' && (await isMemberOnServer().catch(() => false))) return 'already';
    throw err;
  }
  return 'joined';
}

/**
 * イベントを作る（オンライン必須。data-access.md §3.9）。イベント＋オーナーの members を1バッチで書き、eventId を返す。
 * creators に登録されていないアカウントは、AppError('permission')。
 * 書き込みが8秒で終わらなければ AppError('timeout')。送信待ちは端末に残り、つながり直したときに作成されることがある
 * （もう一度作ると、二重になり得るため、画面は「一覧で確かめてから」と案内する）
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
    await withTimeout(batch.commit()); // 確認の後に通信が切れても、止まったままにしない（PR #33 のレビュー J1）
  } catch (e) {
    throw toAppError(e);
  }
  return eventRef.id;
}
