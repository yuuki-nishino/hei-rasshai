// 調理画面の注文のカード（screens.md §3.5）。番号（大）・品目・支払い方法・合計・経過分数、状態ごとの操作
import { Button } from '../../components/Button';
import { PaymentBadge, StatusBadge } from '../../components/Badge';
import type { Order } from '../../lib/data/types';
import { ACTION_LABEL, availableActions, dayMark, elapsedMinutes, type OrderAction } from '../../lib/domain/orderStatus';
import { needsCooking } from '../../lib/domain/cooking';
import { formatYen } from '../../lib/domain/order';
import styles from './OrderCard.module.css';

type Props = {
  order: Order;
  today: string;
  now: number;
  onAction: (order: Order, action: OrderAction) => void;
  onTogglePayment: (order: Order) => void;
  onQr: (order: Order) => void;
  /** メモの修正（#40） */
  onEditNote: (order: Order) => void;
};

export function OrderCard({ order, today, now, onAction, onTogglePayment, onQr, onEditNote }: Props) {
  const finished = order.status === 'done' || order.status === 'cancelled';
  const mark = dayMark(order.day, today);
  const [main, ...rest] = availableActions(order.status);
  // 主の操作を大きく出すのは、調理中（完成）とできあがり（渡した）だけ。ほかは、同じ大きさのボタンを並べる
  const bigMain = order.status === 'preparing' || order.status === 'ready';
  const next: Record<string, string> = { cash: 'PayPay', paypay: '現金' };

  return (
    <article class={`${styles.card} ${finished ? styles.finished : ''}`} aria-label={`${order.number}番`}>
      <div class={styles.head}>
        <span class={styles.number}>{order.number}</span>
        <div class={styles.badges}>
          {mark && <span class={styles.dayMark}>{mark}</span>}
          <PaymentBadge payment={order.payment} />
          {finished && <StatusBadge status={order.status} />}
          {order.pending && <span class={styles.pending}>未送信</span>}
        </div>
        {!finished && <span class={styles.elapsed}>{elapsedMinutes(order.createdAt, now)}分</span>}
      </div>

      <ul class={styles.items} aria-label="品目">
        {order.items.map((i) => (
          <li key={i.menuId} class={`${styles.item} ${needsCooking(i) ? '' : styles.noCook}`}>
            <span class={styles.itemName}>
              {i.name}
              {!needsCooking(i) && <span class={styles.noCookTag}>調理なし</span>}
            </span>
            <span class={styles.qty}>× {i.qty}</span>
          </li>
        ))}
      </ul>
      {/* メモ：調理で気をつけることを、見落とさないように目立たせる（色だけでなく、「メモ」の文字でも示す） */}
      {order.note && (
        <p class={styles.note}>
          <span class={styles.noteLabel}>メモ</span>
          <span class={styles.noteText}>{order.note}</span>
        </p>
      )}
      <div class={styles.total}>
        <span>合計</span>
        <span>{formatYen(order.total)}</span>
      </div>

      <div class={styles.actions}>
        {main && bigMain && (
          <Button variant="primary" big block onClick={() => onAction(order, main)}>
            {ACTION_LABEL[main]}
          </Button>
        )}
        <div class={styles.secondary}>
          {(bigMain ? rest : [main, ...rest]).filter((a): a is OrderAction => a !== undefined && a !== 'cancel').map((a) => (
            <Button key={a} variant="secondary" onClick={() => onAction(order, a)}>
              {ACTION_LABEL[a]}
            </Button>
          ))}
          {order.qr && !finished && (
            <Button variant="secondary" onClick={() => onQr(order)}>
              QR
            </Button>
          )}
          <Button variant="secondary" onClick={() => onEditNote(order)}>
            {order.note ? 'メモを直す' : 'メモを足す'}
          </Button>
          <Button variant="secondary" onClick={() => onTogglePayment(order)} aria-label={`支払いを${next[order.payment]}に変更`}>
            {next[order.payment]}に変更
          </Button>
          {availableActions(order.status).includes('cancel') && (
            <span class={styles.danger}>
              <Button variant="danger" onClick={() => onAction(order, 'cancel')}>
                {ACTION_LABEL.cancel}
              </Button>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
