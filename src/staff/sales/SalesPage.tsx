// 売上（screens.md §3.6、SPEC 6.3）。日付ごとの集計・メニュー別・集計のコピー・CSV保存。常時購読はしない
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import { DaySelector } from '../../components/DaySelector';
import { Empty, Loading } from '../../components/Feedback';
import { AppError } from '../../lib/data/errors';
import { fetchOrdersOfDay } from '../../lib/data/orders';
import type { Order } from '../../lib/data/types';
import { buildCsv, buildSummaryText, csvFileName } from '../../lib/domain/csv';
import { toDay } from '../../lib/domain/day';
import { formatYen } from '../../lib/domain/order';
import { summarize } from '../../lib/domain/summary';
import { currentEvent } from '../../state/myEvents';
import { showToast } from '../../state/toast';
import styles from './SalesPage.module.css';

type Load = { status: 'loading' } | { status: 'error'; code: string } | { status: 'ok'; orders: Order[]; fromCache: boolean };

function downloadCsv(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SalesPage({ eventId }: { eventId: string }) {
  const eventName = currentEvent.value?.name ?? 'イベント';
  const [day, setDay] = useState(toDay());
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  // コピーに失敗したとき、テキストを選べる表示に切り替える
  const [manualText, setManualText] = useState<string | null>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    setManualText(null);
    fetchOrdersOfDay(eventId, day).then(
      (r) => !cancelled && setLoad({ status: 'ok', ...r }),
      (e: unknown) => {
        console.error(e);
        if (!cancelled) setLoad({ status: 'error', code: e instanceof AppError ? e.code : 'unknown' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, day, reload]);

  useEffect(() => {
    if (manualText !== null) manualRef.current?.select();
  }, [manualText]);

  const loaded = load.status === 'ok' ? load : null;
  const summary = loaded ? summarize(loaded.orders) : null;

  async function copy() {
    if (!summary) return;
    const text = buildSummaryText(eventName, day, summary);
    try {
      await navigator.clipboard.writeText(text);
      setManualText(null);
      showToast('success', '集計をコピーしました');
    } catch (e) {
      console.error(e);
      setManualText(text);
    }
  }

  function saveCsv() {
    if (!loaded) return;
    downloadCsv(buildCsv(loaded.orders), csvFileName(eventName, day));
  }

  return (
    <section class={styles.page} aria-labelledby="sales-title">
      <div class={styles.head}>
        <h2 id="sales-title" class={styles.h2}>
          売上
        </h2>
        <Button variant="secondary" disabled={load.status === 'loading'} onClick={() => setReload((n) => n + 1)}>
          更新
        </Button>
      </div>

      <DaySelector day={day} onChange={setDay} />

      {load.status === 'loading' && <Loading label="売上を読み込み中…" />}

      {load.status === 'error' && (
        <p class={`${styles.notice} ${styles.error}`} role="alert">
          {load.code === 'permission'
            ? '読み込めませんでした。イベントのメンバーか確かめてください'
            : '読み込めませんでした。通信を確かめて、「更新」を押してください'}
        </p>
      )}

      {loaded && summary && (
        <>
          {loaded.fromCache && (
            <p class={`${styles.notice} ${styles.warn}`} role="status">
              オフラインのため、一部の注文が欠けている可能性があります。通信が戻ったら、「更新」を押してください
            </p>
          )}

          {loaded.orders.length === 0 ? (
            <Empty title="この日の注文はありません" />
          ) : (
            <>
              <div class={styles.panel}>
                <dl class={styles.rows}>
                  <div class={styles.row}>
                    <dt>現金</dt>
                    <dd>
                      {formatYen(summary.cashTotal)} <span class={styles.sub}>（{summary.cashCount}件）</span>
                    </dd>
                  </div>
                  <div class={styles.row}>
                    <dt>PayPay</dt>
                    <dd>
                      {formatYen(summary.paypayTotal)} <span class={styles.sub}>（{summary.paypayCount}件）</span>
                    </dd>
                  </div>
                  <div class={`${styles.row} ${styles.total}`}>
                    <dt>合計</dt>
                    <dd>
                      {formatYen(summary.grandTotal)} <span class={styles.sub}>（{summary.grandCount}件）</span>
                    </dd>
                  </div>
                </dl>
                <p class={styles.hint}>取り消した注文は、集計に入りません（CSVには、状態「取り消し」で入ります）</p>
              </div>

              {summary.byItem.length > 0 && (
                <div class={styles.panel}>
                  <h3 class={styles.h3}>メニュー別</h3>
                  <table class={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">メニュー</th>
                        <th scope="col" class={styles.num}>
                          単価
                        </th>
                        <th scope="col" class={styles.num}>
                          数
                        </th>
                        <th scope="col" class={styles.num}>
                          小計
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byItem.map((i) => (
                        <tr key={i.key}>
                          <th scope="row">{i.name}</th>
                          <td class={styles.num}>{formatYen(i.price)}</td>
                          <td class={styles.num}>{i.qty}</td>
                          <td class={styles.num}>{formatYen(i.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div class={styles.actions}>
                <Button variant="secondary" disabled={loaded.fromCache} onClick={() => void copy()}>
                  集計をコピー
                </Button>
                <Button variant="secondary" disabled={loaded.fromCache} onClick={saveCsv}>
                  CSV保存
                </Button>
              </div>
              {loaded.fromCache && <p class={styles.hint}>欠けた集計を持ち出さないよう、通信が戻って「更新」するまで、コピーとCSV保存はできません</p>}

              {manualText !== null && (
                <div class={styles.panel}>
                  <p class={styles.hint}>コピーできませんでした。下の文字を選んで、コピーしてください</p>
                  <textarea ref={manualRef} class={styles.manual} readOnly rows={Math.min(14, manualText.split('\n').length + 1)} value={manualText} />
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
