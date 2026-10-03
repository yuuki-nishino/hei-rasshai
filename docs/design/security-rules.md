# セキュリティルールと権限の設計

Firestore のアクセス制御。データの定義は [data-model.md](./data-model.md)、テストは [testing.md](./testing.md)。
状態：初期案。★は、Emulatorで検証する。

## 1. 方針

- **アクセス権は、`events/{e}/members/{uid}` の存在で決まる**。アカウントの種類（許可リストなど）では決めない
- イベントを作れるのは、`creators/{email}` に登録されたアカウントだけ（公開するときは、この条件を緩める）
- メンバーになれるのは、**自分のメールアドレス宛ての、有効な招待がある人**だけ（[ADR-0003](../adr/0003-invite-by-email.md)）
- お客様（未ログイン）は、**注文1件の取得（`get`）だけ**できる。一覧・検索はできない
- 注文の `items` / `total` / `number` / `day` / `qr` / `createdBy` / `createdAt` は、作成後に誰も変更できない
- 注文の状態の遷移は、ルールでも検証する（不正な遷移を拒否）
- ルールの `exists` / `get` は、1回ごとに、読み取り1回として数えられる

## 2. 権限表

| 操作 | 未ログイン | ログイン（非メンバー） | メンバー | オーナー |
|---|---|---|---|---|
| 注文1件の取得 | ○ | ○ | ○ | ○ |
| 注文の一覧・検索 | × | × | ○ | ○ |
| 注文の作成・状態/支払いの更新 | × | × | ○ | ○ |
| 注文の削除 | × | × | × | ○（イベント削除のとき） |
| メニュー・カウンター・レジ締めの読み書き | × | × | ○ | ○ |
| イベントの取得・更新 | × | × | ○ | ○ |
| イベントの作成 | × | `creators` に登録済みなら○ | － | － |
| イベントの削除 | × | × | × | ○ |
| メンバーの一覧 | × | × | ○ | ○ |
| メンバーになる | × | 自分宛ての有効な招待があれば○ | － | － |
| メンバーの削除 | × | × | 自分のみ（抜ける） | ○（誰でも） |
| 招待の作成・読み取り・更新 | × | × | × | ○ |
| 招待の削除 | × | 自分宛てのみ（参加と同時） | 自分宛てのみ | ○ |
| 自分のイベント一覧（コレクショングループ） | × | 自分の `members` のみ | 同左 | 同左 |
| `creators` | × | × | × | ×（コンソールのみ） |

