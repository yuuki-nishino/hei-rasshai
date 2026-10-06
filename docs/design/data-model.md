# データ設計

Cloud Firestore のコレクション、項目、制約、インデックス、状態遷移、集計の計算仕様。
アクセス制御は [security-rules.md](./security-rules.md)、読み書きの関数は [data-access.md](./data-access.md)。

## 1. コレクション一覧

```
creators/{email}                          イベントを作れるアカウント（運営者がコンソールで管理）
events/{eventId}                          イベント
  ├─ members/{uid}                        メンバー（アクセス権の正）
  ├─ invites/{email}                      招待（参加で削除）
  ├─ menu/{menuId}                        メニュー
  ├─ orders/{orderId}                     注文
  ├─ voids/{orderId}                      墓標（「やめる」で、その注文IDを以後使えなくする）
  ├─ counters/{day}                       採番カウンター
  └─ closings/{day}                       レジ締め
```

- `eventId` / `menuId` / `orderId` は、Firestoreの自動ID（20文字）。`orderId` はクライアントで生成する
- `day` は `YYYY-MM-DD`（Asia/Tokyo）。`email` は小文字
- 時刻は、すべて Firestore の `Timestamp`。サーバー時刻は `serverTimestamp()` を使う

### 関係図（ER図）

```mermaid
erDiagram
    AUTH_USER ||..o{ MEMBER : "uid が一致"
    AUTH_USER }o..o| CREATOR : "email が一致"
    AUTH_USER }o..o| INVITE : "email が一致"
    EVENT ||--o{ MEMBER : "サブコレクション"
    EVENT ||--o{ INVITE : "サブコレクション"
    EVENT ||--o{ MENU : "サブコレクション"
    EVENT ||--o{ ORDER : "サブコレクション"
    EVENT ||--o{ VOID : "サブコレクション"
    EVENT ||--o{ COUNTER : "サブコレクション"
    EVENT ||--o{ CLOSING : "サブコレクション"
    ORDER ||--|{ ORDER_LINE : "items（埋め込み）"
    MENU ||..o{ ORDER_LINE : "menuId（制約なし）"
    MEMBER ||..o{ ORDER : "createdBy / updatedBy = uid（制約なし）"
    COUNTER ||..o{ ORDER : "day が一致"
    CLOSING ||..o{ ORDER : "day が一致（集計）"
    ORDER ||..o| VOID : "orderId が一致（どちらか一方だけ存在できる）"

    AUTH_USER {
        string uid PK
        string email "Googleアカウント（Authentication）"
    }
    CREATOR {
        string email PK "events を作れるアカウント"
    }
    EVENT {
        string eventId PK
        string name
        string startDate
        string endDate
        int floatCash
        string ownerUid FK
        boolean deleting "削除中（これが true の間だけ、注文などを削除できる）"
        timestamp createdAt
    }
    MEMBER {
        string uid PK "events/{e}/members/{uid}"
        string role "owner / member"
        string displayName
        string email
    }
    INVITE {
        string email PK "events/{e}/invites/{email}"
        string createdBy FK
        timestamp createdAt "有効期限は、createdAt の1日後"
    }
    MENU {
        string menuId PK
        string name
        int price
        number order
        boolean soldOut
    }
    ORDER {
        string orderId PK
        int number "日別の連番"
        string day
        int total
        string payment "cash / paypay"
        string note "メモ（任意・100文字まで）"
        string status
        string cancelledFrom
        boolean qr
        string createdBy FK
        string updatedBy FK
        timestamp createdAt
        timestamp readyAt
        timestamp doneAt
        timestamp cancelledAt
        timestamp updatedAt
    }
    ORDER_LINE {
        string menuId FK "書き写した参照"
        string name "注文時点の名前"
        int price "注文時点の価格"
        int qty
    }
    COUNTER {
        string day PK "events/{e}/counters/{day}"
        int n "最後に発行した番号"
    }
    CLOSING {
        string day PK "events/{e}/closings/{day}"
        int floatCash
        int expectedCash
        int actualCash
        int diff
        string note
        timestamp closedAt
        string closedBy FK
    }
    VOID {
        string orderId PK "events/{e}/voids/{orderId}"
        string createdBy FK
        timestamp createdAt
    }
```

