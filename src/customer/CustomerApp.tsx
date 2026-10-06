// お客様画面（/s?e=&o=）。注文1件の状況を表示する（screens.md §4、SPEC 6.7）。
// Auth・Service Worker・永続キャッシュを使わない（DESIGN.md §4）。ホーム画面への追加は求めない
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Noren } from '../components/Noren';
import { watchOrder } from '../lib/data/customerOrder';
import {
  CUSTOMER_STATUS_TEXT,
  customerView,
  formatClock,
  isWaiting,
  parseOrderLink,
  shouldVibrate,
  startWaitTicker,
  type CustomerOrder,
  type CustomerSnapshot,
  type CustomerStatus,
} from '../lib/domain/customerView';
import styles from './CustomerApp.module.css';

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

export function CustomerApp() {
  // 不正なリンク（QRの読み違い・URLの改変）は、購読しない
  const link = useMemo(() => parseOrderLink(location.search), []);
  const [snapshot, setSnapshot] = useState<CustomerSnapshot | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [waitedMs, setWaitedMs] = useState(0);
  const [startedAt] = useState(Date.now); // 開いた時刻（読み込みの待ちの起点）
  const [lastOrder, setLastOrder] = useState<CustomerOrder | null>(null);

  useEffect(() => {
    if (!link) return;
    let prev: CustomerStatus | null = null; // 最初の表示では、振動しない
    return watchOrder(link.eventId, link.orderId, (s) => {
      setSnapshot(s);
      setUpdatedAt(new Date());
      if (s.kind === 'doc' && s.order) {
        // 「できあがり」に変わった瞬間だけ振動する（対応する端末のみ。iPhone は非対応）
        if (shouldVibrate(prev, s.order.status)) navigator.vibrate?.([200, 100, 200]);
        prev = s.order.status;
        setLastOrder(s.order); // エラーのあとも、カードを残すため
      }
    });
  }, [link]);

  // 読み込み中が続く時間を数える（8秒で「通信が不安定です」を添える）。
  // 条件は、結果が届いたかではなく、「読み込み中と判定されているか」（オフラインで、キャッシュだけの結果が届いても、数え続ける。PR #44 のレビュー V1）
  const waiting = link !== null && isWaiting(snapshot);
  useEffect(() => {
    if (!waiting) return;
    return startWaitTicker(startedAt, setWaitedMs);
  }, [waiting, startedAt]);

  const view = link ? customerView(snapshot, waitedMs, lastOrder) : null;

  // タブの題名にも、番号と状況を出す（ほかのアプリに切り替えても、分かるように）
  const activeNumber = view?.state === 'active' ? view.order.number : null;
  const activeStatus = view?.state === 'active' ? view.order.status : null;
  useEffect(() => {
    document.title = activeNumber !== null && activeStatus ? `${activeNumber}番 ${CUSTOMER_STATUS_TEXT[activeStatus].badge}｜毎度おおきに` : 'ご注文の状況｜毎度おおきに';
  }, [activeNumber, activeStatus]);

  return (
    <>
      <Noren title="ご注文の状況" sub="毎度おおきに" />
      <main class={styles.main}>
        {!link ? (
          <Notice title="このQRは正しくありません" error>
            お手数ですが、お近くのスタッフへお声がけください
          </Notice>
        ) : view?.state === 'loading' ? (
          <Notice title="読み込み中…">
            {view.slow && <p class={styles.hint}>通信が不安定です。電波の良い場所で、お待ちください</p>}
          </Notice>
        ) : view?.state === 'notFound' ? (
          <Notice title="注文が見つかりません" error>
            お近くのスタッフへお声がけください
          </Notice>
        ) : view?.state === 'error' ? (
          <Notice title="通信できません" error>
            電波の良い場所で、もう一度開いてください
          </Notice>
        ) : view?.state === 'active' ? (
          <Active order={view.order} fromCache={view.fromCache} updatedAt={updatedAt} />
        ) : null}
      </main>
    </>
  );
}

function Notice({ title, error = false, children }: { title: string; error?: boolean; children?: ComponentChildren }) {
  return (
    <div class={styles.notice} role={error ? 'alert' : 'status'}>
      <p class={`${styles.noticeTitle} ${error ? styles.noticeError : ''}`}>{title}</p>
      {typeof children === 'string' ? <p class={styles.hint}>{children}</p> : children}
    </div>
  );
}

function Active({ order, fromCache, updatedAt }: { order: CustomerOrder; fromCache: boolean; updatedAt: Date | null }) {
  const text = CUSTOMER_STATUS_TEXT[order.status];
  return (
    <>
      {/* 状況が変わったら、読み上げる（色だけに頼らず、文字でも示す） */}
      <section class={`${styles.card} ${styles[order.status]}`} aria-live="polite" aria-label={`${order.number}番 ${text.badge}`}>
        <span class={styles.label}>あなたの番号</span>
        <h2 class={styles.number}>
          {order.number}
          <span class={styles.numberUnit}>番</span>
        </h2>
        <span class={styles.badge}>{text.badge}</span>
        <p class={styles.message}>{text.message}</p>
      </section>

      <section class={styles.detail} aria-label="ご注文の内容">
        <ul class={styles.items}>
          {order.items.map((i, k) => (
            <li key={k} class={styles.item}>
              <span class={styles.itemName}>
                {i.name} × {i.qty}
              </span>
              <span>{yen(i.price * i.qty)}</span>
            </li>
          ))}
        </ul>
        <div class={styles.total}>
          <span>合計</span>
          <span>{yen(order.total)}</span>
        </div>
      </section>

      <p class={styles.meta}>
        {updatedAt && <span>最終更新 {formatClock(updatedAt)}</span>}
        {fromCache && <span class={styles.unstable}>通信が不安定です</span>}
      </p>
    </>
  );
}
