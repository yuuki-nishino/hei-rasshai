# 注文確定フローの設計

最重要の処理。要件は [SPEC.md](../SPEC.md) の5章。データは [data-model.md](./data-model.md)、ルールは [security-rules.md](./security-rules.md)。
判断の経緯は [ADR-0004](../adr/0004-void-tombstone.md)。

## 1. 要件の再掲

- 通信がなければ確定させない。失敗した注文は、存在しなかったことになる
- 再試行しても二重登録にならない
- 8秒で応答がなければ「送れていません」。「もう一度試す」「やめる」を選べる
- 「送れていません」の後でも、実際には登録されていることがある → **再試行・やめるの前に、登録の有無を確認**する
- 「やめる」の後に、遅れて注文が登録されてはいけない
- 確認できないとき（通信がない）は、その旨を表示し、通信が戻ったときに確認する

## 2. 方針：時間ではなく、データの原子性で守る

「やめる」を選んだ後に、すでに送信済みのコミットが、遅れてサーバーに届くことがある。**待ち時間で防ぐ方法は、SDKの内部の挙動と、電波の状況に依存する**ため、採らない。

- 「やめる」は、**墓標（`voids/{orderId}`）を作る**ことで行う。墓標がある注文IDは、ルールが、注文の作成を拒否する
- 墓標の作成は、その注文が**まだ存在しないことを確認**してから行う（トランザクション＋ルール）。どちらが先にコミットしても、片方だけが成功する
- 再試行は、**同じ `orderId` で、すぐに**行ってよい。確定のトランザクションは、注文が既にあれば、それを返す（冪等）。これが「再試行の前の確認」を兼ねる

## 3. 登場する値

| 値 | 内容 |
|---|---|
| `orderId` | 確定ボタンを押した時点で生成（`doc(collection(...)).id`）。**再試行で使い回す** |
| `day` | 確定ボタンを押した時点の `toDay(now)`。再試行でも変えない |
| `draft` | カートの内容（`items`、`total`、`payment`、`qr`）。確定ボタンの時点で固定する |
| `pending` | `localStorage` の `hei:pending:{eventId}` に保存する。`{ orderId, day, draft, abandoning }`。**トランザクションを始める前に保存する**。`abandoning` は、「やめる」を選んだときに、**`voidOrFind` を始める前に** `true` にして保存する |

- `pending` は、イベントにつき**1件だけ**。**`pending` がある間は、新しい注文を確定できない**（確定ボタンを無効にし、「前の注文の確認中です」を表示する）
- 解決（成功・破棄）したときに、削除する

## 4. クライアントの状態遷移

```
                   確定を押す（pendingを保存）
       idle ───────────────────────────────▶ submitting ──成功──▶ done
        ▲                                       │
        │                                       └─8秒／失敗─▶ failed
        │                                                      │      │
        │                                       もう一度試す   │      │ やめる
        │                                    （同じorderId）   ▼      ▼
        │                                       submitting ◀───┘   abandoning（void-or-find）
        │                                                             │
        │       found（登録されていた）─────────────────────────────▶ done（成功扱い）
        │       voided（墓標を作った）─── pendingを削除 ──────────────▶ idle
        │       通信できない ─────────────────────────────────────────▶ unverifiable
        │                                                             │
        └──────◀── 自動で再確認（§5.4） → void-or-find ────────────────┘

  起動時／通信復帰時に pending が残っている場合：
       find（注文と墓標を getDocFromServer）──注文あり──▶ done（「◯番が登録されていました」）
                                          └─墓標あり──▶ idle（「やめた注文として扱いました」。pendingを削除）
                                          └─どちらも無し▶ decide（draftを表示：「もう一度確定する」「やめる」）
                                          └─確認できない▶ unverifiable
```