## 3. firestore.rules（初期案）

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function eventDoc(e) { return /databases/$(database)/documents/events/$(e); }
    function isMember(e) {
      return signedIn()
          && exists(/databases/$(database)/documents/events/$(e)/members/$(request.auth.uid));
    }
    function isOwner(e) {
      return signedIn() && get(eventDoc(e)).data.ownerUid == request.auth.uid;
    }
    function canCreateEvent() {
      return signedIn() && request.auth.token.email_verified
          && exists(/databases/$(database)/documents/creators/$(request.auth.token.email));
      // 一般公開するときは、signedIn() だけにする（＋App Check）
    }
    function okTransition(from, to) {
      return from == to
          || (from == 'preparing' && to in ['ready', 'cancelled'])
          || (from == 'ready'     && to in ['done', 'preparing', 'cancelled'])
          || (from == 'done'      && to in ['ready', 'cancelled'])
          || (from == 'cancelled' && to in ['preparing', 'ready', 'done']);
    }

    match /events/{eventId} {
      allow get: if isMember(eventId);
      allow create: if canCreateEvent()
        && request.resource.data.ownerUid == request.auth.uid
        && request.resource.data.name is string
        && request.resource.data.name.size() >= 1 && request.resource.data.name.size() <= 60;
      allow update: if isMember(eventId)
        && request.resource.data.ownerUid == resource.data.ownerUid;
      allow delete: if isOwner(eventId);

      match /members/{uid} {
        allow get, list: if isMember(eventId);
        allow create: if signedIn() && request.auth.uid == uid
          && request.resource.data.keys().hasOnly(['uid', 'role', 'displayName', 'email', 'joinedAt'])
          && request.resource.data.uid == uid
          && (
            // オーナー：イベントと同じバッチで作る
            (request.resource.data.role == 'owner'
              && getAfter(eventDoc(eventId)).data.ownerUid == uid)
            // メンバー：自分のメールアドレス宛ての、有効な招待がある
            || (request.resource.data.role == 'member'
              && request.auth.token.email_verified
              && exists(/databases/$(database)/documents/events/$(eventId)/invites/$(request.auth.token.email))
              && get(/databases/$(database)/documents/events/$(eventId)/invites/$(request.auth.token.email)).data.expiresAt > request.time)
          );
        allow update: if false;
        allow delete: if isOwner(eventId) || (signedIn() && request.auth.uid == uid);
      }

      match /invites/{email} {
        allow read, create, update: if isOwner(eventId);
        // オーナーが取り消す。招待された本人は、参加と同時に使い切る
        allow delete: if isOwner(eventId)
          || (signedIn() && request.auth.token.email == email);
      }

      match /orders/{orderId} {
        // お客様：注文IDを知っている人が、その1件だけ読める（一覧は不可）
        allow get: if true;
        allow list: if isMember(eventId);
        allow create: if isMember(eventId)
          && request.resource.data.createdBy == request.auth.uid
          && request.resource.data.updatedBy == request.auth.uid
          && request.resource.data.status in ['preparing', 'done']
          && request.resource.data.payment in ['cash', 'paypay']
          && request.resource.data.number is int && request.resource.data.number >= 1
          && request.resource.data.total is int && request.resource.data.total >= 0
          && request.resource.data.items is list
          && request.resource.data.items.size() >= 1 && request.resource.data.items.size() <= 50
          && request.resource.data.day is string && request.resource.data.day.size() == 10;
        // 作成後に変えられるのは、状態・支払い方法・時刻・更新者だけ
        allow update: if isMember(eventId)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(
               ['status', 'payment', 'cancelledFrom', 'readyAt', 'doneAt',
                'cancelledAt', 'updatedBy', 'updatedAt'])
          && request.resource.data.payment in ['cash', 'paypay']
          && request.resource.data.updatedBy == request.auth.uid
          && okTransition(resource.data.status, request.resource.data.status)
          // 取り消しを戻すときは、取り消し前の状態に戻す
          && (resource.data.status != 'cancelled'
              || request.resource.data.status == 'cancelled'
              || request.resource.data.status == resource.data.cancelledFrom)
          // 取り消すときは、直前の状態を cancelledFrom に残す
          && (request.resource.data.status != 'cancelled'
              || resource.data.status == 'cancelled'
              || request.resource.data.cancelledFrom == resource.data.status);
        allow delete: if isOwner(eventId);   // イベント削除のときだけ
      }

      match /{sub}/{doc=**} {
        // menu, counters, closings
        allow read, write: if isMember(eventId) && sub in ['menu', 'counters', 'closings'];
      }
    }

    // 自分のイベント一覧用（コレクショングループ）
    match /{path=**}/members/{uid} {
      allow list: if signedIn() && resource.data.uid == request.auth.uid;
    }

    // creators は、クライアントから読み書きできない（既定で拒否）
  }
}
```

## 4. 参加・招待・イベント作成の流れ

### イベント作成（1バッチ）
1. `events/{eventId}` を作成（`ownerUid = 自分のuid`）
2. `events/{eventId}/members/{uid}` を作成（`role = 'owner'`）
- ルールは、`canCreateEvent()` と、`getAfter` による `ownerUid` の一致を検証する

### 招待（オーナー）
1. 相手のGoogleメールアドレス（小文字）を入力
2. `invites/{email}` を作成（`expiresAt = 1日後`）
3. 画面にリンク `{origin}/join?e={eventId}` を表示。コピーして、相手に送る
- 再発行：同じ `invites/{email}` を、`expiresAt` を更新して上書きする
- 取り消し：`invites/{email}` を削除する

### 参加（招待された人）
1. リンクを開く → 未ログインなら、Googleでログイン
2. 1バッチで、`members/{自分のuid}` を作成（`role = 'member'`）し、`invites/{自分のメール}` を削除
3. ルールが、自分のメールアドレス宛ての有効な招待があることを検証する
4. 失敗（`permission-denied`）したときは、「このアカウント（{メール}）は、このイベントに招待されていません。招待されたアカウントでログインし直してください」と表示する

### メンバーの削除・抜ける
- オーナー：`members/{uid}` を削除。メンバー：自分の `members/{自分のuid}` を削除（抜ける）
- 削除された人の、画面の購読は `permission-denied` になる。→ イベント一覧に戻す

## 5. ★検証項目（Emulator）

| # | 内容 |
|---|---|
| R1 | 参加時の「メンバー作成＋招待の削除」バッチで、メンバー作成のルールが、削除前の招待を読めること（`get` / `exists` は、バッチ前の状態を見る） |
| R2 | イベント作成バッチの `getAfter(eventDoc).data.ownerUid` が、同じバッチのイベント作成を参照できること |
| R3 | コレクショングループのルール（`/{path=**}/members/{uid}`）が、個別の `members` のルールと、意図どおりに両立すること |
| R4 | `/{sub}/{doc=**}` が、`orders` / `members` / `invites` に影響しないこと（個別の `match` が優先され、他は拒否されること） |
| R5 | 招待のID（メールアドレス。`@` と `.` を含む）が、ルールのパスで使えること |
| R6 | `resource.data.cancelledFrom` が `null` のときの比較が、意図どおりに動くこと |
| R7 | `diff().affectedKeys()` が、値が変わらない項目（例：`readyAt` が `null` のまま）を含まないこと |

## 6. 公開時の追加対策（U5）

- `canCreateEvent()` を緩める前に、App Check を導入する
- 無料枠の使用量の確認（Firebaseコンソール）の運用を決める
- 招待・イベント作成の頻度の制限は、ルールでは難しいため、公開時に別途検討する
