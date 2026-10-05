// 自分のイベント一覧の組み立てと、孤立した members の掃除の判定（data-access.md §3.2）
// Firestore に依存しない（取得の関数を受け取る）。単体テストで、すべての分岐を確かめるため
import type { EventDoc } from './types';

/** 表示用の取得（キャッシュも使う）の結果 */
export type EventFetch =
  | { kind: 'found'; event: EventDoc }
  | { kind: 'missing' } // 存在しない（キャッシュの結果のこともある）
  | { kind: 'denied' } // permission-denied：もうメンバーでない
  | { kind: 'error' }; // 通信エラーなど（キャッシュにも無い）

/** 掃除の判定用の取得（サーバー必須）の結果 */
export type ServerCheck = 'missing' | 'exists' | 'denied' | 'error';

export interface MyEventsDeps {
  getEvent(eventId: string): Promise<EventFetch>;
  getEventFromServer(eventId: string): Promise<ServerCheck>;
  deleteMyMember(eventId: string): Promise<void>;
}

/**
 * members の親イベントを取得して、一覧にする（開始日の新しい順）。
 * - 取得できたイベントは、出す（オフラインで、キャッシュの結果でも出す）
 * - permission-denied のイベントは、出さない。members も消さない
 * - 存在しないイベントは、出さない。サーバーで「存在しない」と確かめられたときだけ、自分の members を消す（孤立の掃除）
 * - 通信エラーなどで確かめられないときは、何もしない（消さない）
 */
export async function resolveMyEvents(eventIds: string[], deps: MyEventsDeps): Promise<EventDoc[]> {
  const results = await Promise.all(
    eventIds.map(async (id) => {
      const r = await deps.getEvent(id);
      if (r.kind === 'found') return r.event;
      if (r.kind === 'missing' && (await deps.getEventFromServer(id)) === 'missing') {
        // 掃除の失敗は、一覧に影響させない（次に一覧を開いたときに、もう一度試す）
        await deps.deleteMyMember(id).catch((e: unknown) => console.warn('孤立した members を消せませんでした', id, e));
      }
      return null;
    }),
  );
  return results.filter((e): e is EventDoc => e !== null).sort(byStartDateDesc);
}

function byStartDateDesc(a: EventDoc, b: EventDoc): number {
  return a.startDate === b.startDate ? a.name.localeCompare(b.name, 'ja') : a.startDate < b.startDate ? 1 : -1;
}
