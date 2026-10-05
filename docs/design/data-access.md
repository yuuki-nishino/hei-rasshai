# データアクセス設計（API設計）

サーバー（自前のAPI）は持たない。クライアントが Firestore と Firebase Authentication に、直接アクセスする。
そのため「API設計」は、**アプリ内のデータアクセス層（`src/lib/data/`）の関数の契約**として定める。
データの定義は [data-model.md](./data-model.md)、確定フローは [order-confirm.md](./order-confirm.md)。

## 1. 原則

- 画面（UI）は、Firestore を直接呼ばない。必ず `lib/data/*` の関数を通す
- 関数は、型付きの入出力にする。Firestore の型（`DocumentSnapshot` など）を、UI に漏らさない
- 購読（`watch*`）は、`Unsubscribe`（`() => void`）を返す。画面が閉じるとき、必ず解除する
- 失敗は、`AppError`（下記）に変換して投げる。UI は、`code` で表示を分ける
- 日付・集計・遷移・CSV・パースなどの計算は、`lib/domain/*` の**純粋関数**にする（Firebaseを import しない）
- **スタッフ用とお客様用で、初期化とデータアクセスのファイルを分ける**（お客様用のバンドルに、`firebase/auth` やスタッフ用の関数を含めないため）
  - スタッフ用：`lib/firebase/staff.ts`（Auth・永続キャッシュつきFirestore）、`lib/data/*`
  - お客様用：`lib/firebase/customer.ts`（Firestoreのみ。メモリキャッシュ）、`lib/data/customerOrder.ts`（`watchOrder` だけ）

## 2. 型

```ts
type Day = string; // 'YYYY-MM-DD'
type Payment = 'cash' | 'paypay';
type OrderStatus = 'preparing' | 'ready' | 'done' | 'cancelled';

interface EventDoc { id: string; name: string; startDate: Day; endDate: Day; floatCash: number; ownerUid: string; deleting: boolean }
interface Member { uid: string; role: 'owner' | 'member'; displayName: string; email: string }
interface Invite { email: string; createdAt: Date | null; expiresAt: Date | null } // expiresAt = createdAt + 1日（画面表示用に計算）
interface MenuItem { id: string; name: string; price: number; order: number; soldOut: boolean }
interface OrderLine { menuId: string; name: string; price: number; qty: number }
interface Order {
  id: string; number: number; day: Day; items: OrderLine[]; total: number;
  payment: Payment; status: OrderStatus; cancelledFrom: Exclude<OrderStatus, 'cancelled'> | null;
  qr: boolean; createdAt: Date | null; readyAt: Date | null; doneAt: Date | null; cancelledAt: Date | null;
  createdBy: string; updatedBy: string; updatedAt: Date | null;
  pending: boolean; // metadata.hasPendingWrites（この注文に、未送信の書き込みがある）
}
interface Closing { day: Day; floatCash: number; expectedCash: number; actualCash: number; diff: number; note: string; closedAt: Date | null; closedBy: string }
type Unsubscribe = () => void;
```
- `createdAt` などは、書き込み直後（サーバー時刻の確定前）に `null` になり得る

## 3. モジュールと関数

### 3.1 auth.ts
| 関数 | 内容 |
|---|---|
| `onAuthChange(cb: (user: AuthUser \| null) => void): Unsubscribe` | ログイン状態の購読。`AuthUser` は `{ uid, email, displayName }`（Firebase の `User` 型を UI に漏らさない） |
| `signInWithGoogle(): Promise<'signed-in' \| 'cancelled'>` | Googleログイン（ポップアップ。★U1、DESIGN.md §6）。`prompt: 'select_account'` を指定する（別のアカウントを選べるように）。本人がポップアップを閉じたときは `'cancelled'`。通信エラーは `AppError('offline')`、ポップアップがブラウザに止められたときは `AppError('popup-blocked')` |
| `signOut(): Promise<void>` | §8 の端末のキャッシュ消去を伴う |

