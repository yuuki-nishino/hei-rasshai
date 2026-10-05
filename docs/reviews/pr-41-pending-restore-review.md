# PR #41 のレビュー（pending の保存と復元、確認できない状態からの自動復帰）

- 日付：2026-10-06
- 対象：[PR #41](https://github.com/yuuki-nishino/maido-ookini/pull/41)（#14。`src/state/confirmRunner.ts`、`src/state/confirm.ts`、`src/lib/domain/confirmFlow.ts`、`src/staff/App.tsx`、`src/staff/order/ConfirmFlowDialog.tsx`、`src/staff/order/OrderPage.tsx`、テスト（`src/state/confirmRunner.test.ts`、`test/data/confirmFlow.test.ts`、`test/domain/confirmFlow.test.ts`）、設計書（order-confirm.md・screens.md・testing.md））。レビュー時の HEAD は `0d1fa5b`
- 観点：正しさ（バグ）
- 重大度：🔴 高（SPEC違反・データ不整合・権限の漏れ）／🟠 中／🟡 低／ℹ️ 情報
- 確認したこと：差分と、周辺のコード（reducer・runner・`state/confirm.ts`・`orders.ts`・保存とカートの補助）を読んだ。テストは、手元では動かしていない。下の指摘は、コードを読んで確かめた

## 結論

**明確なバグは無い。🟡 の指摘が2件。** どちらもマージを止める必要は無い。直すなら、この PR か、続きの Issue で。

| # | 重大度 | 内容 |
|---|---|---|
| P1 | 🟡 低 | `recheck()` が `'busy'` を返した後、状態が `unverifiable` のままだと、「確認中です」の表示が最大15秒残る |
| P2 | 🟡 低 | イベントを離れて戻ると、古いランナーの裏の処理が止まらず、新しいランナーの確認と重なることがある |

## 指摘

### P1 🟡 「確認中です」が、確認していないのに残る

**場所**：`src/state/confirm.ts:112`（`recheckConfirm`）、`src/state/confirm.ts:67`（`set()`）

**問題**：
- `recheckConfirm` は、`recheck()` が `'busy'`（裏の処理が実行中）を返すと、`recheckBusy` を true にする
- `recheckBusy` を false に戻すのは、`set()` で、状態が `unverifiable` でなくなったときだけ
- 裏の処理が終わっても、状態が `unverifiable` のままなら、フラグは戻らない

**起こりうること**：「もう一度確認」を押したとき、裏で確認が動いていて、その確認も失敗して `unverifiable` のまま終わる。画面には「確認中です。少し待ってください」が出続ける。次の15秒ごとの `kick` が確認を始めるまで（最大15秒）、実際には何も確認していないのに、確認中と表示される。

**直し方の案**：
- 裏の処理が終わったとき（`inflight` が空になったとき）に、`recheckBusy` を false に戻す
- または、`recheckBusy` を保存せず、「押した直後の一定時間だけ表示する」形にする
- 単体テスト（偽のタイマー）に、「busy → 裏の処理が `unverifiable` で終わる → 表示が消える」を足す

### P2 🟡 イベントを離れて戻ると、古い裏の処理と重なる

**場所**：`src/state/confirm.ts:121`（イベントを離れたときの `effect`）、`runnerFor`

**問題**：
- イベントを離れたとき、またはランナーのキーが変わったとき、古いランナーを捨て、`confirmState` を初期化する
- 古いランナーの、途中の `confirmOrder` / `voidOrFind` は、止められない。`inflight` の目印も、ランナーごと失われる
- 同じイベントへ戻ると、`resumePending` が新しいランナーを始める

**起こりうること**：
1. 確定の書き込みが遅い間に、イベントを離れて、すぐ戻る
2. 新しいランナーの `findOrder` が、古い書き込みの完了前に走り、`missing`（どちらも無し）になる
3. 「前の注文は、登録されていません」（`decide`）のダイアログが出る
4. 「もう一度確定する」を選ぶと、同じ `orderId` を再送する。「登録済み」にはならず、競合や権限エラーになることがある

書き込みが遅い間に、素早く離れて戻る必要があり、まれ。

**直し方の案**：
- 古いランナーを捨てるとき、裏の処理の完了を待つ（または、`inflight` をランナーの外に持ち、新しいランナーが引き継ぐ）。完了までは、`resumePending` を始めない
- 結合テストに、「書き込みの途中で離れて戻る」を足す（testing.md §4 の同時実行の項と合わせる）

## 確かめて、問題が無かったこと

- `pending` の保存の時機（確定のトランザクションの前、「やめる」の前に `abandoning: true` で保存し直す）と、消去の時機（`done`・`idle`）
- `decide`・`unverifiable` の間は記録を残し、記録がある間は新しい注文を確定できないこと
