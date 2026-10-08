# PR #53 のレビュー（調理しない商品の区別）

- 日付：2026-10-08
- 対象：[PR #53](https://github.com/yuuki-nishino/maido-ookini/pull/53)（#52。`firestore.rules`、`lib/domain/cooking.ts`・`order.ts`、`lib/data/menu.ts`・`orders.ts`・`types.ts`、`state/cart.ts`、`staff/menu/MenuPage.tsx`、`staff/order/OrderPage.tsx`、`staff/kitchen/OrderCard.tsx`、SPEC §6.1・§6.2・§6.5、design/ の各文書）
- 観点：正しさ（バグ）
- 重大度：🔴 高（SPEC違反・データ不整合・権限の漏れ）／🟠 中／🟡 低／ℹ️ 情報
- 確認したこと：コードの差分を読んだ。`firestore.rules` の注文の作成ルール（`items` の中身を検査しないこと）と、`cook` を書き写す箇所（カート・確定・読み戻し）を、PRのブランチのコードで確かめた。テストは動かしていない。実機は確かめていない（PR本文の「devで確認」も、このレビューの範囲外）

## 結論

**🔴・🟠の指摘は無い。** `cook` が無い（古い）商品・行を、調理ありとして扱う向きは、メニューの読み取り・ルール・カート・注文の読み戻しで揃っている。QRの自動判定も、`setLines` で要否が変わったときだけ手動の選択を捨てるので、筋が通っている。直したほうがよい点が1つ（C1）と、情報が3つ。

| # | 重大度 | 内容 |
|---|---|---|
| C1 | 🟡 低 | data-access.md の `OrderLine` の型に、`cook` が無い |
| C2 | ℹ️ 情報 | カートに入れたあとにメニューの調理の要否を変えても、カートの行は変わらない |
| C3 | ℹ️ 情報 | 「前回のQRの選択の記憶」の廃止で、毎回の手間が増える場合がある |
| C4 | ℹ️ 情報 | 調理の切替ボタンの `aria-pressed` が、ボタンの文言と逆の意味になる |

## 指摘

### C1 🟡 data-access.md の `OrderLine` に `cook` が無い

**場所**：`docs/design/data-access.md:29`（`interface OrderLine { menuId: string; name: string; price: number; qty: number }`）

**問題**：同じ文書の `MenuItem` には `cook: boolean` を足したが、`OrderLine` は直していない。実装（`src/lib/data/types.ts`）の `OrderLine` には `cook?: boolean` がある。data-model.md §2.6 には、書いてある。

**直し方の案**：`interface OrderLine { menuId: string; name: string; price: number; qty: number; cook?: boolean }` にする（「設計と食い違う実装は、同じPRで、設計書も直す」）。

## 情報

### C2 ℹ️ カートの行は、メニューの変更に追従しない

**場所**：`src/lib/domain/order.ts`（`lineNotice`・`applyCurrentPrice`）

**確認したこと**：カートの行は、入れた時点の `cook` を保持する（screens.md §3.4 の方針どおり）。ほかのメンバーが、メニューで「調理なし」へ切り替えても、すでにカートにある行は、調理ありのまま。`lineNotice`（価格の変更の通知）も、`cook` の違いは見ない。「現在の価格にする」を押したときだけ、`cartLineOf(m)` で `cook` も更新される。レジの途中の1件にしか効かず、確定後は書き写した値で固定されるので、実害は小さい。

### C3 ℹ️ QRの選択の記憶（`hei:qr`）の廃止

**場所**：`src/state/cart.ts`

**確認したこと**：以前は、QRをオフにすると、次の注文でもオフのままだった。今後は、調理ありの商品が入ると、毎回オンに戻る。調理画面を使わず、すべての注文をQRなしで渡している運用（小さな催しなど）では、1件ごとに手でオフにする手間が増える。PR本文に、意図的な廃止と書いてあるので、バグではない。実機で、手間として許せるかを見てほしい。`localStorage` に残る古い `hei:qr` は、読まれなくなるだけで、害は無い。

### C4 ℹ️ `aria-pressed` の意味

**場所**：`src/staff/menu/MenuPage.tsx`（調理の切替ボタン）

**確認したこと**：ボタンの文言は「調理あり」「調理なし」（いまの状態）で、`aria-pressed` は `!item.cook`（調理なしのときに「押されている」）。スクリーンリーダーでは、「調理の要否、押されている」と読まれ、どちらの状態か分かりにくい。「販売中／売り切れ」の切替ボタンと同じ作りなので、揃っているとも言える。気になるなら、`aria-label` に、いまの状態を入れる。

## 確認して問題なかった点

- **ルール**：`d.get('cook', true) is bool` で、`cook` が無い（古い）商品も通る。古い版の端末（Service Workerが古い版のまま）が、`cook` なしで書いても、拒否されない
- **注文の行**：ルールは `items` の中身を検査しないので、`cook: false` を足しても通る（data-model.md に明記あり）。`cook: false` のときだけ書くので、古い端末の読み戻しにも影響しない
- **QRの自動判定**：空のカートはオン、調理なしだけならオフ、調理ありが1つでもあればオン。`setLines` が、判定が変わったときだけ手動の選択を捨てるので、「食べ物を足したのにQRなしのまま」にならない。`clearCart` でも自動に戻る
- **QRなしの注文**：ルールが、QRなしを「確定と同時に渡し済み（`done`）」として許すので、調理なしだけの注文は、調理画面に出ない
- **まとめて追加**：すべて `cook: true`。書き込みの形が、ルールの `hasOnly` と合っている
- **テスト**：`defaultQr`・`needsCooking`、カートのQR、メニューの `cook` のルール、メニュー・注文の保存と読み戻しが、追加されている

## マージ前に

- `firestore.rules` を変えているので、CLAUDE.md の条件どおり、**devにルールもデプロイして**確認する（ルールはプロジェクト全体に効く）。PR本文の「devで確認」に、ルールのデプロイも含めること
- 実機で、C3（QRの手間）と、調理画面での「調理なし」の見え方を確かめる
