# 注文確定フローの設計

最重要の処理。要件は [SPEC.md](../SPEC.md) の5章。データは [data-model.md](./data-model.md)。

## 1. 要件の再掲

- 通信がなければ確定させない。失敗した注文は、存在しなかったことになる
- 再試行しても二重登録にならない
- 8秒で応答がなければ「送れていません」。「もう一度試す」「やめる」を選べる
- 「送れていません」の後でも、実際には登録されていることがある → **再試行・やめるの前に、登録の有無を確認**する
- 「やめる」の後に、遅れて注文が登録されてはいけない
- 確認できないとき（通信がない）は、その旨を表示し、通信が戻ったときに確認する

## 2. 登場する値

| 値 | 内容 |
|---|---|
| `orderId` | 確定ボタンを押した時点で生成（`doc(collection(...)).id`）。**再試行で使い回す** |
| `day` | 確定ボタンを押した時点の `toDay(now)`。再試行でも変えない（日付をまたいだ再試行で、番号の日がずれないように） |
| `draft` | カートの内容（`items`、`total`、`payment`、`qr`）。確定ボタンの時点で固定する |
| `attempt` | 1回の試行。`{ aborted: boolean, startedAt }` を持つ |
| `pendingOrder` | `localStorage` の `hei:pending:{eventId}` に保存する。`{ orderId, day, draft, lastAttemptAt }` |

## 3. クライアントの状態遷移

```
          確定を押す
  idle ────────────────▶ submitting ──成功──▶ done（番号・QRを表示） ──閉じる──▶ idle
   ▲                        │  │
   │                        │  └─8秒で応答なし／失敗─▶ failed（「送れていません」）
   │                        │                              │         │
   │                        │                  もう一度試す│         │やめる
   │                        │                              ▼         ▼
   │                        │                          verifying ◀───┘
   │                        │                              │
   │                        │          登録あり ───────────┼─▶ done（成功扱い）
   │                        │          登録なし（再試行）──┼─▶ submitting（同じorderId）
   │                        │          登録なし（やめる）──┼─▶ idle（pendingOrder削除）
   │                        │          確認できない ───────┴─▶ unverifiable
   │                        │                                      │
   └────────────────────────┴──────────────◀──通信が戻り確認／閉じる┘
```

| 状態 | 画面 | カート |
|---|---|---|
| idle | 通常 | 編集可 |
| submitting | ボタンは「送信中」で無効 | 保持（編集不可） |
| failed | 「送れていません」＋理由（オフライン／タイムアウト／権限）＋「もう一度試す」「やめる」 | 保持 |
| verifying | 「確認中…」 | 保持 |
| unverifiable | 「確認できません。通信が戻ると、自動で確認します。調理タブで、番号を確認してください」＋「閉じる」 | 保持（閉じるまで） |
| done | 番号・QR（または合計・お釣り） | **空にする**。`pendingOrder` を削除 |

## 4. 処理

### 4.1 トランザクション
```ts
async function confirmOrder(ctx: ConfirmContext, attempt: { aborted: boolean }): Promise<Order> {
  const orderRef = doc(db, 'events', ctx.eventId, 'orders', ctx.orderId);
  const counterRef = doc(db, 'events', ctx.eventId, 'counters', ctx.day);
  return runTransaction(db, async (tx) => {
    if (attempt.aborted) throw new AbortedError();
    const existing = await tx.get(orderRef);
    if (existing.exists()) return toOrder(existing);          // 冪等：既にあれば、それを返す
    const counter = await tx.get(counterRef);
    if (attempt.aborted) throw new AbortedError();            // コミット直前の最終確認
    const number = (counter.exists() ? counter.data().n : 0) + 1;
    tx.set(counterRef, { n: number });
    tx.set(orderRef, buildNewOrder(ctx, number));             // qr なら preparing、なければ done
    return /* 作成する注文 */;
  });
}
```

### 4.2 タイムアウト
```ts
const attempt = { aborted: false, startedAt: Date.now() };
try {
  order = await withTimeout(confirmOrder(ctx, attempt), 8000);
} catch (e) {
  attempt.aborted = true;     // 以降、更新関数が再実行されても、コミットしない
  → failed
}
```
- `runTransaction` は、途中でキャンセルできない。`aborted` は、**これから始まる再実行を止める**ためのもの

### 4.3 確認（verifying）
**既に送信済みのコミットは止められない**ため、確認は、次の手順で行う。

1. 最後の試行の開始から **16秒経つまで待つ**（SDKのトランザクションは、15秒を超えて再試行しないため。この時点以降は、新しいコミットが始まらない）。待つ間は「確認中…」を表示する
2. `getDocFromServer(orderRef)` で確認する
   - 存在する → `done`（成功扱い。番号・QRを表示）
   - 存在しない → 再試行なら `submitting`、やめるなら `idle`（`pendingOrder` を削除）
   - 通信できない（`unavailable`）→ `unverifiable`
- ★16秒は、SDKの内部の挙動に依存した値。実機・Emulatorで、遅延・切断を作って確認する（「やめる」の後に、注文が現れないこと）

### 4.4 保留中の注文の復元
- アプリの起動時、通信が戻ったとき（`online` イベント）に、`pendingOrder` が残っていれば、`getDocFromServer` で確認する
  - 存在する → 「◯番の注文が登録されていました」と、品目と合計・QRを表示する（スタッフが、お客様に伝えられるように）。`pendingOrder` を削除
  - 存在しない（`lastAttemptAt` から16秒以上経過）→ `pendingOrder` を削除し、「前回の注文は登録されていませんでした」を表示する
- `submitting` / `failed` / `verifying` の最中にアプリが閉じられた場合も、同じ手順で復元する

## 5. 失敗の理由と文言

| 原因 | 判定 | 文言 |
|---|---|---|
| オフライン | `unavailable` / `navigator.onLine === false` | 通信できません。電波を確認してください |
| タイムアウト | 8秒で応答なし | 送れていません（通信が不安定です） |
| 権限 | `permission-denied` | 登録できません。イベントのメンバーか確認してください |
| 競合・内部エラー | `aborted` など | 送れていません。もう一度試してください |

## 6. 想定する状況の確認表

| 状況 | 期待する結果 |
|---|---|
| 通信なしで確定 | 確定されず、カートが残る（failed） |
| タイムアウト → 再試行 | 同じ `orderId`。二重にならない |
| タイムアウトしたが、サーバーでは成功していた | verifying で存在を確認 → 成功扱い |
| 「やめる」を押す → その後に、遅れて登録されそうな状況 | 16秒待って確認。登録されていれば成功扱い（やめない）、されていなければ破棄 |
| 確認中にオフラインになった | unverifiable → 復帰後に自動確認 |
| 確認前にアプリを閉じた | 次の起動時に、`pendingOrder` から復元 |
| 日付をまたぐ再試行 | `day` は最初のまま |