- **実線**：サブコレクション、または埋め込み（親のパスの配下にある。親があって初めて存在する）
- **点線**：論理的な参照。Firestore には外部キー制約がないため、**参照先が消えても、エラーにならず、残る**
- 削除時の扱い：
  | 参照元 → 参照先 | 参照先が消えたとき |
  |---|---|
  | 注文の `items[].menuId` → メニュー | メニューを削除しても、注文は、書き写した名前・価格のまま残る。集計は、`menuId + price` でまとめ、表示する名前は、まとめた中で最も新しい注文のもの（5.2） |
  | 注文の `createdBy` / `updatedBy` → メンバー | メンバーが抜けても、注文は残る。スタッフ画面では、表示名が引けないため、「（退会済み）」と表示する |
  | イベントの配下すべて → イベント | イベントを削除しても、配下は自動では消えない。**アプリが、配下を先に削除する**（data-access.md §7） |
  | 招待・`creators` → アカウント | IDがメールアドレスのため、アカウントが無くても存在できる。参加・イベント作成のときに、ログイン中のメールアドレスと一致するかを、ルールが検証する |
- `COUNTER` / `CLOSING` と `ORDER` は、IDで結ばれていない。同じ `day`（`YYYY-MM-DD`）を持つことで、対応する

## 2. 項目定義

- **文字数**（「1〜60文字」など）は、ルールの `size()` と同じく、**UTF-16 の単位**（JavaScript の `length`）で数える。絵文字の多くは2文字になる（#7 で、Emulator で確認。`🍜`×30 は通り、×31 は拒否）。画面の入力の検査も、同じ数え方にする

### 2.1 creators/{email}
| 項目 | 型 | 内容 |
|---|---|---|
| （なし） | | ドキュメントの存在だけが意味を持つ。メモ用に `note: string` を入れてもよい。アプリからは読み書きできない |

### 2.2 events/{eventId}
| 項目 | 型 | 必須 | 制約・内容 |
|---|---|---|---|
| name | string | ○ | 1〜60文字 |
| startDate | string | ○ | `YYYY-MM-DD` |
| endDate | string | ○ | `YYYY-MM-DD`。`startDate` 以降 |
| floatCash | int | ○ | 0以上。釣り銭の準備金の初期値 |
| ownerUid | string | ○ | 作成者の uid。**変更不可** |
| deleting | boolean | ○ | 作成時は `false`。**オーナーだけが変更できる**。`true` の間だけ、オーナーが、注文・カウンター・レジ締め・墓標・イベントを削除できる（イベントの削除の手順用） |
| createdAt | timestamp | ○ | serverTimestamp |

### 2.3 members/{uid}
| 項目 | 型 | 必須 | 制約・内容 |
|---|---|---|---|
| uid | string | ○ | ドキュメントIDと同じ。コレクショングループクエリ用 |
| role | 'owner' \| 'member' | ○ | |
| displayName | string | ○ | Googleの表示名。スタッフ画面だけで使う |
| email | string | ○ | 小文字。メンバー一覧で、オーナーが誰かを判別するために使う（メンバー以外は読めない） |
| joinedAt | timestamp | ○ | serverTimestamp |

### 2.4 invites/{email}
| 項目 | 型 | 必須 | 制約・内容 |
|---|---|---|---|
| createdBy | string | ○ | オーナーの uid |
| createdAt | timestamp | ○ | serverTimestamp（ルールが `request.time` との一致を要求する）。**有効期限は、`createdAt` の1日後**で、項目としては持たない（ルールが、参加のときに計算する）。再発行は、この項目を更新する |

### 2.5 menu/{menuId}
| 項目 | 型 | 必須 | 制約・内容 |
|---|---|---|---|
| name | string | ○ | 1〜40文字 |
| price | int | ○ | 1〜100,000（無料・値引きは非対応のため、0円は不可） |
| order | number | ○ | 表示順（昇順）。10, 20, 30…と振り、並べ替えのたびに、全件を振り直す。同じ値があっても、`id` 順で、決まった順になる |
| soldOut | boolean | ○ | |

