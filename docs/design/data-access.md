# データアクセス設計（API設計）

サーバー（自前のAPI）は持たない。クライアントが Firestore と Firebase Authentication に、直接アクセスする。
そのため「API設計」は、**アプリ内のデータアクセス層（`src/lib/data/`）の関数の契約**として定める。
データの定義は [data-model.md](./data-model.md)、確定フローは [order-confirm.md](./order-confirm.md)。

## 1. 原則

- 画面（UI）は、Firestore を直接呼ばない。必ず `lib/data/*` の関数を通す
- 関数は、型付きの入出力にする。Firestore の型（`DocumentSnapshot` など）を、UI に漏らさない
- 購読（`watch*`）は、`Unsubscribe`（`() => void`）を返す。画面が閉じるとき、必ず解除する
- 失敗は、`AppError`（下記）に変換して投げる。UI は、`code` で表示を分ける
- 日付・集計・CSV・パースなどの計算は、`lib/domain/*` の**純粋関数**にする（Firebaseを import しない）

## 2. 型

```ts
type Day = string; // 'YYYY-MM-DD'
type Payment = 'cash' | 'paypay';
type OrderStatus = 'preparing' | 'ready' | 'done' | 'cancelled';

interface EventDoc { id: string; name: string; startDate: Day; endDate: Day; floatCash: number; ownerUid: string }
interface Member { uid: string; role: 'owner' | 'member'; displayName: string; email: string }
interface Invite { email: string; expiresAt: Date }
interface MenuItem { id: string; name: string; price: number; order: number; soldOut: boolean }
interface OrderLine { menuId: string; name: string; price: number; qty: number }
interface Order {
  id: string; number: number; day: Day; items: OrderLine[]; total: number;
  payment: Payment; status: OrderStatus; cancelledFrom: Exclude<OrderStatus, 'cancelled'> | null;
  qr: boolean; createdAt: Date | null; readyAt: Date | null; doneAt: Date | null; cancelledAt: Date | null;
  createdBy: string; updatedBy: string;
  pending: boolean; // metadata.hasPendingWrites（未送信）
}
interface Closing { day: Day; floatCash: number; expectedCash: number; actualCash: number; diff: number; note: string; closedAt: Date | null }
type Unsubscribe = () => void;
```
- `createdAt` は、書き込み直後（サーバー時刻の確定前）に `null` になり得る

## 3. モジュールと関数

### 3.1 auth.ts
| 関数 | 内容 |
|---|---|
| `onAuthChange(cb: (user: User \| null) => void): Unsubscribe` | ログイン状態の購読 |
| `signInWithGoogle(): Promise<void>` | Googleログイン（popup / redirect。★U1で決める） |
| `signOut(): Promise<void>` | |

