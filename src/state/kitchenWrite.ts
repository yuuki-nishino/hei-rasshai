// 調理画面の書き込み（待たずに進め、未送信として数え、拒否されたときだけ、番号つきで知らせる。data-access.md §3.5・§6.2）
import { AppError } from '../lib/data/errors';
import { transitionOrder } from '../lib/data/orders';
import { trackWrite } from '../lib/data/writes';
import type { Hold } from './holdStore';
import { showToast } from './toast';

export function report(p: Promise<void>, number: number): void {
  trackWrite(p, (e) => {
    console.error(e);
    const detail = e instanceof AppError && e.code === 'validation' ? '（いまの状態では、できない操作です）' : '';
    showToast('error', `${number}番の操作を反映できませんでした${detail}`);
  });
}

/** 猶予が過ぎた（または、すぐ書く）保留中の操作を書く */
export function writeHeld(hold: Hold): void {
  report(transitionOrder(hold.eventId, hold.order, hold.action, hold.uid), hold.number);
}
