// メンバーでなくなったときの、端末のキャッシュの消去（data-access.md §8）
// - 外れたことは、サーバーで確かめた自分の members（memberOf）から、前に見ていたイベントが消えたことで知る
// - 未送信が無ければ、すぐ消して再読み込み。あれば印（hei:clearPending）を残して持ち越し、一覧に戻ったとき・次の起動時に試す
// - 24時間たっても未送信が残るときは、消してよいか確かめる（cacheClearAsk）
import { signal } from '@preact/signals';
import { clearLocalCache, hasPendingWrites } from '../lib/data/cache';
import { decideCacheClear, lostMemberships, mergeClearMark, type ClearPendingMark } from '../lib/domain/cacheClear';
import { currentEventId } from './event';
import { readStorage, writeStorage } from './storage';

const MARK_KEY = 'hei:clearPending';
const KNOWN_KEY = 'hei:knownEvents'; // これまでにサーバーで確かめた、自分のイベント（この端末のキャッシュにあり得るもの）
const CLEAR_ON_START_KEY = 'hei:clearOnStart'; // ログアウトで消せなかったとき（別のタブが開いていた）、次の起動時に消す

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

/** サーバーで確かめた memberOf が届いたら呼ぶ。外れたイベントがあれば、消去を始める */
export function onServerMembership(memberOf: string[]): void {
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

/** 印があれば、消去を試す（未送信が無ければ、消して再読み込み） */
export async function tryClearCache(): Promise<void> {
  const mark = clearMark.peek();
  if (!mark || running) return;
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

async function clearAndReload(): Promise<void> {
  try {
    await clearLocalCache();
    setMark(null);
    writeStorage(KNOWN_KEY, null); // 次のサーバーの一覧から、数え直す
  } catch (e) {
    // 別のタブが開いているなど。印を残し、次の起動時にもう一度試す
    console.warn('端末のキャッシュを消せませんでした', e);
  }
  location.reload();
}

/** ログアウト：未送信の確認は、呼ぶ側（画面）で済ませておく。キャッシュを消して、再読み込みする */
export async function clearCacheForLogout(): Promise<void> {
  try {
    await clearLocalCache();
    writeStorage(KNOWN_KEY, null);
    setMark(null);
  } catch (e) {
    console.warn('端末のキャッシュを消せませんでした。次の起動時に消します', e);
    writeStorage(CLEAR_ON_START_KEY, '1');
  }
  location.reload();
}

/** 起動時（画面を出す前）：ログアウトで消せなかった分と、持ち越した消去を試す */
export async function clearCacheOnStart(): Promise<void> {
  if (readStorage(CLEAR_ON_START_KEY)) {
    writeStorage(CLEAR_ON_START_KEY, null);
    try {
      await clearLocalCache();
      writeStorage(KNOWN_KEY, null);
      setMark(null);
    } catch (e) {
      console.warn('端末のキャッシュを消せませんでした', e);
    }
    location.reload();
    return new Promise(() => {}); // 再読み込みまで、画面を出さない
  }
  if (clearMark.peek()) void tryClearCache();
}
