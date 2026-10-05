// 注文（screens.md §3.4）。メニューのタップ → カート → 支払い・お預り・QR → 確定。
// カートは、カートに入れた時点の名前・価格を持つ（合計もそれで計算）。確定の処理は #13
import { useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import { Empty, ErrorView, Loading } from '../../components/Feedback';
import type { MenuItem } from '../../lib/data/types';
import { calcChange, formatYen, lineNotice, parseTendered, QTY_MAX, type CartLine } from '../../lib/domain/order';
import {
  addItemToCart,
  applyLineCurrentPrice,
  cartLines,
  cartTotal,
  changeLineQty,
  clearCart,
  payment,
  qr,
  removeCartLine,
  setPayment,
  setQr,
  setTendered,
  tenderedText,
} from '../../state/cart';
import { useMenu } from '../../state/menu';
import styles from './OrderPage.module.css';

const QUICK = [1000, 5000, 10000] as const;

export function OrderPage({ eventId }: { eventId: string }) {
  const { items, error } = useMenu(eventId);
  const [message, setMessage] = useState<string | null>(null);
  const lines = cartLines.value;

  if (error && !items) return <ErrorView title="メニューを読み込めませんでした" />;
  if (!items) return <Loading label="メニューを読み込み中…" />;

  function add(item: MenuItem) {
    const r = addItemToCart(item);
    if (r.ok) {
      setMessage(null);
    } else {
      setMessage(r.reason === 'qtyMax' ? '1つの品は、99個までです' : r.reason === 'linesMax' ? '1つの注文は、50品までです' : '売り切れです');
    }
  }

  return (
    <div class={styles.page}>
      <section aria-labelledby="order-menu-title" class={styles.group}>
        <h2 id="order-menu-title" class={styles.h2}>
          メニュー
        </h2>
        {items.length === 0 ? (
          <Empty title="メニューがありません">
            <p>「メニュー」タブで、品名と価格を追加してください</p>
          </Empty>
        ) : (
          <div class={styles.menu}>
            {items.map((item) => (
              <MenuButton key={item.id} item={item} qty={lines.find((l) => l.menuId === item.id)?.qty ?? 0} onAdd={() => add(item)} />
            ))}
          </div>
        )}
        {message && (
          <p class={styles.error} role="alert">
            {message}
          </p>
        )}
      </section>

      <Cart lines={lines} menu={items} />

      <Options />

      <Footer
        onConfirm={() => {
          // 確定の処理（採番・冪等・タイムアウト）は #13 で足す
          setMessage('確定の処理は、次の更新で使えるようになります');
        }}
      />
    </div>
  );
}

function MenuButton({ item, qty, onAdd }: { item: MenuItem; qty: number; onAdd: () => void }) {
  return (
    <button
      type="button"
      class={`${styles.menuItem} ${qty > 0 ? styles.inCart : ''}`}
      disabled={item.soldOut}
      onClick={onAdd}
      aria-label={`${item.name} ${formatYen(item.price)}${item.soldOut ? '（売り切れ）' : qty > 0 ? `（カートに${qty}）` : ''}`}
    >
      <span class={styles.menuName}>{item.name}</span>
      <span class={styles.menuPrice}>{formatYen(item.price)}</span>
      {item.soldOut && <span class={styles.soldOutLabel}>売り切れ</span>}
      {qty > 0 && (
        <span class={styles.qtyBadge} aria-hidden="true">
          {qty}
        </span>
      )}
    </button>
  );
}

function Cart({ lines, menu }: { lines: CartLine[]; menu: MenuItem[] }) {
  return (
    <section class={styles.cart} aria-labelledby="cart-title">
      <div class={styles.cartHead}>
        <h2 id="cart-title" class={styles.h2}>
          カート
        </h2>
        {/* クリアは、確認なしで空にする（軽い操作。screens.md §3.4） */}
        {lines.length > 0 && (
          <Button variant="secondary" onClick={clearCart}>
            クリア
          </Button>
        )}
      </div>
      {lines.length === 0 ? (
        <p class={styles.lineSub}>メニューをタップすると、ここに入ります</p>
      ) : (
        <ul class={styles.lines}>
          {lines.map((l) => {
            const n = lineNotice(l, menu);
            // 売り切れ・削除された行は、減らす・消すだけ。99個で止める（PR #38 のレビュー C2・C3）
            const canIncrease = !n.soldOut && !n.deleted && l.qty < QTY_MAX;
            return (
              <li key={l.menuId} class={styles.line}>
                <div>
                  <div class={styles.lineName}>{l.name}</div>
                  <div class={styles.lineSub}>
                    {formatYen(l.price)} × {l.qty}
                  </div>
                </div>
                <div class={styles.lineAmount}>{formatYen(l.price * l.qty)}</div>
                <div class={styles.stepper} style={{ gridColumn: '1 / -1' }}>
                  <button type="button" class={styles.step} aria-label={`${l.name}を1つ減らす`} onClick={() => changeLineQty(l.menuId, -1)}>
                    −
                  </button>
                  <span class={styles.qty} aria-label={`数量 ${l.qty}`}>
                    {l.qty}
                  </span>
                  <button
                    type="button"
                    class={styles.step}
                    aria-label={`${l.name}を1つ増やす`}
                    disabled={!canIncrease}
                    onClick={() => changeLineQty(l.menuId, 1)}
                  >
                    ＋
                  </button>
                  <button type="button" class={styles.remove} onClick={() => removeCartLine(l.menuId)}>
                    削除
                  </button>
                </div>
                {/* カートに入れた後で、メニューが変わった（何もしなければ、カートの価格で確定する） */}
                {n.currentPrice !== null && (
                  <p class={styles.notice}>
                    価格変更あり（現在 {formatYen(n.currentPrice)}）
                    <button type="button" class={styles.noticeButton} onClick={() => applyLineCurrentPrice(l.menuId, menu)}>
                      現在の価格にする
                    </button>
                  </p>
                )}
                {n.soldOut && <p class={styles.notice}>売り切れになりました（このまま確定できます）</p>}
                {n.deleted && <p class={styles.notice}>メニューから削除されました（このまま確定できます）</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Options() {
  const pay = payment.value;
  const tendered = parseTendered(tenderedText.value);
  const total = cartTotal.value;
  const change = tendered === null ? null : calcChange(total, tendered);
  return (
    <section class={styles.options} aria-label="支払い">
      <div class={styles.group} role="group" aria-labelledby="pay-label">
        <span id="pay-label" class={styles.label}>
          支払い方法
        </span>
        <div class={styles.segment}>
          <button type="button" class={`${styles.segButton} ${styles.cash}`} aria-pressed={pay === 'cash'} onClick={() => setPayment('cash')}>
            現金
          </button>
          <button type="button" class={`${styles.segButton} ${styles.paypay}`} aria-pressed={pay === 'paypay'} onClick={() => setPayment('paypay')}>
            PayPay
          </button>
        </div>
      </div>

      {pay === 'cash' && (
        <div class={styles.group}>
          <label class={styles.label} for="tendered">
            お預り（円）
          </label>
          <div class={styles.tendered}>
            <input
              id="tendered"
              class={styles.tenderedInput}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={tenderedText.value}
              aria-invalid={tendered === null ? true : undefined}
              onInput={(e) => setTendered(e.currentTarget.value)}
            />
            <Button variant="secondary" disabled={tenderedText.value === ''} onClick={() => setTendered('')}>
              消す
            </Button>
          </div>
          <div class={styles.quick}>
            <button type="button" class={styles.quickButton} disabled={total === 0} onClick={() => setTendered(String(total))}>
              ちょうど
            </button>
            {QUICK.map((v) => (
              <button key={v} type="button" class={styles.quickButton} onClick={() => setTendered(String(v))}>
                {v.toLocaleString('ja-JP')}
              </button>
            ))}
          </div>
          {tendered === null ? (
            <p class={styles.error}>お預りは、0以上の整数で入れてください</p>
          ) : (
            tendered > 0 &&
            change !== null && (
              // 不足でも確定はできる（後で受け取る場合もあるため。screens.md §3.4）
              <p class={`${styles.change} ${change < 0 ? styles.short : ''}`} role="status">
                <span>{change < 0 ? '不足' : 'お釣り'}</span>
                <span>{formatYen(Math.abs(change))}</span>
              </p>
            )
          )}
        </div>
      )}

      <label class={styles.qrToggle}>
        <input type="checkbox" checked={qr.value} onChange={(e) => setQr(e.currentTarget.checked)} />
        <span>番号のQRを発行する（お客様が、できあがりをスマホで確かめられます）</span>
      </label>
    </section>
  );
}

function Footer({ onConfirm }: { onConfirm: () => void }) {
  const empty = cartLines.value.length === 0;
  return (
    <div class={styles.footer}>
      <div class={styles.footerInner}>
        <div class={styles.total} aria-live="polite">
          <span class={styles.totalLabel}>合計</span>
          <span class={styles.totalValue}>{formatYen(cartTotal.value)}</span>
        </div>
        {/* カートが空のときは確定できない。前の注文の確認中（pending）の扱いは #13・#14 */}
        <Button variant="primary" big block disabled={empty} onClick={onConfirm}>
          {empty ? 'メニューを選んでください' : '確定'}
        </Button>
      </div>
    </div>
  );
}