### 3.2 events.ts
| 関数 | 内容 |
|---|---|
| `watchMyEvents(uid, cb: (events: EventDoc[]) => void, onError): Unsubscribe` | `members` のコレクショングループ（`uid` 一致）を購読し、親のイベントを取得。**取得できないイベント（削除済み・権限なし）は除外し、自分の孤立した `members` は削除する** |
| `createEvent(input, user): Promise<string>` | イベント＋オーナーの `members` を、1バッチで作成。`eventId` を返す |
| `updateEvent(eventId, patch): Promise<void>` | 名前・日付・準備金 |
| `deleteEventDeep(eventId, onProgress): Promise<void>` | 配下を削除（[§7](#7-イベント削除)） |
| `joinEvent(eventId, user): Promise<void>` | メンバー作成＋招待の削除（1バッチ） |

### 3.3 members.ts
| 関数 | 内容 |
|---|---|
| `watchMembers(eventId, cb, onError): Unsubscribe` | |
| `watchInvites(eventId, cb, onError): Unsubscribe` | オーナー用 |
| `createInvite(eventId, email, uid): Promise<void>` | メールを小文字・前後の空白除去。期限は1日後。同じ相手には上書き（再発行） |
| `cancelInvite(eventId, email): Promise<void>` | |
| `removeMember(eventId, uid): Promise<void>` | オーナー用。自分自身の削除（抜ける）にも使う |

### 3.4 menu.ts
| 関数 | 内容 |
|---|---|
| `watchMenu(eventId, cb: (items: MenuItem[]) => void, onError): Unsubscribe` | `order` 昇順に整えて返す |
| `addMenuItem(eventId, { name, price }, items): Promise<void>` | `order = 最大 + 10` |
| `updateMenuItem(eventId, id, patch: Partial<Pick<MenuItem, 'name'\|'price'\|'soldOut'>>): Promise<void>` | 検証してから書く |
| `moveMenuItem(eventId, id, dir: 'up' \| 'down', items): Promise<void>` | 隣と `order` を入れ替える（1バッチ） |
| `deleteMenuItem(eventId, id): Promise<void>` | 過去の注文は、書き写し済みのため影響なし |
| `addMenuItemsBulk(eventId, lines: ParsedLine[], items): Promise<void>` | `lib/domain/parseBulkMenu` の結果を、1バッチで追加 |

### 3.5 orders.ts
| 関数 | 内容 |
|---|---|
| `confirmOrder(ctx: ConfirmContext, signal: AbortFlag): Promise<Order>` | 採番して作成（トランザクション）。詳細は order-confirm.md |
| `findOrderOnServer(eventId, orderId): Promise<Order \| null>` | `getDocFromServer`。オフラインなら `AppError('offline')` |
| `watchActiveOrders(eventId, cb: (orders: Order[]) => void, onError): Unsubscribe` | `status in [preparing, ready]`。`includeMetadataChanges: true`（未送信の判定のため） |
| `watchOrdersOfDay(eventId, day, cb, onError): Unsubscribe` | 調理画面の「済みも表示」用（全状態） |
| `fetchOrdersOfDay(eventId, day): Promise<Order[]>` | 売上・CSV用（1回の取得） |
| `watchOrder(eventId, orderId, cb: (o: Order \| null) => void, onError): Unsubscribe` | お客様用。存在しないとき `null` |
| `transitionOrder(eventId, order, action: OrderAction, uid): Promise<void>` | 下記。`updateDoc`（オフラインでも受け付ける） |
| `changePayment(eventId, orderId, payment, uid): Promise<void>` | |

```ts
type OrderAction = 'ready' | 'backToPreparing' | 'done' | 'backToReady' | 'cancel' | 'restore';
```
- `transitionOrder` は、データ設計の遷移表（data-model.md §3）に従って、書き換える項目を決める。**不正な遷移は、書き込む前に `AppError('validation')` を投げる**
- オフライン中の書き込みは、サーバーに届くまで、`Promise` が解決しない。UI は、**待たずに**画面を更新し（ローカルのキャッシュ）、`.catch` で、サーバーに拒否されたとき（他のメンバーが先に別の操作をした場合など）に、「◯番の操作を反映できませんでした」を表示する
- 同時操作の競合は、サーバー側のルール（遷移の検証）で守る。後から届いた不正な遷移は拒否され、ローカルの表示は、サーバーの状態に戻る

### 3.6 closings.ts
| 関数 | 内容 |
|---|---|
| `getClosing(eventId, day): Promise<Closing \| null>` | |
| `saveClosing(eventId, day, input, uid): Promise<void>` | `expectedCash` と `diff` は、画面の計算値を書く（締めた時点の値の記録） |

### 3.7 domain（純粋関数）
| 関数 | 内容 |
|---|---|
| `toDay(date): Day` | Asia/Tokyoの暦日 |
| `summarize(orders): Summary` | 売上集計（data-model.md §5.2） |
| `closingView(summary, closing, eventFloat): ClosingView` | 期待額・差額・「締め後に変更あり」 |
| `parseBulkMenu(text): { ok: ParsedLine[]; errors: { line: number; reason: string }[] }` | |
| `buildCsv(orders, menuNames): string` / `buildSummaryText(...)` | |
| `calcTotal(lines)` / `calcChange(total, tendered)` | |
| `nextAction(status)` / `canTransition(from, to)` | 状態遷移 |
| `orderUrl(origin, eventId, orderId)` | QRに入れるURL |

## 4. エラー設計

```ts
type AppErrorCode =
  | 'offline'      // 通信できない
  | 'timeout'      // 8秒で応答がない
  | 'permission'   // 権限がない（メンバーでなくなった、など）
  | 'not-found'
  | 'conflict'     // 競合（他の端末が先に変更した）
  | 'validation'   // 入力・遷移が不正
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

- 画面ごとに、購読を始める・解除する（タブを切り替えたら、前のタブの購読は解除する）。調理タブは、注文タブを開いている間も、**未送信件数を出すため**、購読を続ける（`status in [...]` のみで、読み取りは少ない）
- 同じクエリを、複数の画面が購読しないよう、`lib/data` の外で共有ストア（signals）に載せる
- 購読のエラー：`permission` → イベント一覧に戻す。`offline` → 接続状態に反映（購読は、SDKが自動で再接続する）

## 6. 接続状態の判定

Firestore SDK は、接続状態を直接は公開しない。次のように推定する。

| 状態 | 条件 |
|---|---|
| オフライン | `navigator.onLine === false`、または、調理画面の購読の最新スナップショットが `metadata.fromCache === true` のまま **10秒以上**続いている |
| 未送信◯件 | 調理画面の購読（`includeMetadataChanges: true`）で、`hasPendingWrites` が `true` の注文の数 |
| オンライン | 上記以外 |

- ★実機で、機内モード・電波が弱い状況を作り、判定が遅れすぎないか確認する
- 未送信の変更は、調理画面の購読範囲（`preparing` / `ready`）の注文のみ数える。支払い方法の変更など、範囲外のものは、数えない（許容）

## 7. イベント削除

Cloud Functions を使わないため、**オーナーの端末から、配下を少しずつ削除**する。

順序（途中で止まっても、再実行すれば続きから消せる）：
1. `orders` を、450件ずつ（`writeBatch`）削除
2. `menu`, `counters`, `closings`, `invites` を、同様に削除
3. 他のメンバーの `members/{uid}` を削除
4. `events/{eventId}` を削除（`isOwner` が、イベントのドキュメントを参照するため、**自分の `members` より先**）
5. 自分の `members/{uid}` を削除

- 4の後で止まった場合、自分の `members` だけが残る → `watchMyEvents` が、イベントが無いことを検出し、削除する
- 進捗（削除した件数）を表示する。**確認は、イベント名の入力**で行う
- 1日の削除の無料枠は2万件。それを超える規模は、想定しない
- ★U4：数千件の削除にかかる時間と、途中で失敗したときの動作を、実機で確認する