- 1イベントのメニューは、最大100件まで。**件数は、端末の検査で守る**（ルールでは数えられない。2台で同時に追加すると、わずかに超えることがある。PR #36 のレビュー M7）

### 2.6 orders/{orderId}
| 項目 | 型 | 必須 | 制約・内容 | 作成後に変更 |
|---|---|---|---|---|
| number | int | ○ | その日の連番（1〜） | 不可 |
| day | string | ○ | `YYYY-MM-DD` | 不可 |
| items | array | ○ | 下記。1〜50行 | 不可 |
| total | int | ○ | `Σ price × qty`。1以上 | 不可 |
| payment | 'cash' \| 'paypay' | ○ | | **可** |
| note | string | | 0〜100文字（UTF-16 の単位。絵文字は2文字）。任意（項目が無い・空は、メモなし）。調理で気をつけること（「辛さ抜き」）。お客様画面には出さない（#40） | **可** |
| status | 'preparing' \| 'ready' \| 'done' \| 'cancelled' | ○ | | 可（遷移表に従う） |
| cancelledFrom | 'preparing' \| 'ready' \| 'done' \| null | ○ | 取り消し前の状態。取り消し中だけ値を持つ | 可 |
| qr | boolean | ○ | QRを発行した（待ちあり）注文か | 不可 |
| createdAt | timestamp | ○ | serverTimestamp | 不可 |
| readyAt | timestamp \| null | ○ | | 可 |
| doneAt | timestamp \| null | ○ | | 可 |
| cancelledAt | timestamp \| null | ○ | | 可 |
| createdBy | string | ○ | **uid**（メール・名前は入れない。お客様が読めるため） | 不可 |
| updatedBy | string | ○ | uid | 可 |
| updatedAt | timestamp | ○ | serverTimestamp | 可 |

`items` の1行：

| 項目 | 型 | 制約 |
|---|---|---|
| menuId | string | 注文時点のメニューのID |
| name | string | 注文時点の名前 |
| price | int | 注文時点の価格 |
| qty | int | 1〜99 |

- `total` は、クライアントが計算して書く。ルールでは、型と範囲のみを検査する（`items` との一致は、任意の改善）
- 同じ `menuId` を、1注文の中で複数行にしない（カートで数量にまとめる）

### 2.7 counters/{day}
| 項目 | 型 | 内容 |
|---|---|---|
| n | int | その日に発行した最後の番号 |

### 2.8 closings/{day}
| 項目 | 型 | 内容 |
|---|---|---|
| floatCash | int | その日の準備金 |
| expectedCash | int | `floatCash + 現金売上`（締めた時点） |
| actualCash | int | 数えた現金 |
| diff | int | `actualCash - expectedCash` |
| note | string | 0〜200文字 |
| closedAt | timestamp | serverTimestamp |
| closedBy | string | uid |

### 2.9 voids/{orderId}
「やめる」を選んだ注文IDの墓標（[ADR-0004](../adr/0004-void-tombstone.md)）。

| 項目 | 型 | 内容 |
|---|---|---|
| createdBy | string | uid |
| createdAt | timestamp | serverTimestamp |

- 墓標があるIDでは、ルールが、注文の作成を拒否する。注文があるIDでは、ルールが、墓標の作成を拒否する（どちらか一方だけが存在できる）
- 墓標は、イベントを削除するときまで残す（読み取りは、メンバーのみ）

## 3. 状態遷移と書き換える項目

注文の `status` は、下表の遷移だけが許される（ルールでも検証する）。

| 操作 | 遷移 | 書き換える項目 |
|---|---|---|
| 確定（QRあり） | → preparing | 作成時に、`cancelledFrom = null`, `readyAt = doneAt = cancelledAt = null` |
| 確定（QRなし） | → done | 作成時に、`doneAt = serverTimestamp`、他の時刻は `null` |
| 完成 | preparing → ready | `readyAt = now` |
| 調理中に戻す | ready → preparing | `readyAt = null` |
| 渡した | ready → done | `doneAt = now` |
| 渡したを戻す | done → ready | `doneAt = null` |
| 取り消し | preparing / ready / done → cancelled | `cancelledFrom = 直前のstatus`, `cancelledAt = now` |
| 取り消しを戻す | cancelled → cancelledFrom | `cancelledFrom = null`, `cancelledAt = null` |

