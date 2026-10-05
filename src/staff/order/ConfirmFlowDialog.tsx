// 確定の流れの画面（order-confirm.md §4 の表）。idle 以外の間、画面全体に重ねる（カートを触れないように）。
// 結果の画面（done）だけは、閉じられる
import { useEffect, useRef } from 'preact/hooks';
import { Button } from '../../components/Button';
import { QrCode } from '../../components/QrCode';
import type { ConfirmContext, ConfirmState, FailReason } from '../../lib/domain/confirmFlow';
import { formatDay, toDay } from '../../lib/domain/day';
import { calcChange, formatYen } from '../../lib/domain/order';
import { orderUrl } from '../../lib/domain/url';
import styles from './ConfirmFlowDialog.module.css';

const FAIL_TEXT: Record<FailReason, { title: string; message: string }> = {
  offline: { title: '通信できません', message: '電波を確認してください。この注文は、まだ登録されていません' },
  timeout: { title: '送れていません', message: '通信が不安定です。登録されているかもしれないので、「もう一度試す」か「やめる」で確かめます' },
  permission: { title: '登録できません', message: 'イベントのメンバーか確認してください' },
  conflict: { title: '送れていません', message: 'もう一度試してください' },
  voided: { title: 'この注文は、やめた扱いです', message: '同じ品目のまま、新しい番号で確定し直せます' },
};

type Props = {
  state: ConfirmState;
  /** 手動の「もう一度確認」を、裏の処理の途中で押した */
  recheckBusy: boolean;
  eventId: string;
  onRetry: () => void;
  onAbandon: () => void;
  onRecheck: () => void;
  onResubmit: () => void;
  /** やめた扱いの注文を、問い合わせずに閉じる */
  onDismiss: () => void;
  onClose: () => void;
};

