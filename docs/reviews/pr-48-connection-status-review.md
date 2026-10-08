# PR #48 のレビュー（接続状態と未送信の表示）

- 日付：2026-10-08
- 対象：[PR #48](https://github.com/yuuki-nishino/maido-ookini/pull/48)（#19。`src/state/connection.ts`、`src/lib/domain/connection.ts`、`src/lib/data/writes.ts`、`src/state/orders.ts`、ステータスバー）
- 観点：正しさ（バグ）
- 重大度：🔴 高（SPEC違反・データ不整合・権限の漏れ）／🟠 中／🟡 低／ℹ️ 情報
- 確認したこと：コードの差分を読んだ（レビューは自動のレビューで行った）。テストは、手元では動かしていない。実際の画面でも、確かめていない。下の指摘は、コードを読んでの判断であり、再現はしていない。★の位置（行番号）は目安

## 結論

**🔴の指摘は無い。C1〜C3（🟠）は、このPRの目的（オフライン時に、未送信があることを伝える）に直結するため、マージの前に直すことを勧める。** C4・C5（🟡）は、直さなくても実害は小さい。

| # | 重大度 | 内容 |
|---|---|---|
| C1 | 🟠 中 | 購読がエラーで終わると、接続状態が更新されず、「オフライン」（または古い「オンライン」）のまま残る |
| C2 | 🟠 中 | オフライン中の表示が `pendingUnknown` を無視し、未送信の書き込みがあることが伝わらない |
| C3 | 🟠 中 | `checkPendingAfterReload` が、リロード前後の書き込みを区別できない。`trackWrite` を通らない書き込みは、「未送信」に出ない |
| C4 | 🟡 低 | `trackWrite` の `onRejected` が例外を投げると、unhandled rejection になる |
| C5 | 🟡 低 | `clock` が、タイマー以外では更新されず、表示がちらつく・切り替わりが遅れることがある |

## 指摘

### C1 🟠 購読のエラーのあと、接続状態が戻らない

**場所**：`src/state/connection.ts:19`、`src/state/orders.ts`（`subscribeActiveOrders` の `onError`）

**問題**：
- 10秒のオフライン判定のタイマーが一度動いたあと、非キャッシュのスナップショットが届くか、ブラウザの online／offline のイベントが来るまで、状態は再評価されない
- 購読のエラーのとき、`onError` が `resetConnection()` を呼ばない。`fromCacheSince` が古い値のまま残る

**起こりうること**：権限の変更（`permission-denied`）などで、Shell の購読が失敗する。ネットワークは正常なのに、バーが「オフライン」（赤）のまま出続ける。10秒より前にエラーが来て、タイマーが解除されない場合は、古い「オンライン」が残る。

**直し方の案**：
- `onError` で `resetConnection()` を呼ぶ。または、エラー用の状態（購読が止まっている）を足す
- 購読をやり直すときも、状態を初期化する

### C2 🟠 オフライン中に、未送信の警告が消える

**場所**：`src/lib/domain/connection.ts:36`（`statusBarView`）

**問題**：
- オフラインの分岐が、`pendingUnknown` を見ない。`pendingCount` を `null` で返すため、`StatusBar` は、ただの「オフライン」を出す

**起こりうること**：オフラインのまま、未送信の「渡した」などの書き込みを残してリロードする。`checkPendingAfterReload` が `pendingUnknown = true` にするが、バーには出ない。スタッフが、未送信があることに気づかずにタブを閉じ、書き込みを失うおそれがある。未送信の警告が一番必要な場面で、消えている。

**直し方の案**：オフラインの分岐でも、`pendingUnknown` が真なら「オフライン（未送信があるかもしれません）」のように出す。この組み合わせを、`statusBarView` の単体テストに足す。

### C3 🟠 リロード後の未送信の判定が、粗い

**場所**：`src/lib/data/writes.ts:34`（`checkPendingAfterReload`）

**問題**：
- `waitForPendingWrites` は、リロード前の書き込みと、リロード後の書き込みを区別できない。起動時に1回しか動かない
- 厨房の遷移・支払い・メモの変更以外の書き込み（注文の確定など）は、`trackWrite` を通らず、バーの「未送信」に数えられない

**起こりうること**：オフラインでリロードし、1.5秒以内に厨房画面で操作をする。タイムアウトの時点で、`waitForPendingWrites` は、古い書き込みと新しい書き込みの両方を待っている。`pendingUnknown` が立ったまま `pendingWrites > 0` になり、バーの件数には、リロード前の分が入らない。新しい書き込みが確定しても、すべてが片づくまで「不明」が残る。注文の確定などは、一度も「未送信」に出ない。

**直し方の案**：
- 書き込みを出す入口を1か所にまとめ、すべて `trackWrite` を通す
- リロード前の分は、「不明」の旗でなく、書き込みの数に頼らない別の表示にする。または、設計書（DESIGN.md／screens.md）で、「不明」の意味と範囲を決め直す

### C4 🟡 `onRejected` の例外が、拾われない

**場所**：`src/lib/data/writes.ts:17`（`trackWrite`）

**問題**：`onRejected` は、`catch` のない Promise チェーンの中で動く。ここで例外（たとえば `showToast` の失敗）が出ると、`.finally()` のチェーンが reject になり、unhandled rejection になる。件数の減算は実行される。以前の `p.catch(...)` にも、同じ弱点があった。

**直し方の案**：`onRejected` の呼び出しを `try/catch` で囲む。または、チェーンの最後に `.catch` を足す。

### C5 🟡 `clock` が、古い値のまま使われる

**場所**：`src/state/connection.ts:15`

**問題**：`clock` は、`fromCache` の開始時と、1回きりのタイマーでしか更新されない。`fromCacheSince` が別の経路で設定されると、`connection` は古い `clock` で計算される。

**起こりうること**：`fromCache` が続いている間に `browserOnline` が false から true に変わる。タイマーが解除されて張り直された場合、`fromCacheSince` から `OFFLINE_AFTER_MS` が経っていない `clock` が使われる。「オンライン」と「オフライン」の表示がちらついたり、切り替わりが遅れたりする。

**直し方の案**：刻み続ける時刻源から「今」を求める。または、期限（`fromCacheSince + OFFLINE_AFTER_MS`）を直接計算して、それに合わせてタイマーを張る。

## テストについて

C1〜C3 は、いずれも、画面のタイマーや状態の組み合わせ（オフライン × 不明、エラー × 接続状態）に、テストが無いために見つかりにくい。偽のタイマーを使った単体テスト（`statusBarView` と接続状態）を足すことを勧める。
