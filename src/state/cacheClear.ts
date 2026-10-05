// メンバーでなくなったときの、端末のキャッシュの消去（data-access.md §8）
// - 外れたことは、サーバーで確かめた自分の members（memberOf）から、前に見ていたイベントが消えたことで知る
// - 未送信が無ければ、すぐ消して再読み込み。あれば印（hei:clearPending）を残して持ち越し、一覧に戻ったとき・次の起動時に試す
// - 24時間たっても未送信が残るときは、消してよいか確かめる（cacheClearAsk）
// - 消す前に、ほかのタブへ知らせて再読み込みさせる（消去で、ほかのタブの Firestore は終了させられるため。PR #34 のレビュー K1）
// - 消去に失敗したら、このセッションの間は、自動では試さない（再読み込みが止まらなくなるため。レビュー K2）
import { signal } from '@preact/signals';
import { clearLocalCache, hasPendingWrites } from '../lib/data/cache';
import { decideCacheClear, lostMemberships, mergeClearMark, pruneClearMark, type ClearPendingMark } from '../lib/domain/cacheClear';
import { currentEventId } from './event';
import { readSession, readStorage, writeSession, writeStorage } from './storage';

const MARK_KEY = 'hei:clearPending';
const KNOWN_KEY = 'hei:knownEvents'; // これまでにサーバーで確かめた、自分のイベント（この端末のキャッシュにあり得るもの）
const CLEAR_ON_START_KEY = 'hei:clearOnStart'; // ログアウトで消せなかったとき、次の起動時に消す
const FAILED_KEY = 'hei:clearFailed'; // sessionStorage：このセッションで、消去に失敗した（自動では、もう試さない）

function readJson<T>(key: string): T | null {
  try {
    const raw = readStorage(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** 消去待ちの印。外れたイベントは、消去まで一覧に出さず、開けない */
export const clearMark = signal<ClearPendingMark | null>(readJson<ClearPendingMark>(MARK_KEY));
/** 24時間たっても未送信が残り、消してよいかの確認を待っている */
export const cacheClearAsk = signal(false);

function setMark(mark: ClearPendingMark | null): void {
  clearMark.value = mark;
  writeStorage(MARK_KEY, mark && JSON.stringify(mark));
}

// ほかのタブへの知らせ。消去すると、ほかのタブの Firestore は終了させられ、黙って使えなくなる。知らせを受けたら、再読み込みする
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('hei-cache');
if (channel) channel.onmessage = (e: MessageEvent) => e.data === 'clearing' && location.reload();

/** サーバーで確かめた memberOf が届いたら呼ぶ。外れたイベントがあれば、消去を始める */
export function onServerMembership(memberOf: string[]): void {
  // 参加し直したイベントは、印から外す（レビュー K3）
  const pruned = pruneClearMark(clearMark.peek(), memberOf);
  if (pruned !== clearMark.peek()) setMark(pruned);

  const known = readJson<string[]>(KNOWN_KEY) ?? [];
  const lost = lostMemberships(known, memberOf);
  writeStorage(KNOWN_KEY, JSON.stringify(memberOf));
  if (lost.length === 0) return;
  setMark(mergeClearMark(clearMark.peek(), lost, Date.now()));
  // 消すときは再読み込みするため、別のイベントで作業している最中なら、一覧に戻ったとき（EventGate）まで待つ
  const current = currentEventId.peek();
  if (current === null || lost.includes(current)) void tryClearCache();
}

let running = false;

/** 印があれば、消去を試す（未送信が無ければ、消して再読み込み）。このセッションで失敗していれば、試さない */
export async function tryClearCache(): Promise<void> {
  const mark = clearMark.peek();
  if (!mark || running || readSession(FAILED_KEY)) return;
  running = true;
  try {
    const decision = decideCacheClear(mark, Date.now(), await hasPendingWrites());
    if (decision === 'clear') await clearAndReload();
    else cacheClearAsk.value = decision === 'ask';
  } finally {
    running = false;
  }
}

/** 確認が取れたので、未送信ごと消す */
export async function confirmCacheClear(): Promise<void> {
  cacheClearAsk.value = false;
  await clearAndReload();
}

/** ほかのタブに知らせてから消す。成功したら true。失敗したら、このセッションでは自動で試さない印を残す */
async function clearEverywhere(): Promise<boolean> {
  channel?.postMessage('clearing');
  try {
    await clearLocalCache();
    writeStorage(KNOWN_KEY, null); // 次のサーバーの一覧から、数え直す
    setMark(null);
    return true;
  } catch (e) {
    console.warn('端末のキャッシュを消せませんでした', e);
    writeSession(FAILED_KEY, '1');
    return false;
  }
}

async function clearAndReload(): Promise<void> {
  await clearEverywhere(); // 失敗しても、db は終了している（ことがある）ため、再読み込みは要る。印は残り、次のセッションで試す
  location.reload();
}

/** ログアウト：未送信の確認は、呼ぶ側で済ませておく。キャッシュを消して、再読み込みする */
export async function clearCacheForLogout(): Promise<void> {
  if (!(await clearEverywhere())) writeStorage(CLEAR_ON_START_KEY, '1'); // 次のセッションの起動時に消す
  location.reload();
}

/** 起動時（画面を出す前）：ログアウトで消せなかった分と、持ち越した消去を試す。このセッションで失敗していれば、試さない */
export async function clearCacheOnStart(): Promise<void> {
  if (readSession(FAILED_KEY)) return;
  if (readStorage(CLEAR_ON_START_KEY)) {
    if (await clearEverywhere()) writeStorage(CLEAR_ON_START_KEY, null);
    location.reload();
    return new Promise(() => {}); // 再読み込みまで、画面を出さない
  }
  if (clearMark.peek()) void tryClearCache();
}
