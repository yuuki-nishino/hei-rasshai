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

## 再レビュー（2026-10-08、`ffc79b3`）

- 確認したこと：`0336e25..ffc79b3` の差分（コード・テスト・設計書）を読んだ。型チェック・Lint・単体テスト（303件）は、手元で通った。結合テスト（`test:data`、Emulator が要る）は動かしていない。追加された結合テスト（`reconnectNow`、C4）は、読んだだけ。devの実機でも確かめていない
- 結論：**前回の指摘は、すべて、解消または納得できる見送り。マージを止める指摘は無い。** R1 は、小さいので、直してからのマージを勧める

### 前回の指摘への対応

| # | 結果 | 内容 |
|---|---|---|
| C1 | 解消 | `onError` で `resetConnection()` を呼ぶ |
| C2 | 解消 | オフラインでも件数・不明を渡し、「通信状態が不安定です（未送信あり）」と出す。単体テストを足した |
| C3 | 見送りに納得 | 「不明」が残ることと、数える範囲（調理画面の操作だけ）を、data-access.md §6.2 に書いた。注文の確定はオンライン必須のため、数えなくても整合する |
| C4 | 解消 | `onRejected` を `try/catch` で囲み、結合テストを足した |
| C5 | 解消 | 判定のたびに `Date.now()` で今を求め、`clock` はタイマーでやり直すための依存だけにした |

dev の確認で出た変更（問題があるときだけ表示する、オンラインへの戻りを早くする）も、SPEC・DESIGN・screens・visual・data-access に反映されており、食い違いは無い。

### 新しい指摘

| # | 重大度 | 内容 |
|---|---|---|
| R1 | 🟡 低 | `online` イベントの `void reconnectNow()` が、`disableNetwork` の失敗で unhandled rejection になる |
| R2 | 🟡 低 | `online` イベントの処理（`fromCache` の数え直し、`reconnectNow` の呼び出し）に、テストが無い |
| R3 | ℹ️ | 購読のエラーのあと、接続状態は「オンライン」に戻り、バーには何も出ない |

#### R1 🟡 `reconnectNow` の失敗が拾われない

**場所**：`src/state/connection.ts`（`online` のリスナー）、`src/lib/data/online.ts`（`reconnectNow`）

**問題**：`reconnectNow` は、`disableNetwork` が失敗すると、`finally` で `enableNetwork` を行ったあと、その例外を投げ直す。呼び出し側は `void reconnectNow()` で、拾わない。C4 と同じ種類の問題。

**直し方の案**：呼び出し側を `reconnectNow().catch(() => {})`（または `console.error`）にする。

#### R2 🟡 `online` イベントの処理に、テストが無い

**問題**：`reconnectNow` 自体の結合テストはあるが、「`fromCacheSince` がある状態で `online` が来ると、数え直しが始まる」「`fromCacheSince` が無ければ何もしない」は、確かめていない。

**直し方の案**：偽のタイマーと `window.dispatchEvent(new Event('online'))` で、`connection` の移り変わりを確かめる（`reconnectNow` は差し替える）。

#### R3 ℹ️ 購読のエラーのあとの表示

**問題**：C1 の対応で、エラーのあと、`fromCacheSince` が消え、接続状態は「オンライン」（＝何も出さない）に戻る。ネットワークが落ちていても、バーには何も出ない。

**確認してほしいこと**：エラー自体は `activeOrdersError` で別に出しているはずなので、その画面で伝わるかを、devで一度確かめる。伝わらなければ、エラー用の状態を足す。
