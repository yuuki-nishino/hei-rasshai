// イベントの削除の実行状態（screens.md §3.9）。画面（イベントのタブ・削除中の画面）をまたいで、進捗を保つため、状態をここに置く
import { signal } from '@preact/signals';
import { AppError } from '../lib/data/errors';
import { deleteEventDeep, type DeleteProgress } from '../lib/data/eventDelete';
import { selectEvent } from './event';
import { flushAllHolds } from './hold';

export type DeleteState =
  | { kind: 'idle' }
  | { kind: 'running'; eventId: string; progress: DeleteProgress }
  | { kind: 'error'; eventId: string; message: string };

export const deleteState = signal<DeleteState>({ kind: 'idle' });

export function deleteErrorMessage(e: unknown): string {
  if (e instanceof AppError) {
    if (e.code === 'offline') return '通信が必要です。電波を確認してから、「削除を再開」を押してください';
    if (e.code === 'timeout') return '途中で止まりました。通信を確認して、「削除を再開」を押してください（続きから消えます）';
    if (e.code === 'permission') return '削除できませんでした。このイベントのオーナーのアカウントで、ログインしているか確かめてください';
    if (e.code === 'conflict') return '消しきれませんでした（ほかの端末が書き込んでいる可能性があります）。もう一度「削除を再開」を押してください';
  }
  return 'うまくいきませんでした。もう一度「削除を再開」を押してください';
}

/** 削除を始める（または、途中から再開する）。終われば、イベント一覧へ戻る */
export async function startEventDelete(eventId: string, uid: string): Promise<void> {
  if (deleteState.peek().kind === 'running') return;
  flushAllHolds(); // 保留中の「完成」「渡した」は、先に書く（消える注文へ、後から書かないように）
  deleteState.value = { kind: 'running', eventId, progress: { phase: 'prepare', deleted: 0 } };
  try {
    await deleteEventDeep(eventId, uid, (progress) => {
      deleteState.value = { kind: 'running', eventId, progress };
    });
    deleteState.value = { kind: 'idle' };
    selectEvent(null);
  } catch (e) {
    console.error(e);
    deleteState.value = { kind: 'error', eventId, message: deleteErrorMessage(e) };
  }
}
