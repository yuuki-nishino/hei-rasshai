// 調理（screens.md §3.5）。左「調理中」・右「できあがり」（スマホ縦は、タブで切り替え）。
// 「済みも表示」で、今日のお渡し済み・取り消しも出す（そのカードでも、支払い変更・戻す操作ができる）
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Loading } from '../../components/Feedback';
import { AppError } from '../../lib/data/errors';
import { changePayment, transitionOrder, watchOrdersOfDay } from '../../lib/data/orders';
import type { Order } from '../../lib/data/types';
import { toDay } from '../../lib/domain/day';
import { planCancel, sortOrders, type OrderAction } from '../../lib/domain/orderStatus';
import { selectEvent } from '../../state/event';
import { activeOrders, activeOrdersError } from '../../state/orders';
import { showToast } from '../../state/toast';
import { OrderCard } from './OrderCard';
import styles from './KitchenPage.module.css';
import { QrDialog } from './QrDialog';

type Column = 'cooking' | 'ready';

/** 書き込みを待たずに進め、拒否されたときだけ、番号つきで知らせる（data-access.md §3.5） */
function report(p: Promise<void>, number: number) {
  p.catch((e: unknown) => {
    console.error(e);
    const detail = e instanceof AppError && e.code === 'validation' ? '（いまの状態では、できない操作です）' : '';
    showToast('error', `${number}番の操作を反映できませんでした${detail}`);
  });
}