### 3.2 events.ts
| 関数 | 内容 |
|---|---|
| `watchMyEvents(uid, cb: (events: EventDoc[], meta: { fromCache: boolean; memberOf: string[] }) => void, onError): Unsubscribe` | `members` のコレクショングループ（`uid` 一致）を購読し、親のイベントを `getDoc`（**キャッシュも使う**）で取得して一覧にする（開始日の新しい順）。オフラインで起動しても、キャッシュにあるイベントを表示できる（SPEC 7.3）。**孤立の掃除の判定にだけ**、`getDocFromServer` を使う（下記）。`fromCache`：サーバーで確かめていない一覧（0件のとき、画面は「イベントがありません」と言い切らない。#7）。`memberOf`：自分の `members` があるイベントのID（表示できないものも含む。選んでいるイベントから外れたかの判定に使う。PR #32 のレビュー E1）。親のイベントは1回だけ取るため、イベントの変更（名前・削除中）は、購読し直すまで反映されない。画面は、一覧に戻るたびに購読し直す（screens.md §3.2） |
| `createEvent(input, user): Promise<string>` | **オンライン必須**（[§3.9](#39-オンライン必須の書き込み)）。イベント（`deleting = false`）＋オーナーの `members` を、1バッチで作成。`eventId` を返す。`displayName` は §3.9 の規則 |
| `updateEvent(eventId, patch): Promise<void>` | 名前・日付・準備金 |
| `deleteEventDeep(eventId, onProgress): Promise<void>` | **オンライン必須**。配下を削除（[§7](#7-イベント削除)） |
| `joinEvent(eventId, user): Promise<'joined' \| 'already'>` | **オンライン必須**。すでにメンバーなら何もしない（`'already'`）。そうでなければ、メンバー作成＋招待の削除（1バッチ）。最初の確認は、`members/{uid}` の `getDocFromServer`（`permission-denied` は「メンバーではない」と判断する。この取得がオンラインの確認を兼ね、8秒で応答がなければ `offline`）。招待が無い・期限切れ・別のアカウント・削除中のイベントは、`permission`。`displayName` は §3.9 の規則 |

**`watchMyEvents` の孤立の掃除（自分の `members` の削除）の条件**（判定は `lib/data/myEvents.ts` の `resolveMyEvents`。Firestore に依存させず、単体テストで全分岐を確かめる。#7）
- 一覧の表示（キャッシュ可）と、削除の判定（サーバー必須）は、分ける。**判定のための `getDocFromServer` が失敗しても、一覧からは消さない**（キャッシュのイベントを出し続ける）
- 削除してよいのは、**`getDocFromServer` が、サーバーからの結果として、イベントが存在しない（`exists() === false`）と返したときだけ**
  - メンバーであれば、イベントが無くても、`get` はルール上許可され、`exists() === false` が返る
- 次のときは、**削除しない**：
  - `permission-denied`（すでにメンバーでなくなっている。削除する対象も無い）→ **一覧に出さない**（表示用の `getDoc` が `permission-denied` になったときだけ、一覧から外す）
  - `unavailable` などの通信エラー、キャッシュからの結果（サーバーで確認できていない）→ **一覧には出す**（キャッシュのイベントを表示する）

### 3.3 members.ts
| 関数 | 内容 |
|---|---|
| `watchMembers(eventId, cb, onError): Unsubscribe` | |
| `watchInvites(eventId, cb: (invites: Invite[]) => void, onError): Unsubscribe` | オーナー用。発行の新しい順。`createdAt` は、書き込み直後は見積もりの時刻（`serverTimestamps: 'estimate'`）。期限は `inviteExpiresAt` |
| `createInvite(eventId, email, uid): Promise<void>` | **オンライン必須**。メールは、画面で `normalizeInviteEmail`（`lib/domain/invite.ts`：前後の空白除去・小文字・形の確認）を通したもの。`createdAt = serverTimestamp`。同じ相手には上書き（再発行＝期限が、その時点から1日） |
| `cancelInvite(eventId, email): Promise<void>` | **オンライン必須** |
| `removeMember(eventId, uid): Promise<void>` | オーナー用（他のメンバーのみ）。自分自身の削除（抜ける）にも使う（メンバーのみ。オーナーは不可） |

### 3.4 menu.ts
| 関数 | 内容 |
|---|---|
| `watchMenu(eventId, cb: (items: MenuItem[]) => void, onError): Unsubscribe` | `order` 昇順、同じ値のときは `id` 順に整えて返す |
| `addMenuItem(eventId, { name, price }, items): Promise<void>` | `order = 最大 + 10`。100件を超える場合は、`AppError('validation')` |
| `updateMenuItem(eventId, id, patch: Partial<Pick<MenuItem, 'name'\|'price'\|'soldOut'>>): Promise<void>` | 検証してから書く（価格は1〜100,000） |
| `moveMenuItem(eventId, id, dir: 'up' \| 'down', items): Promise<void>` | 並びを入れ替え、**全件の `order` を10, 20, 30…に振り直す**（1バッチ。同じ値になっていても動く） |
| `deleteMenuItem(eventId, id): Promise<void>` | 過去の注文は、書き写し済みのため影響なし |
| `addMenuItemsBulk(eventId, lines: ParsedLine[], items): Promise<void>` | `parseBulkMenu` の結果を、1バッチで追加。合計が100件を超える場合は、`AppError('validation')` |

### 3.5 orders.ts
| 関数 | 内容 |
|---|---|
| `confirmOrder(ctx: ConfirmContext): Promise<Order>` | 採番して作成（トランザクション）。既にあればそれを返す（冪等） |
| `voidOrFind(ctx): Promise<{ result: 'found'; order: Order } \| { result: 'voided' }>` | 「やめる」。注文があれば返し、なければ墓標を作る（トランザクション） |
| `findOrderOnServer(eventId, orderId): Promise<Order \| null>` | `getDocFromServer`。オフラインなら `AppError('offline')` |
| `watchActiveOrders(eventId, cb: (orders: Order[]) => void, onError): Unsubscribe` | `status in [preparing, ready]`。`includeMetadataChanges: true`。**Shell の階層で、イベントを選んでいる間は、常に購読する**（接続状態の判定と、調理画面で共有） |
| `watchOrdersOfDay(eventId, day, cb, onError): Unsubscribe` | 調理画面の「済みも表示」用（全状態） |
| `fetchOrdersOfDay(eventId, day): Promise<{ orders: Order[]; fromCache: boolean }>` | 売上用（`getDocs`）。`fromCache` が `true` なら、画面に警告を出す |
| `fetchOrdersOfDayFromServer(eventId, day): Promise<Order[]>` | レジ締め用（`getDocsFromServer`）。オフラインなら `AppError('offline')` |
| `transitionOrder(eventId, order, action: OrderAction, uid): Promise<void>` | 下記。`updateDoc`（オフラインでも受け付ける） |
| `changePayment(eventId, orderId, payment, uid): Promise<void>` | |

```ts
type OrderAction = 'ready' | 'backToPreparing' | 'done' | 'backToReady' | 'cancel' | 'restore';
```
- `transitionOrder` は、データ設計の遷移表（data-model.md §3）に従って、書き換える項目を決める。**不正な遷移は、書き込む前に `AppError('validation')` を投げる**
- `transitionOrder` / `changePayment` は、§6 の `trackWrite` を通す（未送信の数え上げと、拒否の通知のため）
- オフライン中の書き込みは、サーバーに届くまで、`Promise` が解決しない。UI は、**待たずに**画面を更新し（ローカルのキャッシュ）、拒否されたとき（他のメンバーが先に別の操作をした場合など）に、「◯番の操作を反映できませんでした」を表示する
- 同時操作の競合は、サーバー側のルール（遷移の検証）で守る。後から届いた不正な遷移は拒否され、ローカルの表示は、サーバーの状態に戻る

### 3.6 customerOrder.ts（お客様用。別モジュール）
| 関数 | 内容 |
|---|---|
| `watchOrder(eventId, orderId, cb: (r: CustomerOrderState) => void): Unsubscribe` | 注文1件の購読。`includeMetadataChanges: true`。判定は、純粋関数 `customerView`（screens.md §4.1） |

### 3.7 closings.ts
| 関数 | 内容 |
|---|---|
| `getClosing(eventId, day): Promise<Closing \| null>` | |
| `saveClosing(eventId, day, input, uid): Promise<void>` | **オンライン必須**（§3.9）。`expectedCash` と `diff` は、画面の計算値を書く。**呼び出す側が、`fetchOrdersOfDayFromServer` で集計した値を渡す**（部分的なキャッシュで締めないため） |

### 3.8 domain（純粋関数）
| 関数 | 内容 |
|---|---|
| `toDay(date): Day` | Asia/Tokyoの暦日 |
| `summarize(orders): Summary` | 売上集計（data-model.md §5.2） |
| `closingView(summary, closing, eventFloat): ClosingView` | 期待額・差額・「締め後に変更あり」 |
| `parseBulkMenu(text): { ok: ParsedLine[]; errors: { line: number; reason: string }[] }` | |
| `buildCsv(orders): string` / `csvFileName(eventName, day): string` / `buildSummaryText(...)` | 品名は、注文に書き写し済みのため、メニューの引数は不要 |
| `calcTotal(lines)` / `calcChange(total, tendered)` | |
| `nextAction(status)` / `canTransition(from, to)` | 状態遷移 |
| `confirmReducer(state, event)` | 確定フローの状態遷移（order-confirm.md） |
| `connectionStatus(input)` | 接続状態の推定（§6） |
| `customerView(input)` | お客様画面の状態の判定（screens.md §4.1） |
| `orderUrl(origin, eventId, orderId)` | QRに入れるURL |

### 3.9 オンライン必須の書き込み
次の書き込みは、`batch` や `set` で書くと、オフラインでも受け付けられて、溜まる（画面は完了を待ち続け、後から、思わぬタイミングで反映される）。**書く前に、サーバーへの到達を確かめる**。

- 対象：`createEvent`、`joinEvent`、`createInvite`・`cancelInvite`、`saveClosing`、`deleteEventDeep`、`removeMember`
- `assertOnline(ref)`（`lib/data/online.ts`）：`getDocFromServer(ref)` を実行する。`unavailable`・タイムアウト（8秒）なら、`AppError('offline')`（「通信が必要です」）を投げて、**書かない**。`permission-denied`・`not-found` は、サーバーに届いた証拠なので、通信ありとして扱う（`createEvent` のように、まだ存在しない文書でも使える）
- 確認の直後に、通信が切れることは、あり得る。そのときは、書き込みが溜まるが、確認と書き込みの間は短く、頻度が低いため、既知の制約とする。画面は、接続状態（§6）がオフラインの間は、これらの操作のボタンを無効にする。ただし、接続状態の判定は、Shellの購読（イベントを選んでいる間）に依存する。**イベント一覧と `/join` では、`navigator.onLine` だけで判定する**（`assertOnline` があるので、判定が粗くても、書き込みは溜まらない）
- 調理画面の操作（`transitionOrder`、`changePayment`）と、メニュー・イベントの編集は、**対象外**（オフラインでも受け付け、`trackWrite` で数える。メニューは、`trackWrite` の対象外）

**`displayName` の決め方**（`createEvent`・`joinEvent`。`lib/domain/event.ts` の `memberDisplayName`）：Googleの表示名（`user.displayName`）を、前後の空白を除いて使う。`null`・空のときは、メールの `@` より前を使う。**60文字を超える場合は、60文字に切り詰める**（ルールが、61文字以上を拒否するため。拒否されると、「招待されていません」と誤った案内になる）。文字数は、ルールと同じく UTF-16 の単位で数え、絵文字の途中では切らない（data-model.md §2 の注）

## 4. エラー設計

```ts
type AppErrorCode =
  | 'offline'      // 通信できない
  | 'timeout'      // 8秒で応答がない
  | 'permission'   // 権限がない（メンバーでなくなった、など）
  | 'not-found'
  | 'conflict'     // 競合（他の端末が先に変更した）
  | 'validation'   // 入力・遷移が不正
  | 'popup-blocked' // ログインのポップアップが、ブラウザに止められた（#5）
  | 'unknown';
class AppError extends Error { code: AppErrorCode; cause?: unknown }
```

| Firestore の `code` | AppError | 画面の文言（例） |
|---|---|---|
| `unavailable` | offline | 通信できません。電波を確認してください |
| `deadline-exceeded`（または自前のタイムアウト） | timeout | 送れていません |
| `permission-denied` | permission | この操作は許可されていません。イベントのメンバーでなくなった可能性があります |
| `not-found` | not-found | 見つかりません |
| `aborted`, `failed-precondition` | conflict | 他の端末で変更されました。画面を確認してください |
| `invalid-argument` | validation | 入力を確認してください |
| その他 | unknown | うまくいきませんでした（時間をおいて、もう一度） |

- お客様画面と、確定フローは、それぞれ専用の表示を持つ（order-confirm.md、screens.md）

## 5. 購読の管理

- 画面ごとに、購読を始める・解除する（タブを切り替えたら、前のタブの購読は解除する）
- **例外：`watchActiveOrders` は、Shell の階層で、イベントを選んでいる間は、常に購読する**。接続状態の判定（§6）が、どのタブでも要るため。`status in [...]` のみで、読み取りは少ない
- 同じクエリを、複数の画面が購読しないよう、`lib/data` の外で共有ストア（signals）に載せる
- 購読のエラー：`permission` → イベント一覧に戻す（§8 のキャッシュ消去）。`offline` → 接続状態に反映（購読は、SDKが自動で再接続する）

## 6. 接続状態と未送信

### 6.1 接続状態の判定
Firestore SDK は、接続状態を直接は公開しない。次のように推定する（純粋関数 `connectionStatus`）。

| 状態 | 条件 |
|---|---|
| オフライン | `navigator.onLine === false`、または、Shell の購読の最新スナップショットが `metadata.fromCache === true` のまま **10秒以上**続いている |
| オンライン | 上記以外 |

### 6.2 未送信の数え上げ
「渡した」「取り消し」の書き込みは、書いた直後に、注文が購読の範囲（`status in [preparing, ready]`）から外れる。**そのため、`hasPendingWrites` では、数えられない**。アプリ側で、書き込みを数える。

```ts
// lib/data/writes.ts
const pendingWrites = signal(0);       // 未送信の書き込みの数
const pendingUnknown = signal(false);  // 数は不明だが、未送信がある（再読み込み後）

function trackWrite(p: Promise<void>, describe: string, onRejected: (e: AppError) => void): void {
  pendingWrites.value++;
  p.then(() => {}, (e) => onRejected(toAppError(e, describe)))
   .finally(() => { pendingWrites.value--; });
}
```
- 対象：`transitionOrder`、`changePayment`（確定はオンライン必須のため対象外）。メニューの編集などは、数えなくてよい
- 表示：`pendingWrites > 0` なら「未送信◯件」。再読み込みの直後は、`waitForPendingWrites(db)` を1.5秒だけ待ち、解決しなければ `pendingUnknown = true`（「未送信あり」。件数は不明）にし、解決したら消す
- **既知の制約**：アプリを再読み込みすると、メモリ上の `Promise` が失われる。再読み込みをまたいで、サーバーに拒否された書き込みは、**通知できない**（画面は、購読で、サーバーの状態に戻る）。「未送信あり」が消えたあとで、調理画面の状態を確認する運用とする（C2）

## 7. イベント削除

Cloud Functions を使わないため、**オーナーの端末から、配下を少しずつ削除**する。

順序（途中で止まっても、再実行すれば続きから消せる）：
0. **通信を確認する**（§3.9）。以降、対象の一覧は、すべて **`getDocsFromServer`** で集める（オフラインでは、キャッシュの一部しか取れず、取りこぼした注文が、孤立して残るため。注文は、誰でも `get` できるので、イベントが無くなった後も読めてしまう）。サーバーから取れなければ、そこで止める
1. `events/{eventId}.deleting = true` にする（注文・カウンター・レジ締め・墓標の削除が、ルール上、これ以降だけ許可される。逆に、新しい注文・墓標・カウンター・メニュー・レジ締めは、オーナーを含めて、これ以降は作れない）
2. **他のメンバーの `members/{uid}` と、`invites` を先に削除する**（他のメンバーが、削除中に書き込めないようにする。消し残しを防ぐ）
3. `orders`、`voids` を、450件ずつ（`writeBatch`）削除
4. `counters`、`closings`、`menu` を削除する。`menu` の削除は、ルール上 `isMember`（自分の `members` が残っていること）が条件のため、**自分の `members` より先に消す**。`orders`・`voids`・`counters`・`closings` の削除は、`isOwner` と `deleting` が条件で、`members` には依存しない
5. **配下の `orders`・`voids`・`counters`・`closings`・`menu` が空になったことを、`getDocsFromServer` で確かめてから**、`events/{eventId}` を削除する（`deleting = true` のときだけ許可される）。残っていれば、3〜4 をやり直す
6. 自分の `members/{uid}` を削除する（イベントが無くなった後は、ルールが、オーナー自身にも許可する）

- 途中で止まった場合（`deleting = true` のまま）の画面での扱いは、screens.md §3.2・§3.9。同じ操作（「削除を再開」）で、続きから消せる
- 5の後で止まった場合、自分の `members` だけが残る → `watchMyEvents` が、サーバーでイベントが無いことを確認し、削除する
- 進捗（削除した件数）を表示する。**確認は、イベント名の入力**で行う
- 1日の削除の無料枠は2万件。それを超える規模は、想定しない
- ★U4：数千件の削除にかかる時間と、途中で失敗したときの動作を、実機で確認する

## 8. ログアウトとキャッシュの消去

スタッフ用のFirestoreは、IndexedDBに、注文などを保存している（永続キャッシュ）。ログアウトした端末や、メンバーでなくなった端末に、データが残らないようにする。

| きっかけ | 処理 |
|---|---|
| ログアウト | 未送信（`pendingWrites > 0` または `pendingUnknown`）があれば、「未送信の操作が消えます。通信できる場所で送信してからログアウトしてください」と警告し、確認を取る → `terminate(db)` → `clearIndexedDbPersistence(db)` → 画面を再読み込み |
| `permission-denied`（メンバーでなくなった） | イベント一覧に戻す。キャッシュの消去は、**他のイベントの未送信がなくなるまで延期する**（下記） |

**メンバーでなくなったときの消去の延期**
- `clearIndexedDbPersistence` は、端末のキャッシュを丸ごと消すため、**別のイベントの未送信の書き込みも消える**（画面も再読み込みされる）
- そのため、`waitForPendingWrites(db)` を待ち、**未送信がなくなってから**消す。未送信が残っている（通信できない）ときは、消去を**保留**し、「消去待ち」の印を `localStorage`（`hei:clearPending`）に残す。保留の間は、外されたイベントを、一覧に出さず、開けない
- 次の起動時に、印があれば、未送信がなくなっているかを確かめ、なくなっていれば、消去する（なお残っていれば、再び持ち越す）
- 外されたイベント自体の未送信は、どのみち拒否されるが、数えてしまうため、待ち続けることがある。**24時間たっても残るときは、「未送信が残っています。消してよいか」の確認を出す**（確認が取れれば消去する）

- `clearIndexedDbPersistence` は、Firestoreを終了した後でなければ呼べない。そのため、再読み込みを伴う
