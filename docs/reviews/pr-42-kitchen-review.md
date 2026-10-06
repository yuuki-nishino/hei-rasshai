# PR #42 のレビュー（調理画面）

- 日付：2026-10-06
- 対象：[PR #42](https://github.com/yuuki-nishino/maido-ookini/pull/42)（#15。`src/staff/kitchen/KitchenPage.tsx`、`OrderCard.tsx`、`QrDialog.tsx`、`src/state/orders.ts`、`src/lib/data/orders.ts`、`src/lib/domain/orderStatus.ts` ほか）。レビュー時の HEAD は `aa1bf0b`
- 観点：正しさ（バグ）
- 重大度：🔴 高（SPEC違反・データ不整合・権限の漏れ）／🟠 中／🟡 低／ℹ️ 情報
- 確認したこと：差分を読んだ。CSS・ドキュメント・テストのファイルは、読んでいない。テストは、手元では動かしていない。下の指摘は、コードを読んで確かめた（行番号は、レビュー時のおおよその位置）

## 結論

**🔴 の指摘は無い。M1（🟠）は、マージの前に直すことを勧める。** M2・M3（🟡）は、直さなくてもよい。

| # | 重大度 | 内容 |
|---|---|---|
| M1 | 🟠 中 | 取り消しの確認が、ダイアログを開いた時点の古い注文を使い、`cancelledFrom` を古い状態から作る |
| M2 | 🟡 低 | 「済みも表示」の読み込みエラーが、`permission` 以外では表示されず、「読み込み中…」が出続ける |
| M3 | 🟡 低 | 日付が変わると、購読が張り直され、済みの一覧が一瞬「読み込み中」に戻る |

## 指摘

### M1 🟠 取り消しの確認が、古い注文のコピーを使う

**場所**：`src/staff/kitchen/KitchenPage.tsx:~139`（取り消しの確認ダイアログの `onConfirm`）

**問題**：
- 確認ダイアログは、開いた時点の注文のコピー（`cancelling`）を持つ
- `onConfirm` は、そのコピーを `transitionOrder(..., 'cancel')` に渡す。`cancelledFrom` も、コピーの古い `status` から作られる

**起こりうること**：
1. スタッフ A が、「呼び出し中」（`ready`）の注文で、取り消しのダイアログを開く
2. 開いている間に、スタッフ B が、その注文を「渡した」（`done`）にする
3. A が確認を押すと、取り消しが `cancelledFrom: 'ready'` で書き込まれる
4. ルールが、現在の状態と照合するなら、書き込みは拒否される。照合しないなら、あとで元に戻したときに、誤った状態（`ready`）に戻る

**直し方の案**：
- ダイアログには、注文の id だけを持たせる（`useState<string | null>`）
- 確認の時点で、`activeOrders` / `dayOrders` から、最新の注文を引く。見つからない、または、すでに取り消し・済みになっているときは、書き込まずに閉じて、知らせる
- 単体テスト、または画面のテストで、「開いている間に状態が変わる」を確かめる。ルールが `cancelledFrom` を照合するかも、security-rules.md と合わせて確認する

### M2 🟡 「済みも表示」の読み込みエラーが、表示されない

**場所**：`src/staff/kitchen/KitchenPage.tsx:~44-52`（`watchOrdersOfDay` のエラー処理）

**問題**：
- エラー処理が、`permission` だけを扱う
- それ以外のエラーでは、`dayOrders` が `null` のままになり、「読み込み中…」が出続ける
- 進行中の一覧には `activeOrdersError` があるが、済みの一覧には、同じものが無い

**直し方の案**：`dayOrdersError` を足し、`permission` 以外も、メッセージを出す（できれば、やり直しの手段も）。

### M3 🟡 日付が変わると、一覧が一瞬「読み込み中」に戻る

**場所**：`src/staff/kitchen/KitchenPage.tsx:~44`（副作用の依存に `today`）

**問題**：
- 副作用が、1分ごとの時計から来る `today` に依存する。0時に、購読が張り直される
- 張り直しの間、前の日の `dayOrders` が残り、そのあと「読み込み中」に戻る

見た目だけの問題。直すなら、`today` が変わった時点で `dayOrders` を `null` にしてから購読する。
