// イベントの削除（data-access.md §7）。Cloud Functions を使わないため、オーナーの端末から、配下を少しずつ消す。
// 途中で止まっても、同じ関数をもう一度呼べば、続きから消せる（消すものが無い段階は、何もせず進む）
import { collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, limit, query, updateDoc, writeBatch, type CollectionReference, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../firebase/staff';
import { AppError, toAppError } from './errors';
import { withTimeout } from './online';

/** 1バッチで消す件数（Firestore の上限は500） */
export const DELETE_BATCH = 450;
/** 読み取り・書き込みの待ち時間。バッチは大きいため、確認用の8秒より長く待つ */
const READ_TIMEOUT_MS = 15_000;
const BATCH_TIMEOUT_MS = 30_000;
/** 「空になったか」の確認で、残りが見つかったときのやり直しの上限（他の端末が書き続けるなどで終わらないときの歯止め） */
const VERIFY_ROUNDS = 3;

/** 配下のコレクション（注文・墓標が先。メニューの削除は、自分の members が残っている間だけ許される） */
const DATA = ['orders', 'voids', 'counters', 'closings', 'menu'] as const;

export type DeletePhase = 'prepare' | 'members' | 'data' | 'verify' | 'event' | 'self';
export interface DeleteProgress {
  phase: DeletePhase;
  /** ここまでに消した件数（このイベントの配下の文書。イベント本体と、自分の members は数えない） */
  deleted: number;
}

/**
 * イベントを、配下ごと消す（オーナーのみ。オンライン必須）。同じ関数で再開できる。
 * 順序は data-access.md §7：deleting → 他のメンバー・招待 → 注文・墓標 → カウンター・レジ締め・メニュー
 *   → 空になったことをサーバーで確認 → イベント → 自分の members
 * 一覧は、すべてサーバーから取る（オフラインでキャッシュの一部だけを見て、取りこぼさないため）。
 * 通信できなければ AppError('offline')、途中で応答がなければ AppError('timeout')（再実行で続きから）
 */
export async function deleteEventDeep(eventId: string, uid: string, onProgress: (p: DeleteProgress) => void = () => {}): Promise<void> {
  const eventRef = doc(db, 'events', eventId);
  let deleted = 0;
  const tick = (phase: DeletePhase, n = 0) => {
    deleted += n;
    onProgress({ phase, deleted });
  };
  const purgeIn = (name: string, phase: DeletePhase, filter: (d: QueryDocumentSnapshot) => boolean = () => true) =>
    purge(collection(db, 'events', eventId, name), filter, (n) => tick(phase, n));

  try {
    tick('prepare');
    const event = await read(getDocFromServer(eventRef)); // 通信の確認を兼ねる
    if (event.exists()) {
      if (event.get('ownerUid') !== uid) throw new AppError('permission');
      // 新しい書き込みを止める（以後、注文・墓標・カウンター・メニュー・レジ締めは、オーナーも作れない）
      if (event.get('deleting') !== true) await withTimeout(updateDoc(eventRef, { deleting: true }), BATCH_TIMEOUT_MS);

      // 他のメンバー・招待を先に消す（削除中に書き込めないように）
      tick('members');
      await purgeIn('members', 'members', (d) => d.id !== uid);
      await purgeIn('invites', 'members');

      // 配下を消し、空になったことを確かめる。残っていれば、やり直す
      for (let round = 0; ; round++) {
        tick('data');
        for (const name of DATA) await purgeIn(name, 'data');
        tick('verify');
        if (await isEmpty(eventId, uid)) break;
        if (round + 1 >= VERIFY_ROUNDS) throw new AppError('conflict');
      }

      tick('event');
      await withTimeout(deleteDoc(eventRef), BATCH_TIMEOUT_MS);
    }
    // イベントが無くなった後は、自分の members も消せる（ルールが、オーナー自身にも許す）
    tick('self');
    await withTimeout(deleteDoc(doc(db, 'events', eventId, 'members', uid)), BATCH_TIMEOUT_MS);
  } catch (e) {
    throw toAppError(e);
  }
}

/** サーバーから読む。届かなければ offline（応答がなければ、通信できないものとみなす） */
async function read<T>(p: Promise<T>): Promise<T> {
  try {
    return await withTimeout(p, READ_TIMEOUT_MS);
  } catch (e) {
    const err = toAppError(e);
    throw err.code === 'timeout' ? new AppError('offline', { cause: e }) : err;
  }
}

/**
 * コレクションの文書を、filter に合うものだけ、DELETE_BATCH 件ずつ消す。1バッチ消すたびに、件数を onBatch へ渡す。
 * 毎回サーバーから読み直すため、途中で止まって再実行しても、残りだけを消す
 */
async function purge(col: CollectionReference, filter: (d: QueryDocumentSnapshot) => boolean, onBatch: (n: number) => void): Promise<void> {
  for (;;) {
    // 1件多く読む：filter で除く文書（自分の members）が混ざっても、DELETE_BATCH 件を消せるように
    const snap = await read(getDocsFromServer(query(col, limit(DELETE_BATCH + 1))));
    const targets = snap.docs.filter(filter).slice(0, DELETE_BATCH);
    if (targets.length === 0) return;
    const batch = writeBatch(db);
    for (const d of targets) batch.delete(d.ref);
    await withTimeout(batch.commit(), BATCH_TIMEOUT_MS);
    onBatch(targets.length);
  }
}

/** 配下がすべて空か（members は自分だけ、invites は無い）。サーバーで確かめる */
async function isEmpty(eventId: string, uid: string): Promise<boolean> {
  for (const name of DATA) {
    if (!(await read(getDocsFromServer(query(collection(db, 'events', eventId, name), limit(1))))).empty) return false;
  }
  if (!(await read(getDocsFromServer(query(collection(db, 'events', eventId, 'invites'), limit(1))))).empty) return false;
  const members = await read(getDocsFromServer(query(collection(db, 'events', eventId, 'members'), limit(2))));
  return members.docs.every((d) => d.id === uid);
}
