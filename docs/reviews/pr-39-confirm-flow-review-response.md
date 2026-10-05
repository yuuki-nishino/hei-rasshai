# PR #39 のレビューへの対応

[PR #39 のレビュー](./pr-39-confirm-flow-review.md) の各指摘について、反映するもの・見送るものを、理由とともに整理する。

- 日付：2026-10-05
- 判断：**採用**＝指摘どおり反映／**修正して採用**＝方針は採用し、やり方を変えた／**対応不要**＝すでに満たしている／**見送り**＝反映しない
- 反映先の略称：OC＝`design/order-confirm.md`、T＝テスト
- すべて、PR #39 の中で反映した

| # | 判断 | 内容と理由 | 反映先 |
|---|---|---|---|
| C1 | **採用** | reducer に `dismiss`（`failed`・`voided` → `idle`（notice: voided））を足し、「確定せずに戻る」は、これを使う（`voidOrFind` を呼ばない）。`failed`・`voided` からの `abandon` は、受け付けない（状態を変えない）。ほかの理由の `failed` は `dismiss` できない（登録されたか分からないため） | `lib/domain/confirmFlow.ts`、`state/confirmRunner.ts`・`confirm.ts`、`staff/order/ConfirmFlowDialog.tsx`・`OrderPage.tsx`、OC §4、T（reducer +1、runner +1） |
| C2 | **修正して採用** | `permission` の後の `voidExists` も、確定を始めてから8秒までの残りの時間で打ち切る。ただし、時間切れ・失敗のときは、レビューの案の `permission` ではなく **`timeout`** にした。墓標の有無が分からない（＝登録されたか分からない）ため、「権限がありません」と言い切らず、「もう一度試す」「やめる」で確かめられるようにする（どちらも、同じ `orderId` で安全に確かめられる） | `state/confirmRunner.ts`、OC §6、T（runner +2：8秒で打ち切る・確認の失敗） |
| C3 | **採用** | reducer に `blocked`（`abandoning` → `idle`（notice: blocked））を足し、`runAbandon` で `permission` を、通信の失敗（`unverifiable`）と分けた。画面は「このイベントでは、いま注文を登録できません（メンバーでなくなったか、イベントの削除中です）。前の注文は、登録されていません」を出し、カートは残す | `lib/domain/confirmFlow.ts`、`state/confirmRunner.ts`、`staff/order/OrderPage.tsx`、OC §4・§6、T（reducer +1、runner +1） |
| R1（再レビュー） | **採用** | `voidOrFind` で、墓標の作成が `permission` で断られた後の、注文の読み取り（`getDocFromServer`）が失敗したときは、`null` にせず、その失敗（`offline` など）を投げる。runner は、それを `unverifiable` にする。`permission` を投げるのは、サーバーで注文が無いと確かめたときだけ。結合テストに、メンバーでない人の `voidOrFind`（注文なし → permission、注文あり → found）を足した。読み取りの失敗そのものは、結合テストで作りにくいため、runner の既存のテスト（`voidOrFind` の失敗 → `unverifiable`）で受ける | `lib/data/orders.ts`、`state/confirmRunner.ts`（コメント）、OC §4、T（結合 +2） |
| R2（再レビュー） | **採用** | 「登録されていない」の根拠を、「注文は誰でも1件読める（`get: if true`）ので、`voidOrFind` がサーバーで注文が無いと確かめた」に書き換えた | `lib/domain/confirmFlow.ts`・`state/confirmRunner.ts`・`lib/data/orders.ts`（コメント）、OC §4 |
| （実機確認） | **採用** | 「1番」の「番」が潰れる：番号の縁取りの太さ（親の em）が、小さな「番」にも引き継がれていた。「番」を 24px → 32px にし、縁取りを「番」自身の大きさに合わせた | `staff/order/ConfirmFlowDialog.module.css` |

## 確認

- 単体テスト：171件（+6）。結合テスト：55件（再レビューで +2）。型・Lint は通過