| 状態 | 画面 | カート |
|---|---|---|
| idle | 通常 | 編集可 |
| submitting | ボタンは「送信中」で無効 | 保持（編集不可） |
| failed | 「送れていません」＋理由＋「もう一度試す」「やめる」 | 保持 |
| abandoning | 「やめる処理中…」 | 保持 |
| unverifiable | 「確認できません。自動で確認し直します」＋「もう一度確認」ボタン。確定ボタンは無効 | 保持 |
| decide | 「前の注文は登録されていません」＋品目と合計＋「もう一度確定する」「やめる」。`pending.day` が今日と違うときは、「前の日の注文です。やめることをおすすめします」を添え、「やめる」を主にする（「もう一度確定する」は、前日の `day`・番号で登録されるため） | `draft` を表示 |
| done | 番号・QR（または合計・お釣り） | **空にする**。`pending` を削除 |

- #13 で足した遷移（[PR #39 のレビュー](../reviews/pr-39-confirm-flow-review.md)）：
  - `failed`（理由が「やめた注文」＝墓標あり）の「確定せずに戻る」は、**サーバーに問い合わせず** `idle`（「やめた扱いにしました」の知らせ）に戻す。墓標は確かめ済みのため。カートは残す（C1）
  - `abandoning` で、`voidOrFind` が**権限で断られた**（メンバーでない・イベントの削除中）ときは、`unverifiable` ではなく、`idle`（「このイベントでは、いま注文を登録できません」の知らせ）に戻す。通信の問題ではなく、何度確かめても抜けられないため。注文が登録されていないと言える根拠は、**注文は誰でも1件読める（ルールの `orders` の `get: if true`）ので、`voidOrFind` が、墓標を作れなかった後に、サーバーで注文が無いことを確かめている**こと。その確認自体が失敗したときは、`permission` ではなく、その失敗（`offline` など）を投げ、`unverifiable` にする（C3、再レビュー R1・R2）

- 状態遷移は、**純粋な関数（reducer）**として実装する（`lib/domain/confirmFlow.ts`）。副作用（Firestore・タイマー・`localStorage`）は、外側で行う。これにより、偽のタイマーでテストできる
  - #13 の実装：reducer（`confirmReducer`）、動かす部分（`state/confirmRunner.ts`。データアクセスの関数を受け取り、8秒の時間切れと、遅れて届いた結果の無視を受け持つ。偽のタイマーで単体テスト）、画面とのつなぎ（`state/confirm.ts`）、画面（`staff/order/ConfirmFlowDialog.tsx`。idle 以外の間は画面全体に重ね、カートを触れないようにする。結果の画面だけ閉じられる）
  - **#13 では、`pending` を端末に保存しない**（保存・起動時の復元・15秒ごとの自動の再確認・接続の回復での再確認は #14）。そのため、#13 の時点では、確定の途中で再読み込みすると、確認できない注文が残りうる。`unverifiable` からは、「もう一度確認」（手動）だけで抜ける

## 5. 処理

