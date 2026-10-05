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

## 確認

- 単体テスト：171件（+6）。型・Lint は通過
