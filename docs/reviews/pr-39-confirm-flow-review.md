# PR #39 のレビュー（確定フロー）

- 日付：2026-10-05
- 対象：[PR #39](https://github.com/yuuki-nishino/maido-ookini/pull/39)（#13。`src/lib/domain/confirmFlow.ts`、`src/state/confirmRunner.ts`、`src/state/confirm.ts`、`src/lib/data/orders.ts`、`src/staff/order/ConfirmFlowDialog.tsx`、`src/staff/order/OrderPage.tsx`、テスト（`test/domain/confirmFlow.test.ts`、`src/state/confirmRunner.test.ts`、`test/data/orders.test.ts`）、設計書（DESIGN.md・order-confirm.md・data-access.md・security-rules.md・testing.md））。レビュー時の HEAD は `84a4f74`
- 観点：正しさ（バグ）、設計書との食い違い
- 重大度：🔴 高（SPEC違反・データ不整合・権限の漏れ）／🟠 中／🟡 低／ℹ️ 情報
- 確認したこと：CI は通っている。テストは、手元では動かしていない（CI の結果による）。下の指摘は、コードを読んで確かめた

## 結論

**🔴 の指摘は無い。C1・C3（🟠）は、この PR で直すことを勧める。** C2（🟡）も小さな直しなので、合わせて直すとよい。

- 3件とも同じ形の問題。確定フローのダイアログは閉じられず（Esc も効かない）、`unverifiable` の画面には「もう一度確認」しか無い。そのため、サーバーが答えられないと、注文画面から抜け出せない
- reducer の状態遷移、遅れて届いた結果を捨てる仕組み（`still`）、8秒の時間切れ（確定・やめる）に、ほかの問題は見つからなかった

| # | 重大度 | 内容 |
|---|---|---|
| C1 | 🟠 中 | やめた扱いと分かっているのに、「確定せずに戻る」で、サーバーにまた問い合わせる。回線が切れていると「確認できません」で止まる |
| C2 | 🟡 低 | `permission` で断られた後の墓標の確認に、8秒の時間切れが無い |
| C3 | 🟠 中 | メンバーでない、またはイベントが終わっているとき、「やめる」が必ず `unverifiable` になり、ダイアログから出られない |

## 指摘

### C1 🟠 「確定せずに戻る」で、サーバーにまた問い合わせる

**場所**：`src/staff/order/ConfirmFlowDialog.tsx:92`（「確定せずに戻る」のボタン）、`src/lib/domain/confirmFlow.ts:82`（`abandon`）

**問題**：
- `failed`（理由は `voided`）のとき、「確定せずに戻る」は `onAbandon` を呼ぶ。reducer は `abandoning` に進み、runner は `voidOrFind` をもう一度実行する
- この時点で、墓標があることは、もうサーバーで確かめてある（`voidExists` が true だったから `voided` になった）。問い合わせ直す必要は無い

**起こりうること**：やめた扱いと分かった直後に回線が切れ、スタッフが「確定せずに戻る」を押す。`voidOrFind` が失敗するか、8秒待って `unverifiable` になる。画面には「前の注文が登録されたか分かりません」と、事実と違う表示が出る。押せるのは「もう一度確認」だけで、回線が戻るまで注文画面が使えない。

**直し方の案**：
- `failed`（`voided`）からの「確定せずに戻る」は、サーバーに問い合わせず、そのまま `idle`（`notice: 'voided'`）に戻す。カートは残す。たとえば reducer に、`failed`（`voided`）→ `idle` のイベントを足す
- reducer の単体テストに、この遷移を足す。order-confirm.md の状態遷移も合わせる

### C2 🟡 `permission` の後の墓標の確認に、時間切れが無い

**場所**：`src/state/confirmRunner.ts:55`（`deps.voidExists`）

**問題**：
- 確定は `race(..., timeoutMs)` で8秒に制限しているが、`permission` で断られた後の `deps.voidExists()`（中身は `getDocFromServer`）は、制限なしで待つ
- `getDocFromServer` は、弱い回線では、すぐには失敗しないことがある

**起こりうること**：7秒で `permission` で断られ、そのあと `voidExists` が止まる。8秒を過ぎても `submitting`（読み込み中）のまま。設計の「8秒で failed にする」が、この道筋では守られない。

**直し方の案**：
- `voidExists` も `race` で包む。残りの時間（確定を始めてから8秒まで）で包むのが設計に合う。時間切れなら `permission` の扱いにする（いまの `.catch(() => false)` と同じ）
- `confirmRunner.test.ts` に、偽のタイマーで「`voidExists` が終わらない → 8秒で `failed`」を足す

### C3 🟠 メンバーでない・イベントが終わっているとき、ダイアログから出られない

**場所**：`src/state/confirmRunner.ts:63`（`runAbandon`）、`src/lib/data/orders.ts:148`（`voidOrFind` の `catch`）

**問題**：
- 営業中にイベントを終了した場合や、メンバーから外された場合（`isActiveEvent` が false など）、確定は `permission` で失敗する
- 「やめる」を押すと、`voidOrFind` の墓標の作成もルールに断られる。代わりの `getDocFromServer(orderRef)` は注文を見つけられず（読めない、または無い）、エラーを投げ直す
- `runAbandon` は、どの失敗も `unverifiable` にするので、`permission` も「通信できない」と同じ扱いになる

**起こりうること**：「もう一度確認」は毎回 `permission` で失敗し、`unverifiable` に戻る。画面には「通信できないため」と、事実と違う理由が出る。再読み込みするまで、注文画面が使えない。

**直し方の案**：
- `runAbandon` で、`permission` を「通信できない」と分ける。注文は登録されていない（確定も断られている）ので、「登録されていません」と知らせて `idle` に戻す。たとえば reducer に、`abandoning` → `idle`（新しい notice）のイベントを足す
- `confirmRunner.test.ts` に「`voidOrFind` が `permission` で失敗 → `idle`」を足す。order-confirm.md §6 の失敗の扱いも合わせる

## 再レビュー（対応の確認）

- 日付：2026-10-05
- 対象：`1769f07`（fix: PR #39 のレビュー（C1〜C3）に対応）。CI は通っている

### 結論

**C1〜C3 は解決した。** 新しい指摘は、🟡 が1件（R1）と、ℹ️ が1件（R2）。どちらも小さな直しで、マージを止めるものではない。R1 は、この PR で直すことを勧める。

| # | 結果 | 内容 |
|---|---|---|
| C1 | ✅ 解決 | reducer の `dismiss`（`failed`・`voided` → `idle`）を「確定せずに戻る」が使う。`failed`・`voided` からの `abandon` は受け付けない。`voidOrFind` を呼ばないことを、runner のテストで確かめている |
| C2 | ✅ 解決 | `voidExists` を、確定を始めてから8秒までの残りの時間で打ち切る。時間切れ・失敗を、案の `permission` ではなく `timeout` にしたのは、より良い（墓標の有無が分からないのに「権限がありません」と言い切らず、同じ `orderId` の「もう一度試す」「やめる」で、安全に確かめられる）。偽のタイマーで、7.999秒は `submitting`・8秒で `failed` を確かめている |
| C3 | ✅ 解決（R1 あり） | `runAbandon` で `permission` を `blocked`（`idle`＋知らせ）に分けた。カートは残り、ダイアログから抜けられる |
| R1 | 🟡 低 | `voidOrFind` の代わりの読み取りが失敗したときも `permission` になり、`blocked`（「前の注文は、登録されていません」）と言い切ってしまう |
| R2 | ℹ️ 情報 | 「確定も断られているので、登録されていない」という理由づけが正しくない（もとのレビューの案の書き方の誤り） |

### R1 🟡 代わりの読み取りが失敗しても、「登録されていません」と言い切る

**場所**：`src/lib/data/orders.ts:151`（`getDocFromServer(orderRef).catch(() => null)`）、`src/state/confirmRunner.ts:77`

**問題**：
- `voidOrFind` は、トランザクションが `permission` で断られたとき、`getDocFromServer(orderRef)` で注文を探す。この読み取りが**失敗**しても `null` にして、もとの `permission` を投げ直す
- C3 の対応で、`permission` は `blocked`（「前の注文は、登録されていません」）と言い切るようになった。そのため、「注文が無いと確かめた」と「確かめられなかった」が、同じ表示になる

**起こりうること**：確定が時間切れ（`timeout`）になる。裏でトランザクションは登録まで進んでいた。そのあとメンバーから外され、「やめる」を押す。トランザクションは `permission`、直後の読み取りは回線が切れて失敗。画面は「前の注文は、登録されていません」と出るが、実際には登録されている。（起きる幅は狭い）

**直し方の案**：
- 代わりの読み取りが失敗したときは、`permission` ではなく、その失敗（`offline` など）を投げる。runner はそれを `unverifiable` にする。たとえば `.catch(() => null)` をやめ、`catch` の中で `toAppError` して投げる
- 結合テスト（`test/data/orders.test.ts`）か runner のテストで、「代わりの読み取りの失敗 → `unverifiable`」を確かめる

### R2 ℹ️ 「登録されていない」の理由づけ

**場所**：`src/lib/domain/confirmFlow.ts`（`blocked` のコメント）、`src/state/confirmRunner.ts:75`、order-confirm.md §4

**問題**：
- 「確定も断られているので、注文は登録されていない」と書いているが、「やめる」は `permission` 以外の失敗（`timeout`・`offline`・`conflict`）からも押せる。時間切れのときは、登録されていることがある
- 正しい根拠は、「注文は誰でも1件読める（`orders` の `get: if true`）ので、`voidOrFind` の代わりの読み取りで、サーバーに注文が無いことを確かめた」こと。もとのレビュー（C3 の直し方の案）の書き方が誤っていた

**直し方の案**：コメントと order-confirm.md §4 の理由を、上の根拠に書き換える（R1 を直すと、この根拠が成り立つ）。
