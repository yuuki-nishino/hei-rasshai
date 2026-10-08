// 「完成」「渡した」の猶予の、アプリ全体の1つ（holdStore.ts を、本物の書き込みと、画面のライフサイクルにつなぐ）
import { UNDO_GRACE_MS } from '../lib/domain/orderHold';
import { createHoldStore } from './holdStore';
import { writeHeld } from './kitchenWrite';

const SETTLE_MS = 1500;

const store = createHoldStore({ graceMs: UNDO_GRACE_MS, settleMs: SETTLE_MS, write: writeHeld });

export const holds = store.holds;
export const startHold = store.start;
export const undoHold = store.undo;
export const flushHold = store.flush;
export const flushAllHolds = store.flushAll;

// アプリを閉じる・再読み込み・別のアプリへ切り替える前に、保留中の操作を、すぐ書く（失われないように。#45）。
// 書いた分は、オフラインでも、端末に溜まる
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAllHolds();
  });
  window.addEventListener('pagehide', flushAllHolds);
}
