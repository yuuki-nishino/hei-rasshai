// 注文の状態・支払いのバッジ（visual.md §3、SPEC §7.5）
import styles from './Badge.module.css';

// 値は data-model.md の orders.status / payment と同じ（型は、ドメイン層ができたら、そちらに寄せる）
export type OrderStatus = 'preparing' | 'ready' | 'done' | 'cancelled';
export type Payment = 'cash' | 'paypay';

const statusLabel: Record<OrderStatus, string> = {
  preparing: '調理中',
  ready: 'できあがり',
  done: 'お渡し済み',
  cancelled: '取り消し',
};

const paymentLabel: Record<Payment, string> = {
  cash: '現金',
  paypay: 'PayPay',
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span class={`${styles.badge} ${styles.dot} ${styles[status]}`}>{statusLabel[status]}</span>;
}

export function PaymentBadge({ payment }: { payment: Payment }) {
  return <span class={`${styles.badge} ${styles[payment]}`}>{paymentLabel[payment]}</span>;
}
