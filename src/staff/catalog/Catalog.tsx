// 部品の見本（/#catalog。本番には含めない）。visual.md の決まりを、実機で確かめるためのページ
import type { TargetedEvent } from 'preact';
import { useState } from 'preact/hooks';
import { PaymentBadge, StatusBadge, type OrderStatus, type Payment } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Empty, ErrorView, Loading } from '../../components/Feedback';
import { Logo } from '../../components/Logo';
import { Noren } from '../../components/Noren';
import { StatusBar } from '../../components/StatusBar';
import { TextField } from '../../components/TextField';
import { Toast, ToastRegion } from '../../components/Toast';
import styles from './Catalog.module.css';

const colors = [
  ['--color-bg', '地（生成り）'],
  ['--color-surface', 'カード'],
  ['--color-ink', '文字'],
  ['--color-ink-sub', '補足の文字'],
  ['--color-brand', '弁柄'],
  ['--color-nature', '苔'],
  ['--status-cooking-bg', '調理中'],
  ['--status-ready-bg', 'できあがり'],
  ['--status-done-bg', 'お渡し済み'],
  ['--status-void-bg', '取り消し'],
  ['--pay-cash-bg', '現金'],
  ['--pay-paypay-bg', 'PayPay'],
] as const;

const orders: { no: number; status: OrderStatus; payment: Payment; items: string }[] = [
  { no: 24, status: 'preparing', payment: 'cash', items: '焼きそば ×2、ラムネ ×1' },
  { no: 23, status: 'ready', payment: 'paypay', items: 'たこ焼き ×1' },
  { no: 22, status: 'done', payment: 'cash', items: '焼きそば ×1、フランクフルト ×2' },
  { no: 21, status: 'cancelled', payment: 'paypay', items: 'ラムネ ×3' },
];

export function Catalog() {
  const [dialog, setDialog] = useState(false);
  const [toasts, setToasts] = useState<('success' | 'error')[]>([]);
  const [name, setName] = useState('');

  return (
    <>
      <Noren title="夏まつり 焼きそば屋" sub="部品の見本（dev だけ）" actions={<Button variant="secondary">メニュー</Button>} />
      <main class={styles.page}>
        <section class={styles.section}>
          <h2 class={styles.h2}>ロゴ</h2>
          <Logo />
        </section>

        <section class={styles.section}>
          <h2 class={styles.h2}>色</h2>
          <div class={styles.row}>
            {colors.map(([v, label]) => (
              <div key={v} class={styles.swatch}>
                <div class={styles.chip} style={{ background: `var(${v})` }} />
                {label}
              </div>
            ))}
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.h2}>文字</h2>
          <div class={styles.type}>
            <p class="hand-bold" style={{ fontSize: 'var(--fs-3xl)' }}>毎度おおきに（ロゴ・太）</p>
            <p class="hand-bold" style={{ fontSize: 'var(--fs-xl)' }}>見出し：注文を受ける（太）</p>
            <p class="hand" style={{ fontSize: 'var(--fs-xl)' }}>見出し：注文を受ける（細）</p>
            <p class="hand" style={{ fontSize: 'var(--fs-2xl)' }}>番号 0123456789</p>
            <p>本文：注文の受付・呼び出し・売上を、スマホひとつで。合計 1,200円</p>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-ink-sub)' }}>補足：8月1日（土）・本日 23件</p>
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.h2}>ボタン</h2>
          <div class={styles.row}>
            <Button variant="primary">確定する</Button>
            <Button variant="secondary">クリア</Button>
            <Button variant="danger">取り消す</Button>
            <Button variant="primary" disabled>
              押せない
            </Button>
          </div>
          <Button variant="primary" big block>
            確定して 25番を発行
          </Button>
        </section>

        <section class={styles.section}>
          <h2 class={styles.h2}>バッジ・カード</h2>
          <div class={styles.grid}>
            {orders.map((o) => (
              <Card key={o.no} muted={o.status === 'done' || o.status === 'cancelled'}>
                <div class={styles.order}>
                  <span class={`${styles.number} hand-bold`}>{o.no}</span>
                  <div class={styles.row} style={{ gap: 'var(--sp-2)' }}>
                    <StatusBadge status={o.status} />
                    <PaymentBadge payment={o.payment} />
                  </div>
                  <span class={styles.items}>{o.items}</span>
                </div>
              </Card>
            ))}
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.h2}>入力欄</h2>
          <div class={styles.grid}>
            <TextField label="イベント名" placeholder="例：夏まつり 焼きそば屋" hint="40文字まで" value={name} onInput={(e: TargetedEvent<HTMLInputElement>) => setName(e.currentTarget.value)} />
            <TextField label="価格（円）" inputMode="numeric" value="0" error="1円から100,000円で入れてください" />
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.h2}>接続状態</h2>
          <div class={styles.type}>
            <StatusBar connection="pending" pendingCount={3} />
            <StatusBar connection="pending" pendingUnknown />
            <StatusBar connection="offline" />
            <StatusBar connection="offline" pendingCount={2} />
            <StatusBar connection="offline" pendingUnknown />
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.h2}>ダイアログ・トースト</h2>
          <div class={styles.row}>
            <Button variant="danger" onClick={() => setDialog(true)}>
              24番を取り消す
            </Button>
            <Button variant="secondary" onClick={() => setToasts((t) => [...t, 'success'])}>
              成功のトースト
            </Button>
            <Button variant="secondary" onClick={() => setToasts((t) => [...t, 'error'])}>
              失敗のトースト
            </Button>
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.h2}>読み込み中・0件・失敗</h2>
          <div class={styles.grid}>
            <Card>
              <Loading />
            </Card>
            <Card>
              <Empty title="まだ注文はありません">
                <Button variant="primary">注文を受ける</Button>
              </Empty>
            </Card>
            <Card>
              <ErrorView title="読み込めませんでした">
                <Button variant="secondary">もう一度</Button>
              </ErrorView>
            </Card>
          </div>
        </section>
      </main>

      <ConfirmDialog
        open={dialog}
        title="24番を取り消しますか？"
        confirmLabel="取り消す"
        danger
        onConfirm={() => setDialog(false)}
        onCancel={() => setDialog(false)}
      >
        焼きそば ×2、ラムネ ×1（現金 1,200円）。取り消した注文は、あとから元に戻せます。
      </ConfirmDialog>

      <ToastRegion>
        {toasts.map((kind, i) => (
          <Toast
            key={i}
            kind={kind}
            message={kind === 'success' ? '25番を発行しました' : '保存できませんでした。通信を確認してください'}
            onClose={() => setToasts((t) => t.filter((_, j) => j !== i))}
          />
        ))}
      </ToastRegion>
    </>
  );
}