### 5.1 確定（トランザクション）
```ts
async function confirmOrder(ctx: ConfirmContext): Promise<Order> {
  const orderRef = doc(db, 'events', ctx.eventId, 'orders', ctx.orderId);
  const counterRef = doc(db, 'events', ctx.eventId, 'counters', ctx.day);
  return runTransaction(db, async (tx) => {
    const existing = await tx.get(orderRef);
    if (existing.exists()) return toOrder(existing);            // 冪等：既にあれば、それを返す
    const counter = await tx.get(counterRef);
    const number = (counter.exists() ? counter.data().n : 0) + 1;
    tx.set(counterRef, { n: number });                          // 初回は n=1 の作成、2回目以降は +1 の更新
    tx.set(orderRef, buildNewOrder(ctx, number));               // qr なら preparing、なければ done
    return /* 作成する注文 */;
  });
}
```
- **同時の確定**（#13 で、Emulator の並行テストで分かった）：2台が、同じ日のカウンターを同時に進めると、サーバーは、後のコミットを「やり直し（`aborted`）」ではなく、**ルールの拒否（`permission-denied`）**として返す（ルールは、コミットの時点のカウンターで評価されるため、`n == number - 1` が成り立たない）。SDK の自動のやり直しは働かないため、`confirmOrder` は、`permission` のときに、**墓標が無いことを確かめてから、同じ `orderId` で最大5回やり直す**（少し待つ時間をずらす。同じ `orderId` なので二重にならない）。墓標があれば、やり直さず `permission` を返す（下の「墓標がある」の経路）。番号の重複は、ルールが防いでいるため、起こらない
- 確定できたときは、トランザクションで決まった番号から、注文を組み立てて返す（読み直さない。確定の直後に通信が切れても、成功を失敗と取り違えないため）
- 8秒で応答がなければ、`failed`（`Promise.race`）。トランザクションは、キャンセルできないため、**裏で続く**。それでよい（登録されても、`orderId` が同じなので、再試行・確認で見つかる。「やめる」なら、墓標との競合で、ルールが片方だけを通す）
- 墓標がある `orderId` で、遅れて確定のコミットが届くと、ルールが拒否する（`permission-denied`）。画面が `submitting` / `failed` のときに、この拒否を受けたら、**墓標の有無を `getDocFromServer` で確かめる**。墓標があれば「やめた注文です」として `pending` を削除し、`idle` に戻る。なければ、§6 の「権限」の文言を出す（メンバーでない場合）
  - 墓標があった場合、`abandoning` の先行保存により、通常は通らない経路（防御のための処理）。通ったときは、`pending` の**`draft` を残したまま**、「この注文はやめた扱いです」と表示し、スタッフが選べば、**新しい `orderId` で、確定し直せる**（品目を、入力し直さずに済ませる）。古い `pending` は、新しい `orderId` で置き換える

### 5.2 やめる（void-or-find）
```ts
async function voidOrFind(ctx): Promise<{ result: 'found'; order: Order } | { result: 'voided' }> {
  const orderRef = doc(db, 'events', ctx.eventId, 'orders', ctx.orderId);
  const voidRef = doc(db, 'events', ctx.eventId, 'voids', ctx.orderId);
  try {
    return await runTransaction(db, async (tx) => {
      const o = await tx.get(orderRef);
      if (o.exists()) return { result: 'found', order: toOrder(o) };   // 登録されていた → 成功扱い
      const v = await tx.get(voidRef);
      if (!v.exists()) tx.set(voidRef, { createdBy: ctx.uid, createdAt: serverTimestamp() });
      return { result: 'voided' };
    });
  } catch (e) {
    // 競合：直前に、注文が登録された（ルールが、墓標の作成を拒否）
    if (isPermissionDenied(e)) {
      const o = await getDocFromServer(orderRef);
      if (o.exists()) return { result: 'found', order: toOrder(o) };
    }
    throw e;
  }
}
```
- `found`：成功として、番号とQRを表示する（やめない）
- `voided`：`pending` を削除して、`idle` に戻る。以後、この `orderId` で、注文が登録されることはない
- 通信できない／8秒で応答がない：`unverifiable`（`abandoning` は、開始前に保存済み）。遅れて墓標が書かれても、意図した結果なので問題ない
- `voidOrFind` の開始前に `abandoning = true` を保存するので、墓標が書かれた直後にアプリが落ちても、復元時に、やめる処理の続き（§5.3 の 1）になる

### 5.3 起動時・通信復帰時の確認（`resolvePending`）
- `pending` が残っていれば、実行する
  1. `pending.abandoning` が `true` → `voidOrFind` を実行（`found` → `done`、`voided` → 削除して `idle`）
  2. そうでなければ、注文と墓標を `getDocFromServer` で確認（`find`）
     - 注文あり → 「◯番の注文が登録されていました」を、品目・合計・QRつきで表示。`pending` を削除
     - 墓標あり（注文なし）→ 「やめた」として扱い、`pending` を削除して `idle`
     - どちらも無し → `decide`（品目と合計を表示。**入力し直せる**）。「もう一度確定する」→ `submitting`（同じ `orderId`）、「やめる」→ `abandoning`
     - 通信できない → `unverifiable`