/** 1分ごとに更新する現在時刻（経過分数の表示用） */
function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function KitchenPage({ eventId, uid }: { eventId: string; uid: string }) {
  const now = useMinuteClock();
  const today = toDay(new Date(now));
  const [column, setColumn] = useState<Column>('cooking');
  const [showFinished, setShowFinished] = useState(false);
  const [dayOrders, setDayOrders] = useState<Order[] | null>(null);
  const [dayError, setDayError] = useState(false);
  const [dayRetry, setDayRetry] = useState(0);
  // 取り消しの確認は、注文のコピーではなく、id を持つ（確認を押した時点の最新の注文で判断する。レビュー M1）
  const [cancelling, setCancelling] = useState<{ id: string; number: number } | null>(null);
  const [qrOrder, setQrOrder] = useState<Order | null>(null);

  // 「済みも表示」を入れたときだけ、今日の全状態を購読する
  useEffect(() => {
    // 日付が変わったときなど、購読し直す前に、前の日の一覧を捨てる（一瞬、前の日の一覧が残らないように。レビュー M3）
    setDayOrders(null);
    setDayError(false);
    if (!showFinished) return;
    return watchOrdersOfDay(
      eventId,
      today,
      (orders) => {
        setDayOrders(orders);
        setDayError(false);
      },
      (e) => {
        if (e.code === 'permission') selectEvent(null);
        else setDayError(true); // 読み込み中のまま止まらないように、知らせる（レビュー M2）
      },
    );
  }, [eventId, showFinished, today, dayRetry]);

  const active = activeOrders.value;
  const cooking = useMemo(() => sortOrders((active?.orders ?? []).filter((o) => o.status === 'preparing')), [active]);
  const ready = useMemo(() => sortOrders((active?.orders ?? []).filter((o) => o.status === 'ready')), [active]);
  const finished = useMemo(() => sortOrders((dayOrders ?? []).filter((o) => o.status === 'done' || o.status === 'cancelled')), [dayOrders]);

  if (!active) {
    return activeOrdersError.value ? <p role="alert">注文を読み込めませんでした。通信を確認してください</p> : <Loading label="注文を読み込み中…" />;
  }

  const act = (order: Order, action: OrderAction) => {
    if (action === 'cancel') setCancelling({ id: order.id, number: order.number }); // 取り消しだけ、確認ダイアログ（screens.md §3.5）
    else report(transitionOrder(eventId, order, action, uid), order.number);
  };
  const togglePayment = (order: Order) => report(changePayment(eventId, order.id, order.payment === 'cash' ? 'paypay' : 'cash', uid), order.number);

  const card = (o: Order) => <OrderCard order={o} today={today} now={now} onAction={act} onTogglePayment={togglePayment} onQr={setQrOrder} />;

  return (
    <section class={styles.page} aria-labelledby="kitchen-title">
      <div class={styles.toolbar}>
        <h2 id="kitchen-title" class={styles.h2}>
          調理
        </h2>
        <label class={styles.showDone}>
          <input type="checkbox" checked={showFinished} onChange={(e) => setShowFinished(e.currentTarget.checked)} />
          済みも表示
        </label>
      </div>

      <div class={styles.switch} role="group" aria-label="表示する列">
        <button type="button" class={`${styles.switchButton} ${styles.cooking}`} aria-pressed={column === 'cooking'} onClick={() => setColumn('cooking')}>
          調理中 {cooking.length}
        </button>
        <button type="button" class={`${styles.switchButton} ${styles.ready}`} aria-pressed={column === 'ready'} onClick={() => setColumn('ready')}>
          できあがり {ready.length}
        </button>
      </div>

      <div class={styles.columns}>
        <div class={styles.column} data-hidden={column !== 'cooking'}>
          <div class={`${styles.columnHead} ${styles.cooking}`}>調理中 {cooking.length}</div>
          {cooking.length === 0 ? (
            <p class={styles.empty}>いまの注文はありません</p>
          ) : (
            <ul class={styles.list}>
              {cooking.map((o) => (
                <li key={o.id}>{card(o)}</li>
              ))}
            </ul>
          )}
        </div>
        <div class={styles.column} data-hidden={column !== 'ready'}>
          <div class={`${styles.columnHead} ${styles.ready}`}>できあがり {ready.length}</div>
          {ready.length === 0 ? (
            <p class={styles.empty}>できあがりの注文はありません</p>
          ) : (
            <ul class={styles.list}>
              {ready.map((o) => (
                <li key={o.id}>{card(o)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showFinished && (
        <>
          <h3 class={styles.finishedTitle}>今日のお渡し済み・取り消し {dayOrders ? finished.length : ''}</h3>
          {dayError && !dayOrders ? (
            <div role="alert" class={styles.empty}>
              <p>済みの注文を読み込めませんでした。通信を確認してください</p>
              <Button variant="secondary" onClick={() => setDayRetry((n) => n + 1)}>
                やり直す
              </Button>
            </div>
          ) : !dayOrders ? (
            <Loading label="読み込み中…" />
          ) : finished.length === 0 ? (
            <p class={styles.empty}>お渡し済み・取り消しの注文は、まだありません</p>
          ) : (
            <ul class={styles.finishedList}>
              {finished.map((o) => (
                <li key={o.id}>{card(o)}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <ConfirmDialog
        open={cancelling !== null}
        title={`${cancelling?.number ?? ''}番を取り消しますか？`}
        confirmLabel="取り消す"
        danger
        onCancel={() => setCancelling(null)}
        onConfirm={() => {
          const target = cancelling;
          setCancelling(null);
          if (!target) return;
          // 確認を押した時点の、最新の注文で判断する（開いている間に、ほかのメンバーが状態を変えていても、最新の状態から取り消す）
          const latest = [...(activeOrders.peek()?.orders ?? []), ...(dayOrders ?? [])].find((o) => o.id === target.id);
          const plan = planCancel(latest);
          if (plan === 'already') showToast('success', `${target.number}番は、すでに取り消されています`);
          // 画面に出ていない（済みも表示を閉じている間に、ほかのメンバーが「渡した」にした、など）。事実は言い切らない（PR #42 の再レビュー R1）
          else if (plan === 'missing' || !latest) showToast('error', `${target.number}番の状態が変わったようです。画面を確かめてください`);
          else report(transitionOrder(eventId, latest, 'cancel', uid), target.number);
        }}
      >
        取り消した注文は、売上に含まれません。あとから「取り消しを戻す」で、元に戻せます。
      </ConfirmDialog>

      <QrDialog eventId={eventId} order={qrOrder} onClose={() => setQrOrder(null)} />
    </section>
  );
}
