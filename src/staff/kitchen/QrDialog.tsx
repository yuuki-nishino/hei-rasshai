// 注文の QR の再表示（screens.md §3.5：調理中・できあがりのカードの「QR」）。お客様が、読み取り直せるように
import { useEffect, useRef } from 'preact/hooks';
import { Button } from '../../components/Button';
import { QrCode } from '../../components/QrCode';
import { orderUrl } from '../../lib/domain/url';
import styles from './QrDialog.module.css';

export function QrDialog({ eventId, order, onClose }: { eventId: string; order: { id: string; number: number } | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = order !== null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={ref} class={styles.dialog} aria-label="QRコード" onCancel={(e) => (e.preventDefault(), onClose())}>
      {order && (
        <div class={styles.body}>
          <h2 class={styles.number} aria-label={`${order.number}番`}>
            {order.number}
            <span class={styles.unit}>番</span>
          </h2>
          <QrCode value={orderUrl(location.origin, eventId, order.id)} label={`${order.number}番の状況を見るQRコード`} />
          <p class={styles.hint}>お客様に、このQRを読み取ってもらってください</p>
          <Button variant="primary" big block onClick={onClose} autofocus>
            閉じる
          </Button>
        </div>
      )}
    </dialog>
  );
}