export function ConfirmFlowDialog({ state, recheckBusy, eventId, onRetry, onAbandon, onRecheck, onResubmit, onDismiss, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = state.kind !== 'idle';

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      class={styles.dialog}
      aria-labelledby="confirm-flow-title"
      // Esc では閉じない（結果の画面だけ、閉じる）
      onCancel={(e) => {
        e.preventDefault();
        if (state.kind === 'done') onClose();
      }}
    >
      {/* 状態が変わったら、読み上げる */}
      {open && (
        <div class={styles.body} aria-live="assertive">
          {content()}
        </div>
      )}
    </dialog>
  );

  function content() {
    switch (state.kind) {
      case 'idle':
        return null;
      case 'submitting':
        return (
          <>
            <div class={styles.spinner} aria-hidden="true" />
            <h2 id="confirm-flow-title" class={styles.title}>
              送信中…
            </h2>
            <p class={styles.message}>合計 {formatYen(state.ctx.draft.total)}</p>
          </>
        );
      case 'failed': {
        const t = FAIL_TEXT[state.reason];
        return (
          <>
            <h2 id="confirm-flow-title" class={`${styles.title} ${styles.error}`}>
              {t.title}
            </h2>
            <p class={styles.message}>{t.message}</p>
            <div class={styles.actions}>
              {state.reason === 'voided' ? (
                <Button variant="primary" big block onClick={onResubmit}>
                  新しい番号で確定し直す
                </Button>
              ) : (
                <Button variant="primary" big block onClick={onRetry}>
                  もう一度試す
                </Button>
              )}
              {/* やめた扱いと分かっている注文は、問い合わせずに戻る（カートは残す） */}
              <Button variant="secondary" block onClick={state.reason === 'voided' ? onDismiss : onAbandon}>
                {state.reason === 'voided' ? '確定せずに戻る' : 'やめる'}
              </Button>
            </div>
          </>
        );
      }
      case 'abandoning':
        return (
          <>
            <div class={styles.spinner} aria-hidden="true" />
            <h2 id="confirm-flow-title" class={styles.title}>
              登録されているか確かめています…
            </h2>
            <p class={styles.message}>登録されていなければ、この注文をやめます</p>
          </>
        );
      case 'checking':
        return (
          <>
            <div class={styles.spinner} aria-hidden="true" />
            <h2 id="confirm-flow-title" class={styles.title}>
              前の注文を確かめています…
            </h2>
            <p class={styles.message}>前回、確定の途中で終わった注文が、登録されたかを確かめます</p>
          </>
        );
      case 'unverifiable':
        return (
          <>
            <h2 id="confirm-flow-title" class={`${styles.title} ${styles.error}`}>
              確認できません
            </h2>
            <p class={styles.message}>
              通信できないため、前の注文が登録されたか分かりません。電波の良い場所に移ると、自動で確かめ直します（15秒ごと）。すぐ試すときは「もう一度確認」を押してください
            </p>
            <DraftSummary ctx={state.ctx} />
            {recheckBusy && <p class={styles.note}>確認中です。少し待ってください</p>}
            <div class={styles.actions}>
              <Button variant="primary" big block onClick={onRecheck}>
                もう一度確認
              </Button>
            </div>
          </>
        );
      case 'decide': {
        // 前の注文は、登録されていない（注文も墓標も無い）。もう一度確定するか、やめるかを選んでもらう（order-confirm.md §4）
        const otherDay = state.ctx.day !== toDay();
        return (
          <>
            <h2 id="confirm-flow-title" class={`${styles.title} ${styles.error}`}>
              前の注文は、登録されていません
            </h2>
            <DraftSummary ctx={state.ctx} />
            {otherDay ? (
              // 前日の注文を確定すると、前日の日付・番号で登録されるため、やめることをすすめる
              <>
                <p class={styles.message}>{formatDay(state.ctx.day)}の注文です。やめることをおすすめします</p>
                <div class={styles.actions}>
                  <Button variant="primary" big block onClick={onAbandon}>
                    やめる
                  </Button>
                  <Button variant="secondary" block onClick={onRetry}>
                    {formatDay(state.ctx.day)}の注文として確定する
                  </Button>
                </div>
              </>
            ) : (
              <div class={styles.actions}>
                <Button variant="primary" big block onClick={onRetry}>
                  もう一度確定する
                </Button>
                <Button variant="secondary" block onClick={onAbandon}>
                  やめる
                </Button>
              </div>
            )}
          </>
        );
      }
      case 'done': {
        const { order, ctx } = state;
        const change = ctx.draft.payment === 'cash' && ctx.tendered > 0 ? calcChange(order.total, ctx.tendered) : null;
        return (
          <>
            {state.recovered && <p class={styles.note}>この注文は、登録されていました</p>}
            <h2 id="confirm-flow-title" class={styles.number} aria-label={`${order.number}番`}>
              {order.number}
              <span class={styles.numberUnit}>番</span>
            </h2>
            {order.qr ? (
              <>
                <QrCode value={orderUrl(location.origin, eventId, order.orderId)} label={`${order.number}番の状況を見るQRコード`} />
                <p class={styles.message}>お客様に、このQRを読み取ってもらってください。できあがりを、スマホで確かめられます</p>
              </>
            ) : (
              <dl class={styles.amounts}>
                <dt>合計</dt>
                <dd>{formatYen(order.total)}</dd>
                {change !== null && (
                  <>
                    <dt>{change < 0 ? '不足' : 'お釣り'}</dt>
                    <dd>{formatYen(Math.abs(change))}</dd>
                  </>
                )}
              </dl>
            )}
            <div class={styles.actions}>
              <Button variant="primary" big block onClick={onClose} autofocus>
                {order.qr ? '閉じる' : 'OK'}
              </Button>
            </div>
          </>
        );
      }
    }
  }
}

/** 前の注文の品目と合計（確認できない・決めてもらうとき） */
function DraftSummary({ ctx }: { ctx: ConfirmContext }) {
  return (
    <ul class={styles.draft} aria-label="前の注文の品目">
      {ctx.draft.items.map((l) => (
        <li key={l.menuId}>
          <span>
            {l.name} × {l.qty}
          </span>
          <span>{formatYen(l.price * l.qty)}</span>
        </li>
      ))}
      <li class={styles.draftTotal}>
        <span>合計（{ctx.draft.payment === 'cash' ? '現金' : 'PayPay'}）</span>
        <span>{formatYen(ctx.draft.total)}</span>
      </li>
    </ul>
  );
}
