// お客様用の注文の購読（data-access.md §3.6）。お客様用の Firebase（lib/firebase/customer.ts）だけを使う。
// スタッフ用の初期化・Auth・永続キャッシュを、import しない（バンドルを軽く保つ。eslint とビルドで検査）
import { doc, onSnapshot } from 'firebase/firestore';
import type { CustomerOrder, CustomerSnapshot, CustomerStatus } from '../domain/customerView';
import { db } from '../firebase/customer';

const STATUSES: readonly CustomerStatus[] = ['preparing', 'ready', 'done', 'cancelled'];

/** 注文の文書から、お客様に見せる項目だけを取り出す（支払い方法・メモ・スタッフの情報は、取り出さない） */
function toCustomerOrder(d: Record<string, unknown>): CustomerOrder | null {
  const items = d.items;
  if (typeof d.number !== 'number' || typeof d.total !== 'number' || !Array.isArray(items) || !STATUSES.includes(d.status as CustomerStatus)) return null;
  return {
    number: d.number,
    status: d.status as CustomerStatus,
    total: d.total,
    items: items.map((i: { name?: unknown; price?: unknown; qty?: unknown }) => ({
      name: String(i.name ?? ''),
      price: Number(i.price ?? 0),
      qty: Number(i.qty ?? 0),
    })),
  };
}

/** 購読をつなぎ直すまでの待ち（ミリ秒）。エラーが続くたびに倍にして、上限まで */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;

/**
 * 注文1件の購読。`includeMetadataChanges`：キャッシュ → サーバーの結果の切り替え（fromCache）を受け取る。
 * 判定（loading・notFound など）は、純粋関数 customerView（lib/domain/customerView.ts）。
 *
 * 一時的な圏外では、SDK が自分で再接続する（エラー処理は呼ばれない）。エラー処理が呼ばれるのは、**購読が終わるとき**
 * （権限・無料枠の上限など）。終わったままだと、その後の状況の変化に気づけないため、間隔を空けて、つなぎ直す
 * （PR #44 のレビュー V2）。つなぎ直すまでの間は、cb に { kind: 'error' } を渡す
 */
export function watchOrder(eventId: string, orderId: string, cb: (snapshot: CustomerSnapshot) => void): () => void {
  let stopped = false;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;

  function connect() {
    unsubscribe = onSnapshot(
      doc(db, 'events', eventId, 'orders', orderId),
      { includeMetadataChanges: true },
      (snap) => {
        failures = 0; // つながった
        cb({ kind: 'doc', order: snap.exists() ? toCustomerOrder(snap.data()) : null, fromCache: snap.metadata.fromCache });
      },
      () => {
        unsubscribe = null; // エラーで、購読は終わっている
        if (stopped) return;
        cb({ kind: 'error' });
        timer = setTimeout(connect, Math.min(RETRY_BASE_MS * 2 ** failures++, RETRY_MAX_MS));
      },
    );
  }
  connect();

  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe?.();
  };
}