- どの更新でも、`updatedBy = uid`、`updatedAt = serverTimestamp` を書く
- 支払い方法の変更は、`payment`、`updatedBy`、`updatedAt` のみ書く（状態は変えない）
- メモの変更は、`note`、`updatedBy`、`updatedAt` のみ書く（状態は変えない。空にするときは、空の文字列を書く。#40）
- 「渡したを戻す」で ready に戻した注文の `doneAt` は `null`。「取り消しを戻す」で復帰した注文の時刻項目は、取り消し前のまま

## 4. インデックスとクエリ

| 用途 | クエリ | インデックス |
|---|---|---|
| 自分のイベント一覧 | コレクショングループ `members` で `where('uid', '==', myUid)` | **コレクショングループの単一フィールドインデックス（`uid`）が必要** |
| 調理画面 | `orders` で `where('status', 'in', ['preparing', 'ready'])`、`(day, number)` 順にクライアントで並べる（複数日の開催で、前日の調理中が残ることがあるため） | 自動 |
| 調理画面（済みも表示） | `orders` で `where('day', '==', today)`（全状態） | 自動 |
| 売上・レジ締め・CSV | `orders` で `where('day', '==', day)` | 自動 |
| お客様 | `orders/{orderId}` の1件 | 不要 |
| メニュー | `menu` 全件（`order` 昇順にクライアントで並べる） | 不要 |