### 5.4 「確認できない」からの復帰
電波が弱いだけのときは、`navigator.onLine` が `true` のままで、`online` イベントが発火しない。そのため、次のすべてを、`resolvePending` の起動のきっかけにする。

- 起動時
- `online` イベント
- 接続状態（`connectionStatus`）が、オンラインに戻ったとき（`fromCache` の解消）
- `unverifiable` の間、**15秒ごと**の自動再試行
- 「もう一度確認」ボタン（手動）

`resolvePending` は、同時に1つだけ動かす。8秒のタイムアウトは `Promise.race` なので、**裏のトランザクションは続く**。そのため、「実行中」とは、タイムアウトまでではなく、**裏のトランザクションが終わる（成功・失敗）まで**とする。その間は、次のきっかけ（15秒ごと・接続の回復）を無視する。手動の「もう一度確認」を押したときは、「確認中です」と表示する

- `decide` で待たせている間に、前の確定の遅れたコミットが届くこともあるが、同じ `orderId` なので、「もう一度確定する」を押せば、冪等に、既存の注文が返る

## 6. 失敗の理由と文言

| 原因 | 判定 | 文言 |
|---|---|---|
| オフライン | `unavailable` / `navigator.onLine === false` | 通信できません。電波を確認してください |
| タイムアウト | 8秒で応答なし | 送れていません（通信が不安定です） |
| 権限 | `permission-denied`（墓標が無い。やり直しても拒否された） | 登録できません。イベントのメンバーか確認してください |
| やめた注文 | `permission-denied` で、墓標がある | この注文は、やめた扱いです（「新しい番号で確定し直す」「確定せずに戻る」） |
| 墓標を確かめられない | `permission-denied` の後の墓標の確認が、失敗する・確定を始めてから8秒を過ぎる | 「送れていません」と同じ扱い（登録されたか分からないため、「もう一度試す」「やめる」で確かめる。レビュー C2） |
| やめる処理が権限で断られた | `voidOrFind` が `permission-denied` | このイベントでは、いま注文を登録できません（メンバーでなくなったか、イベントの削除中です）。前の注文は、登録されていません |
| 競合・内部エラー | `aborted` など | 送れていません。もう一度試してください |

## 7. 想定する状況の確認表

| 状況 | 期待する結果 |
|---|---|
| 通信なしで確定 | 確定されず、カートが残る（failed） |
| タイムアウト → 再試行 | 同じ `orderId`。二重にならない（トランザクションが、既存の注文を返す） |
| タイムアウトしたが、サーバーでは成功していた | 再試行／やめるで、存在を確認 → 成功扱い |
| 「やめる」→ その後に、遅れた確定のコミットが届く | 墓標があるため、ルールが拒否。注文は現れない |
| 遅れた確定のコミットが、「やめる」より先に届く | 墓標の作成が拒否され、`found` として、成功扱い（やめない） |
| 「やめる」の最中にオフラインになった | unverifiable → 復帰後に、自動で void-or-find |
| 確認前にアプリを閉じた | 次の起動時に、`pending` から復元（`resolvePending`） |
| 「やめる」の墓標が届いた直後にアプリが落ちた | `abandoning = true` が保存済みなので、復元時に void-or-find（墓標があれば `voided`）。仮に `abandoning` が無くても、`find` が墓標を見つけて「やめた」と扱う |
| 電波が弱いまま `unverifiable` になった | `online` が発火しなくても、15秒ごとの自動再試行と「もう一度確認」で抜けられる |
| `pending` の日付が、今日と違う | `decide` で、「やめる」をすすめる |
| unverifiable の間に、次の注文を確定しようとした | 確定ボタンが無効（前の注文の確認中） |
| 日付をまたぐ再試行 | `day` は最初のまま |
