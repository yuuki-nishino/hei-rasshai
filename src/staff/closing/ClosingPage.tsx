// レジ締め（screens.md §3.7、SPEC 6.4）。日付ごとに、準備金・あるはずの現金・数えた現金・差額を確かめ、記録する。
// サーバーの確かな値（fetchOrdersOfDayFromServer・getClosing）でだけ行う。オフラインのときは、集計を出さず、「締める」を無効にする
import type { TargetedEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import { DaySelector } from '../../components/DaySelector';
import { Loading } from '../../components/Feedback';
import { TextField } from '../../components/TextField';
import { saveClosing, getClosing } from '../../lib/data/closings';
import { AppError } from '../../lib/data/errors';
import { watchMembers } from '../../lib/data/members';
import { fetchOrdersOfDayFromServer } from '../../lib/data/orders';
import type { Closing, Member } from '../../lib/data/types';
import {
  calcDiff,
  calcExpectedCash,
  CLOSING_NOTE_MAX,
  closingView,
  diffKind,
  normalizeClosingNote,
  parseCashAmount,
} from '../../lib/domain/closing';
import { formatDateTime, toDay } from '../../lib/domain/day';
import { formatYen } from '../../lib/domain/order';
import { summarize, type Summary } from '../../lib/domain/summary';
import { currentEvent } from '../../state/myEvents';
import { browserOnline } from '../../state/online';
import { showToast } from '../../state/toast';
import styles from './ClosingPage.module.css';

type Load = { status: 'loading' } | { status: 'error'; code: string } | { status: 'ok'; summary: Summary; closing: Closing | null };

/** 「差額：一致」「差額：不足 ¥100」「差額：多い ¥100」（負の金額を、「¥-100」とは書かない） */
function diffLabel(diff: number): string {
  const kind = diffKind(diff);
  return kind === 'match' ? '差額：一致' : `差額：${kind === 'short' ? '不足' : '多い'} ${formatYen(Math.abs(diff))}`;
}

function saveMessage(e: unknown): string {
  if (e instanceof AppError && e.code === 'offline') return '通信できません。レジ締めは、通信できる状態で行ってください';
  if (e instanceof AppError && e.code === 'timeout') return '送れていません。通信を確かめて、もう一度締めてください';
  if (e instanceof AppError && e.code === 'validation') return e.message;
  if (e instanceof AppError && e.code === 'permission') return '締められませんでした。イベントのメンバーか確かめてください';
  return 'うまくいきませんでした。時間をおいて、もう一度押してください';
}

export function ClosingPage({ eventId, uid }: { eventId: string; uid: string }) {
  const online = browserOnline.value;
  const eventFloat = currentEvent.value?.floatCash ?? 0;
  const [day, setDay] = useState(toDay());
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);
  // 入力（文字のまま）。日付を変えたとき・締めたあとに、締めの記録から入れ直す。「更新」では、入力中の値を残す
  const [floatText, setFloatText] = useState('');
  const [actualText, setActualText] = useState('');
  const [noteText, setNoteText] = useState('');
  // 次に取得できたとき、入力を、締めの記録から入れ直す（最初・日付を変えたとき・締めたあと）。「更新」では、入れ直さない
  const initNextRef = useRef(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 締めた人の表示名を引くため（引けないときは「（退会済み）」。screens.md §1.4）
  useEffect(() => watchMembers(eventId, setMembers, () => {}), [eventId]);

  // 日付を変えたら、入力を入れ直す（取得の前に、目印を立てる。下の取得の副作用より、先に宣言する）
  useEffect(() => {
    initNextRef.current = true;
    setSaveError(null);
  }, [day]);

  // サーバーから取得する（開いたとき・日付を変えたとき・「更新」）。オフラインのときは、取得しない
  useEffect(() => {
    if (!online) {
      setLoad({ status: 'error', code: 'offline' });
      return;
    }
    let cancelled = false;
    setLoad({ status: 'loading' });
    Promise.all([fetchOrdersOfDayFromServer(eventId, day), getClosing(eventId, day)]).then(
      ([orders, closing]) => {
        if (cancelled) return;
        const summary = summarize(orders);
        setLoad({ status: 'ok', summary, closing });
        if (initNextRef.current) {
          // 入力の初期値：準備金は、締めがあればその準備金、無ければイベントの準備金
          initNextRef.current = false;
          setFloatText(String(closingView(summary, closing, eventFloat).initialFloat));
          setActualText(closing ? String(closing.actualCash) : '');
          setNoteText(closing?.note ?? '');
        }
      },
      (e: unknown) => {
        console.error(e);
        if (!cancelled) setLoad({ status: 'error', code: e instanceof AppError ? e.code : 'unknown' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, day, reload, online, eventFloat]);

  const loaded = load.status === 'ok' ? load : null;
  const view = loaded ? closingView(loaded.summary, loaded.closing, eventFloat) : null;
  const floatCash = parseCashAmount(floatText);
  const actualCash = parseCashAmount(actualText);
  const note = normalizeClosingNote(noteText);
  const expected = loaded && floatCash !== null ? calcExpectedCash(floatCash, loaded.summary.cashTotal) : null;
  const diff = expected !== null && actualCash !== null ? calcDiff(actualCash, expected) : null;
  const canSave = online && !!loaded && !saving && floatCash !== null && actualCash !== null && note !== null;

  async function save() {
    if (!loaded || floatCash === null || actualCash === null || note === null || expected === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      // 締めるのは、サーバーから取得して集計した、いまの現金売上で（部分的なキャッシュで締めない）
      await saveClosing(eventId, day, { floatCash, expectedCash: expected, actualCash, note }, uid);
      showToast('success', 'レジ締めを保存しました');
      initNextRef.current = true; // 保存された記録から、入れ直す
      setReload((n) => n + 1);
    } catch (e) {
      console.error(e);
      setSaveError(saveMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const closedBy = loaded?.closing ? (members.find((m) => m.uid === loaded.closing!.closedBy)?.displayName || '（退会済み）') : null;
  const num = (e: TargetedEvent<HTMLInputElement>) => e.currentTarget.value;

  return (
    <section class={styles.page} aria-labelledby="closing-title">
      <div class={styles.head}>
        <h2 id="closing-title" class={styles.h2}>
          レジ締め
        </h2>
        <Button variant="secondary" disabled={!online || load.status === 'loading'} onClick={() => setReload((n) => n + 1)}>
          更新
        </Button>
      </div>

      <DaySelector day={day} onChange={setDay} />

      {load.status === 'loading' && <Loading label="売上を読み込み中…" />}

      {load.status === 'error' && (
        <p class={`${styles.notice} ${styles.error}`} role="alert">
          {load.code === 'offline'
            ? '通信できません。レジ締めは、通信できる状態で行ってください'
            : load.code === 'permission'
              ? '読み込めませんでした。イベントのメンバーか確かめてください'
              : '読み込めませんでした。通信を確かめて、「更新」を押してください'}
        </p>
      )}

      {loaded && view && (
        <>
          {loaded.closing && (
            <p class={styles.closed}>
              {formatDateTime(loaded.closing.closedAt ?? new Date())}に、{closedBy}が締めました（数えた現金 {formatYen(loaded.closing.actualCash)}・
              {diffLabel(loaded.closing.diff)}）。締め直すと、上書きされます
            </p>
          )}
          {/* 締めた後に、現金売上が変わった（注文の追加・取り消し・支払い方法の変更）。締めの記録は、上書きするまで変わらない */}
          {view.changedAfterClosing && loaded.closing && (
            <p class={`${styles.notice} ${styles.warn}`} role="status">
              締め後に変更あり：現金売上が変わりました（締めたときのあるはずの現金 {formatYen(loaded.closing.expectedCash)} → いま {formatYen(view.recomputedExpected ?? 0)}）。必要なら、締め直してください
            </p>
          )}

          <div class={styles.panel}>
            <dl class={styles.rows}>
              <div class={styles.row}>
                <dt>現金売上</dt>
                <dd>
                  {formatYen(loaded.summary.cashTotal)} <span class={styles.sub}>（{loaded.summary.cashCount}件）</span>
                </dd>
              </div>
              <div class={styles.row}>
                <dt>PayPay</dt>
                <dd>
                  {formatYen(loaded.summary.paypayTotal)} <span class={styles.sub}>（{loaded.summary.paypayCount}件）</span>
                </dd>
              </div>
            </dl>

            <div class={styles.inputs}>
              <TextField
                label="釣り銭の準備金（円）"
                inputMode="numeric"
                value={floatText}
                error={floatText !== '' && floatCash === null ? '0円から10,000,000円の整数で入れてください' : null}
                onInput={(e) => setFloatText(num(e))}
              />
              <TextField
                label="数えた現金（円）"
                inputMode="numeric"
                placeholder="例：25000"
                value={actualText}
                error={actualText !== '' && actualCash === null ? '0円から10,000,000円の整数で入れてください' : null}
                onInput={(e) => setActualText(num(e))}
              />
              <div class={styles.noteField}>
                <TextField
                  label="メモ（任意）"
                  placeholder="例：5番 現金→PayPay ¥500（前日の取り違え）"
                  maxLength={CLOSING_NOTE_MAX}
                  hint="前日以前の、支払い方法の取り違えに気づいたときなどに残します"
                  value={noteText}
                  error={note === null ? `メモは${CLOSING_NOTE_MAX}文字までです` : null}
                  onInput={(e) => setNoteText(num(e))}
                />
              </div>
            </div>

            <dl class={styles.rows}>
              <div class={styles.row}>
                <dt>あるはずの現金（準備金＋現金売上）</dt>
                <dd>{expected !== null ? formatYen(expected) : '—'}</dd>
              </div>
            </dl>

            {/* 差額：一致＝緑、不一致＝赤。文字でも示す */}
            <div class={`${styles.diff} ${diff === null ? styles.pending : diffKind(diff) === 'match' ? styles.match : styles.mismatch}`} role="status">
              <span>
                {diff === null ? '差額' : diffKind(diff) === 'match' ? '差額：一致' : diffKind(diff) === 'short' ? '差額：不足' : '差額：多い'}
              </span>
              <span>{diff === null ? '数えた現金を入れてください' : formatYen(Math.abs(diff))}</span>
            </div>

            {saveError && (
              <p class={`${styles.notice} ${styles.error}`} role="alert">
                {saveError}
              </p>
            )}
            <Button variant="primary" big block disabled={!canSave} onClick={() => void save()}>
              {saving ? '保存中…' : loaded.closing ? '締め直す' : '締める'}
            </Button>
            {!online && <p class={styles.hint}>レジ締めには、通信が必要です</p>}
          </div>
        </>
      )}
    </section>
  );
}