- 複合インデックスは使わない（`day` と `status` を同時に絞らない）。調理画面の並べ替えは、件数が少ないためクライアントで行う
- `firestore.indexes.json`：
```json
{
  "indexes": [],
  "fieldOverrides": [
    {
      "collectionGroup": "members",
      "fieldPath": "uid",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "DESCENDING", "queryScope": "COLLECTION" },
        { "arrayConfig": "CONTAINS", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
  ]
}
```
- `fieldOverrides` は、その項目の自動の索引を**置き換える**。コレクショングループの索引だけを書くと、コレクション単位の自動の索引（昇順・降順・`array-contains`）が無効になる。そのため、自動の3つも並べて残す（[PR #26 レビュー](../reviews/pr-26-rules-review.md) P4。Emulator は索引を検査しないため、テストでは気づけない）

## 5. 導出するデータ（保存しない）

### 5.1 日付（`day`）
- `toDay(date: Date): string`。`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', ... })` で `YYYY-MM-DD` を作る。端末のタイムゾーン設定に依存しない
- 「今日」は、`toDay(new Date())`。端末の時計が大きくずれていると、日付がずれる（運用で、時計の自動設定を確認する）

### 5.2 売上集計（`summarize(orders)`）
入力：ある `day` の全注文。取り消し（`status = 'cancelled'`）を除外してから集計する。

| 出力 | 計算 |
|---|---|
| cashTotal / cashCount | `payment = 'cash'` の `total` の合計・件数 |
| paypayTotal / paypayCount | `payment = 'paypay'` の同様 |
| grandTotal / grandCount | 上の合計 |
| byItem[] | キー：`menuId + '|' + price`。`name`＝そのキーの注文のうち、**最も新しい注文**の名前（途中で名前を直したときは、新しい名前に寄せる）、`qty`＝合計、`subtotal`＝`price × qty`。並び順：`subtotal` 降順、同額なら `name` |

### 5.3 レジ締め
- `expectedCash = floatCash + cashTotal`
- `diff = actualCash - expectedCash`（0：一致＝緑、それ以外：赤）
- 「締め後に変更あり」：`closings/{day}` が存在し、**保存済みの `floatCash`** と、現在の現金売上から再計算した `expectedCash` が、**保存済みの `expectedCash` と違う**とき（注文の追加・取り消し・支払い方法の変更を、まとめて検知する）
  - 画面で入力中の準備金は使わない（入力しただけで「変更あり」にならないように）
  - **既知の制約**：現金→PayPayと、PayPay→現金が、同額で相殺される変更は、検知できない。`updatedAt` が締めより新しい注文があるか、で判定する方法もあるが、現金に関係しない更新（「渡した」など）でも「変更あり」になるため、採らない
- 準備金の初期値：`closings/{day}.floatCash`、無ければ `events.floatCash`

### 5.4 集計のコピー（テキスト）
```
{イベント名} {YYYY-MM-DD}
現金 ¥12,000（30件）
PayPay ¥8,500（20件）
合計 ¥20,500（50件）

[メニュー別]
たこ焼き ¥500 × 40 = ¥20,000
ラムネ ¥200 × 3 = ¥600
```

### 5.5 CSV（注文一覧）
- 文字コード：UTF-8（BOM付き）、改行：CRLF、区切り：カンマ。セルは `"` で囲み、中の `"` は `""` にする。先頭が `= + - @`・タブ・`\r` のセルは、先頭に `'` を足す（表計算ソフトの式として実行されないように）
- 列：`日付, 番号, 状態, 支払い, 合計, 品目, メモ, 作成, 完成, 渡し, 取り消し`（メモの列は、#40 で足した。実装は #18）
  - 状態：調理中／できあがり／お渡し済み／取り消し
  - 品目：`名前×数量` を `; ` で連結
  - 時刻：JSTの `HH:mm:ss`
- ファイル名：`{イベント名}_{YYYY-MM-DD}_注文.csv`。イベント名の中の `/ \ : * ? " < > |` は `_` に置き換える
- 取り消しも含める（状態列で区別できる）

### 5.6 メニューのまとめて追加（`parseBulkMenu(text)`）
- 全角の数字・空白・カンマ・コロン・`￥` を、半角（`¥`）に正規化する。**正規化は、区切りと価格を見つけるためだけに使い、品名は元の文のまま取り出す**（置き換えは1文字 → 1文字なので、位置で切り出せる。「たこ焼き（８個）」は、そのまま登録される。[PR #37 のレビュー](../reviews/pr-37-bulk-menu-review.md) B3）
- 行頭の箇条書きの記号は除く（メモからの貼り付け）。`-`・`*`・`•` は、**後ろに空白があるときだけ**（`-20%セット` の `-` は品名。再レビュー B7）。`・` は、空白なしでも除く
- 1行ごとに、行末の「任意の `¥`（後ろに空白があってもよい）＋ 数字 ＋ 任意の `円`」を価格、その前を名前とする。区切りは、空白・カンマ・コロン（タブは空白に含まれる）。数字は、3桁区切りのカンマ（`1,000`）か、カンマなし（`1000`）だけを受け付ける
  - 正規表現（正規化後）：`^(.+?)([\s,:]+)(?:¥\s*)?(\d{1,3}(?:,\d{3})+|\d+)\s*円?$`
  - 価格だけの行（`500円`・`¥ 500`）は「品名がありません」。行末が価格の形なのに区切りが無い行（`焼きそば600円`）は「品名と価格の間に、空白かカンマを入れてください」（B2・B4）
  - **区切りがカンマだけで、品名の末尾の数字と価格をつなぐと3桁区切りになる行**（`ポテト1,500`）は、エラー行「品名と価格の間に、空白を入れてください」にする（品名「ポテト1」500円と読めてしまうため。B1）。`ポテト1 1,500` は通る
  - `焼き 1,0,0` のような、不正なカンマ区切りは、末尾の数字（`0`）だけが価格として解釈され、残り（`焼き 1,0`）が名前になる。この例は、価格が範囲外のため、エラー行になる。`焼き 1,0,5` のように、範囲内の価格になる場合は通ってしまうため、プレビューで、名前と価格を必ず確認できるようにする
- 空行は無視。名前が空・41文字以上、価格が無い・1未満・100,000超の行は**エラー行**として、行番号と理由を表示し、**エラーがある間は追加しない**（全部直してから追加）
- 例：`たこ焼き 500` / `ラムネ,200` / `焼きそば　６００円` → 3件

## 6. 上限と無料枠への影響

| 項目 | 上限 | 理由 |
|---|---|---|
| メニュー | 100件 | 全件購読のため |
| 1注文の行数 | 50行 | ドキュメントの大きさ（1MiB）に余裕を持たせる |
| 1日の注文数 | 制限なし（番号は3桁を想定。1000以上でも動く） | |
| 1回の書き込み | 500件（バッチの上限）。イベント削除は450件ずつ | |
