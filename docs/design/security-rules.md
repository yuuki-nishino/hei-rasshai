# セキュリティルールと権限の設計

Firestore のアクセス制御。データの定義は [data-model.md](./data-model.md)、テストは [testing.md](./testing.md)。
状態：初期案。★は、Emulatorで検証する。

## 1. 方針

- **アクセス権は、`events/{e}/members/{uid}` の存在で決まる**。アカウントの種類（許可リストなど）では決めない
- イベントを作れるのは、`creators/{email}` に登録されたアカウントだけ（公開するときは、この条件を緩める）
- メンバーになれるのは、**自分のメールアドレス宛ての、有効な招待がある人**だけ（[ADR-0003](../adr/0003-invite-by-email.md)）。参加と同時に招待が消えることを、ルールで強制する
- お客様（未ログイン）は、**注文1件の取得（`get`）だけ**できる。一覧・検索はできない
- 注文の `items` / `total` / `number` / `day` / `qr` / `createdBy` / `createdAt` は、作成後に誰も変更できない。作成時に、**項目の集合・型・初期値**も検証する（スタッフのメールなどを混ぜられない）
- 注文の状態の遷移は、ルールでも検証する（不正な遷移を拒否）
- 番号の一意性は、カウンターが「ちょうど1ずつ進む」ことと、注文が「そのカウンターの値で作られる」ことで、ルールが担保する
- 「やめる」と遅れた注文の登録の競合は、**墓標（`voids`）**で、時間に頼らずに排他する（[ADR-0004](../adr/0004-void-tombstone.md)）
- 注文は、**イベントの削除中以外は、削除できない**（`events.deleting` フラグ）
- ルールは、**一致したものの OR** で判定される（優先順位はない）。そのため、サブコレクションごとに、明示的に `match` を書き、書いていないものは、すべて拒否する
- ルールの `exists` / `get` は、1回ごとに、読み取り1回として数えられる

## 2. 権限表

| 操作 | 未ログイン | ログイン（非メンバー） | メンバー | オーナー |
|---|---|---|---|---|
| 注文1件の取得 | ○ | ○ | ○ | ○ |
| 注文の一覧・検索 | × | × | ○ | ○ |
| 注文の作成・状態/支払いの更新 | × | × | ○ | ○ |
| 注文の削除 | × | × | × | ○（イベントの削除中のみ） |
| 墓標（`voids`）の作成・取得 | × | × | ○ | ○ |
| メニューの読み書き（削除を含む） | × | × | ○ | ○ |
| カウンター・レジ締めの読み書き | × | × | ○（カウンターは+1のみ） | ○ |
| カウンター・レジ締め・墓標の削除 | × | × | × | ○（イベントの削除中のみ） |
| イベントの取得・更新 | × | × | ○ | ○ |
| イベントの作成 | × | `creators` に登録済みなら○ | － | － |
| イベントの `deleting` の変更 | × | × | × | ○ |
| イベントの削除 | × | × | × | ○（`deleting = true` のとき） |
| メンバーの一覧 | × | × | ○ | ○ |
| メンバーになる | × | 自分宛ての有効な招待があれば○ | － | － |
| メンバーの削除 | × | × | 自分のみ（抜ける） | 他のメンバーのみ。**自分自身は、イベントの削除後のみ** |
| 招待の作成・読み取り・更新 | × | × | × | ○ |
| 招待の削除 | × | 自分宛てのみ（参加するときは、メンバーの作成と同じバッチで削除することを、ルールが強制する） | 自分宛てのみ | ○ |
| 自分のイベント一覧（コレクショングループ） | × | 自分の `members` のみ | 同左 | 同左 |
| `creators` | × | × | × | ×（コンソールのみ） |

## 3. firestore.rules（初期案）

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ---------- 共通 ----------
    function signedIn() { return request.auth != null; }
    function eventPath(e) { return /databases/$(database)/documents/events/$(e); }
    function subPath(e, sub, id) { return /databases/$(database)/documents/events/$(e)/$(sub)/$(id); }
    function myEmail() { return request.auth.token.email.lower(); }

    function isMember(e) { return signedIn() && exists(subPath(e, 'members', request.auth.uid)); }
    function isOwner(e)  { return signedIn() && get(eventPath(e)).data.ownerUid == request.auth.uid; }
    function isDeleting(e) { return get(eventPath(e)).data.deleting == true; }
    // イベントがあり、削除中でない（参加・招待は、削除中・削除後のイベントでは受け付けない）
    function isActiveEvent(e) { return exists(eventPath(e)) && get(eventPath(e)).data.deleting == false; }

    function canCreateEvent() {
      return signedIn() && request.auth.token.email_verified
          && exists(/databases/$(database)/documents/creators/$(myEmail()));
      // 一般公開するときは、signedIn() だけにする（＋App Check）
    }

    function validDay(d) { return d is string && d.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$'); }

    function okTransition(from, to) {
      return from == to
          || (from == 'preparing' && to in ['ready', 'cancelled'])
          || (from == 'ready'     && to in ['done', 'preparing', 'cancelled'])
          || (from == 'done'      && to in ['ready', 'cancelled'])
          || (from == 'cancelled' && to in ['preparing', 'ready', 'done']);
    }

    function validEvent(d) {
      return d.keys().hasOnly(['name', 'startDate', 'endDate', 'floatCash', 'ownerUid', 'deleting', 'createdAt'])
          && d.name is string && d.name.size() >= 1 && d.name.size() <= 60
          && validDay(d.startDate) && validDay(d.endDate) && d.startDate <= d.endDate
          && d.floatCash is int && d.floatCash >= 0 && d.floatCash <= 10000000
          && d.deleting is bool;
    }

    function validMenu(d) {
      return d.keys().hasOnly(['name', 'price', 'order', 'soldOut'])
          && d.name is string && d.name.size() >= 1 && d.name.size() <= 40
          && d.price is int && d.price >= 1 && d.price <= 100000
          && d.order is number && d.soldOut is bool;
    }

    function validClosing(d, day) {
      return validDay(day)
          && d.keys().hasOnly(['floatCash', 'expectedCash', 'actualCash', 'diff', 'note', 'closedAt', 'closedBy'])
          && d.floatCash is int && d.floatCash >= 0
          && d.expectedCash is int && d.actualCash is int && d.actualCash >= 0
          && d.diff is int && d.diff == d.actualCash - d.expectedCash
          && d.note is string && d.note.size() <= 200
          && d.closedAt == request.time && d.closedBy == request.auth.uid;
    }

    // ---------- イベント ----------
    match /events/{eventId} {
      allow get: if isMember(eventId);
      allow create: if canCreateEvent()
        && validEvent(request.resource.data)
        && request.resource.data.ownerUid == request.auth.uid
        && request.resource.data.deleting == false
        && request.resource.data.createdAt == request.time
        // 同じバッチで、自分の members（role = owner）を作る。作らないと、オーナーにも見えないイベントになる
        && getAfter(subPath(eventId, 'members', request.auth.uid)).data.role == 'owner';
      allow update: if isMember(eventId)
        && validEvent(request.resource.data)
        && request.resource.data.ownerUid == resource.data.ownerUid
        && request.resource.data.createdAt == resource.data.createdAt
        && (request.resource.data.deleting == resource.data.deleting || isOwner(eventId));
      allow delete: if isOwner(eventId) && resource.data.deleting == true;

      // ---------- メンバー ----------
      match /members/{uid} {
        allow get, list: if isMember(eventId);
        allow create: if signedIn() && request.auth.uid == uid
          && request.resource.data.keys().hasOnly(['uid', 'role', 'displayName', 'email', 'joinedAt'])
          && request.resource.data.uid == uid
          && request.resource.data.email == myEmail()
          && request.resource.data.joinedAt == request.time
          && request.resource.data.displayName is string
          && request.resource.data.displayName.size() <= 60
          && (
            // オーナー：イベントの ownerUid が自分なら作れる（作成は、イベントと同じバッチで行う。
            // バッチの外でも作れるが、オーナーはイベントがある間は抜けられないため、害はない）
            (request.resource.data.role == 'owner'
              && getAfter(eventPath(eventId)).data.ownerUid == uid)
            // メンバー：自分のメールアドレス宛ての有効な招待があり、同じバッチで招待が削除される
            || (request.resource.data.role == 'member'
              && isActiveEvent(eventId)
              && request.auth.token.email_verified
              && exists(subPath(eventId, 'invites', myEmail()))
              && request.time < get(subPath(eventId, 'invites', myEmail())).data.createdAt + duration.value(1, 'd')
              && !existsAfter(subPath(eventId, 'invites', myEmail())))
          );
        allow update: if false;
        allow delete: if signedIn() && (
          // オーナーが、他のメンバーを削除する
          (isOwner(eventId) && uid != request.auth.uid)
          // 本人が抜ける。ただし、オーナー自身は、イベントが無くなった後（削除の最後・孤立の掃除）だけ
          || (request.auth.uid == uid
              && (!exists(eventPath(eventId)) || get(eventPath(eventId)).data.ownerUid != uid))
        );
      }

      // ---------- 招待（有効期限は createdAt から1日。ルールが計算する） ----------
      match /invites/{email} {
        allow read: if isOwner(eventId);
        allow create, update: if isOwner(eventId) && isActiveEvent(eventId)
          && email == email.lower() && email.matches('^[^@]+@[^@]+$')
          && request.resource.data.keys().hasOnly(['createdBy', 'createdAt'])
          && request.resource.data.createdBy == request.auth.uid
          && request.resource.data.createdAt == request.time;
        // オーナーが取り消す。招待された本人は、参加と同時に使い切る
        allow delete: if isOwner(eventId)
          || (signedIn() && request.auth.token.email_verified && myEmail() == email);
      }

      // ---------- 墓標（「やめる」で、その注文IDを以後使えなくする） ----------
      match /voids/{orderId} {
        allow get: if isMember(eventId);
        allow create: if isMember(eventId)
          // 書き込みの後に、注文が無い（同じバッチで、注文と墓標を両方作ることも拒否する）
          && !existsAfter(subPath(eventId, 'orders', orderId))
          && request.resource.data.keys().hasOnly(['createdBy', 'createdAt'])
          && request.resource.data.createdBy == request.auth.uid
          && request.resource.data.createdAt == request.time;
        allow update: if false;
        allow delete: if isOwner(eventId) && isDeleting(eventId);
      }

      // ---------- 注文 ----------
      match /orders/{orderId} {
        // お客様：注文IDを知っている人が、その1件だけ読める（一覧は不可）
        allow get: if true;
        allow list: if isMember(eventId);

        allow create: if isMember(eventId)
          // 書き込みの後に、墓標が無い（墓標は、イベントの削除中以外は消せないため、「前に無い」も意味する）
          && !existsAfter(subPath(eventId, 'voids', orderId))
          && request.resource.data.keys().hasOnly(
               ['number', 'day', 'items', 'total', 'payment', 'status', 'cancelledFrom', 'qr',
                'createdAt', 'readyAt', 'doneAt', 'cancelledAt', 'createdBy', 'updatedBy', 'updatedAt'])
          && request.resource.data.createdBy == request.auth.uid
          && request.resource.data.updatedBy == request.auth.uid
          && request.resource.data.createdAt == request.time
          && request.resource.data.updatedAt == request.time
          && request.resource.data.payment in ['cash', 'paypay']
          && request.resource.data.number is int && request.resource.data.number >= 1
          && validDay(request.resource.data.day)
          && request.resource.data.total is int && request.resource.data.total >= 1
          && request.resource.data.items is list
          && request.resource.data.items.size() >= 1 && request.resource.data.items.size() <= 50
          && request.resource.data.qr is bool
          && request.resource.data.cancelledFrom == null
          && request.resource.data.readyAt == null
          && request.resource.data.cancelledAt == null
          // QRあり → 調理中。QRなし → 確定と同時に渡し済み
          && ((request.resource.data.status == 'preparing' && request.resource.data.qr == true
                 && request.resource.data.doneAt == null)
              || (request.resource.data.status == 'done' && request.resource.data.qr == false
                 && request.resource.data.doneAt == request.time))
          // 番号：カウンターが、同じ書き込みで、ちょうど1だけ進み、その値が number になる
          && (exists(subPath(eventId, 'counters', request.resource.data.day))
                ? get(subPath(eventId, 'counters', request.resource.data.day)).data.n : 0)
               == request.resource.data.number - 1
          && getAfter(subPath(eventId, 'counters', request.resource.data.day)).data.n
               == request.resource.data.number;

        // 作成後に変えられるのは、状態・支払い方法・時刻・更新者だけ
        allow update: if isMember(eventId)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(
               ['status', 'payment', 'cancelledFrom', 'readyAt', 'doneAt',
                'cancelledAt', 'updatedBy', 'updatedAt'])
          && request.resource.data.payment in ['cash', 'paypay']
          && request.resource.data.updatedBy == request.auth.uid
          && request.resource.data.updatedAt == request.time
          && okTransition(resource.data.status, request.resource.data.status)
          // 取り消し以外の状態では、cancelledFrom は null
          && (request.resource.data.status == 'cancelled' || request.resource.data.cancelledFrom == null)
          // 取り消すときは、直前の状態を cancelledFrom に残す
          && (request.resource.data.status != 'cancelled' || resource.data.status == 'cancelled'
              || request.resource.data.cancelledFrom == resource.data.status)
          // 取り消しを戻すときは、取り消し前の状態に戻す
          && (resource.data.status != 'cancelled' || request.resource.data.status == 'cancelled'
              || request.resource.data.status == resource.data.cancelledFrom)
          // 取り消し中のままの更新（支払い方法の変更など）では、cancelledFrom を変えない
          && (request.resource.data.status != 'cancelled' || resource.data.status != 'cancelled'
              || request.resource.data.cancelledFrom == resource.data.cancelledFrom)
          // 時刻は、null・今・変更なし のいずれか
          && (request.resource.data.readyAt == null || request.resource.data.readyAt == request.time
              || request.resource.data.readyAt == resource.data.readyAt)
          && (request.resource.data.doneAt == null || request.resource.data.doneAt == request.time
              || request.resource.data.doneAt == resource.data.doneAt)
          && (request.resource.data.cancelledAt == null || request.resource.data.cancelledAt == request.time
              || request.resource.data.cancelledAt == resource.data.cancelledAt);

        // イベントの削除中だけ
        allow delete: if isOwner(eventId) && isDeleting(eventId);
      }

      // ---------- メニュー ----------
      match /menu/{menuId} {
        allow read: if isMember(eventId);
        allow create, update: if isMember(eventId) && validMenu(request.resource.data);
        allow delete: if isMember(eventId);
      }

      // ---------- 採番カウンター ----------
      match /counters/{day} {
        allow read: if isMember(eventId);
        allow create: if isMember(eventId) && validDay(day)
          && request.resource.data.keys().hasOnly(['n']) && request.resource.data.n == 1;
        allow update: if isMember(eventId)
          && request.resource.data.keys().hasOnly(['n'])
          && request.resource.data.n == resource.data.n + 1;
        allow delete: if isOwner(eventId) && isDeleting(eventId);
      }

      // ---------- レジ締め ----------
      match /closings/{day} {
        allow read: if isMember(eventId);
        allow create, update: if isMember(eventId) && validClosing(request.resource.data, day);
        allow delete: if isOwner(eventId) && isDeleting(eventId);
      }

      // 上に書いていないサブコレクションは、すべて拒否される
    }

    // 自分のイベント一覧用（コレクショングループ）
    match /{path=**}/members/{uid} {
      allow list: if signedIn() && resource.data.uid == request.auth.uid;
    }

    // creators は、クライアントから読み書きできない（既定で拒否）
  }
}
```

### ルールで担保できないこと
- `items` の**各行の中身**（`menuId`・`price`・`qty` の型・範囲）と、`total` との一致：ルールには、リストを繰り返し検査する構文がない。`total` が1以上の整数であることと、行数だけを検査する
- 注文を作らずに、カウンターだけを進めること（番号が欠ける。重複はしない）
- **同じバッチ（トランザクション）の中で、複数の注文を、同じ番号で作ること**：カウンターは、1回の書き込みで1つしか進められないが、ルールは、注文ごとに「前の値＋1 ＝ 後の値 ＝ 番号」を確かめるだけのため、同じ書き込みの中の、ほかの注文までは見えない。アプリの確定（1回に1件）では起こらない。メンバーが、わざと行った場合に限られる（メンバーは信頼する前提。#4 で確認）
- メニューが100件を超えること：クライアントで制限する
- 1日（`day`）を、端末の日付と一致させること：メンバーを信頼する

## 4. 参加・招待・イベント作成の流れ

### イベント作成（1バッチ）
1. `events/{eventId}` を作成（`ownerUid = 自分のuid`、`deleting = false`、`createdAt = serverTimestamp`）
2. `events/{eventId}/members/{uid}` を作成（`role = 'owner'`）
- ルールは、`canCreateEvent()` と、`getAfter` による**両方向**の対応を検証する：オーナーの `members` は、イベントの `ownerUid` が自分のときだけ作れる。イベントは、同じバッチで、自分の `members`（`role = 'owner'`）を作るときだけ作れる（[PR #26 レビュー](../reviews/pr-26-rules-review.md) P2）

### 招待（オーナー）
1. 相手のGoogleメールアドレス（小文字）を入力
2. `invites/{email}` を作成（`createdBy`、`createdAt = serverTimestamp`）。**有効期限は、`createdAt` の1日後**（ルールが参加時に計算するため、期限の項目は持たない）
3. 画面にリンク `{origin}/join?e={eventId}` を表示。コピーして、相手に送る
- 再発行：同じ `invites/{email}` の `createdAt` を、`serverTimestamp` で更新する（期限が、その時点から1日になる）
- 取り消し：`invites/{email}` を削除する
- 削除中（`deleting = true`）のイベントでは、招待の作成・再発行はできない（削除はできる。イベントの削除の手順で、招待を消すため）

### 参加（招待された人）
1. リンクを開く → 未ログインなら、Googleでログイン（`prompt: 'select_account'`）
2. すでにメンバーか確認する（`members/{自分のuid}` を `get`）。メンバーなら、そのイベントを選択して終了
3. 1バッチで、`members/{自分のuid}` を作成（`role = 'member'`）し、`invites/{自分のメール}` を削除する
4. ルールが、自分のメールアドレス宛ての有効な招待があることと、**同じバッチで招待が削除されること**（`!existsAfter`）を検証する。**イベントが削除中・削除後なら、招待があっても参加できない**（[PR #26 レビュー](../reviews/pr-26-rules-review.md) P1。削除の途中で、メンバーが増えないようにする）
5. 失敗（`permission-denied`）したときは、「このアカウント（{メール}）では、このイベントに参加できません。招待されたアカウントでログインし直してください。招待の期限（発行から1日）が切れている場合は、オーナーに再発行を頼んでください」と表示する

### メンバーの削除・抜ける
- オーナー：他のメンバーの `members/{uid}` を削除。メンバー：自分の `members/{自分のuid}` を削除（抜ける）。**オーナーは抜けられない**（イベントの削除のみ）
- 削除された人の、画面の購読は `permission-denied` になる。→ イベント一覧に戻す。端末のキャッシュも消す（[data-access.md](./data-access.md) §8）

### イベントの削除
1. オーナーが、`events/{eventId}.deleting = true` にする
2. 配下を削除する（順序は [data-access.md](./data-access.md) §7）。注文・カウンター・レジ締め・墓標の削除は、`deleting = true` のときだけ許可される
3. イベントを削除し、最後に、自分の `members` を削除する（イベントが無くなった後は、ルールが許可する）

## 5. ★検証項目（Emulator）

| # | 内容 |
|---|---|
| R1 | 参加時の「メンバー作成＋招待の削除」バッチで、メンバー作成のルールが、削除前の招待を `get` / `exists` で読めること、`existsAfter` が `false` になること。招待を削除しないバッチは拒否されること |
| R2 | イベント作成バッチの `getAfter(eventPath).data.ownerUid` が、同じバッチのイベント作成を参照できること |
| R3 | コレクショングループのルール（`/{path=**}/members/{uid}`）が、個別の `members` のルールと、意図どおりに両立すること |
| R4 | **ルールは一致したものの OR で判定される**ことを前提に、未知のサブコレクション（`events/{e}/foo/x`）への読み書きが、拒否されること |
| R5 | 招待のID（メールアドレス。`@` と `.` を含む）が、パスで使えること。`lower()`・`matches()` が意図どおりに動くこと |
| R6 | `resource.data.cancelledFrom` が `null` のときの比較が、意図どおりに動くこと |
| R7 | `diff().affectedKeys()` が、値が変わらない項目（例：`readyAt` が `null` のまま）を含まないこと |
| R8 | **墓標の排他**：「`voids` を作成 → 注文の作成」と「注文を作成 → `voids` の作成」の、両方の順序で、後の書き込みが拒否されること。同じ `orderId` で、注文を作るトランザクションと、`voids` を作るトランザクションが、競合したときに、どちらか一方だけが成功すること。**ただし、Emulatorは、本番と同じ並行性を再現するとは限らない**。安全性の本質は、「順序の2ケース」と、「コミット時にルールが評価されること＋読み取った文書の前提条件」にある。競合のテストは、補助的な確認とする |
| R9 | 番号のルール：`exists(...) ? get(...).data.n : 0` の三項演算子、トランザクション内の `getAfter`（カウンターを進めない注文の作成が拒否されること、同じ番号の2件目が拒否されること） |
| R10 | 文字列の比較（`startDate <= endDate`）、`timestamp + duration` の比較が、意図どおりに動くこと |
| R11 | `request.time` と `serverTimestamp()` の一致（バッチ・トランザクション内、およびオフラインで溜めた更新が、後から届いたとき） |

### 検証の結果（Emulator）

| # | 結果 | 確かめたテスト（`test/rules/`） |
|---|---|---|
| R1 | ✅ #3。メンバー作成のルールは、同じバッチで削除する前の招待を `exists` / `get` で読め、`existsAfter` は `false` になる。招待を削除しないバッチは拒否される | members：34・35 |
| R2 | ✅ #3。`getAfter(eventPath)` は、同じバッチで作るイベントを参照できる。イベントが無い状態で、オーナーの `members` だけを作ることはできない | events：29 |
| R3 | ✅ #3。自分の uid の条件なら `list` でき、他人の uid・条件なしは拒否。**このルールは、コレクショングループのクエリだけでなく、個別のイベントの `members` の `list` にも効く**（非メンバーでも、`where('uid', '==', 自分)` なら許可される）。下の「R3 の安全性の確認」のとおり、情報は漏れないため、許容する | members：47、R3 の抜け道 |
| R4 | ✅ #3。`events/{e}/foo/x`、`members` のさらに下、トップレベルの未知のコレクションは、メンバー・オーナーでも拒否 | misc：51 |
| R5 | ✅ #3。`.`・`+`・サブドメインを含むメールアドレスを、IDに使える。大文字を含むID、`@` が0個・2個のIDは拒否。トークンのメールの大文字は、`lower()` で照合できる | invites、members、events |
| R6 | ✅ #4。`cancelledFrom` が `null` の注文で、`status == resource.data.cancelledFrom` は `false` になり、取り消し前と違う状態へ戻す更新は拒否される。取り消し以外の状態で `cancelledFrom` に値を入れる、取り消し中のまま書き換える、も拒否 | orders：19〜21 |
| R7 | ✅ #4。`diff().affectedKeys()` は、値が変わらない項目（`total` を同じ値で書く、`readyAt` が `null` のまま）を含まない。値を変えると拒否 | orders：16 |
| R8 | ✅ #4。「墓標 → 注文」「注文 → 墓標」の両方の順序で、後の書き込みが拒否される。**同じバッチで、注文と墓標を両方作る**ことも拒否する（`!exists` を `!existsAfter` にした。下記）。確定とやめるのトランザクションを並行して5回実行し、注文と墓標が並存しないことも確かめた（補助） | voids：24〜26 |
| R9 | ✅ #4。三項演算子（カウンターが無ければ 0）で、その日の最初の注文が1番になる。トランザクション・バッチの中の `getAfter` で、カウンターを進めない・2つ進める・番号と合わない・同じ番号の2件目、は拒否される | orders：7・13〜15、カウンター：48 |
| R10 | ✅ #3（イベント・招待の部分）。`startDate > endDate` は拒否。`createdAt + duration.value(1, 'd')`：23時間前の招待は有効、25時間前は無効 | events：31、members：34・36 |
| R11 | ✅ #3（バッチ）・#4（トランザクション）。バッチ・トランザクション内の `serverTimestamp()` は `request.time` と一致する。クライアントの時刻は拒否。**オフラインで溜めた更新は、M7（データアクセスの結合テスト §4 の13）で確かめる** | events・members・invites・orders・voids |

**R3 の安全性の確認**（#3）

Firestore のルールは「フィルターではない」。検索の条件だけで、読めない文書が結果に混ざらないと証明できない検索は、**結果を絞るのではなく、検索ごと拒否する**（PostgreSQL の RLS は、条件に合わない行を、黙って結果から除く。ここが違う）。そのため、「uid が自分」と証明できる検索だけが通る。攻撃する側の目線で、次を確かめた。

| 試したこと | 結果 |
|---|---|
| `in` に他人の uid を混ぜる、`!=`・範囲（`>=`）で探す | 拒否 |
| `role`・`email` など、uid 以外の項目で探す、条件なし | 拒否 |
| 自分の uid に、別の条件を足す | 許可。結果は自分の文書だけ（非メンバーなら空） |
| 存在するイベント／存在しないイベントの `members` を、自分の uid で探す | どちらも空。**イベントの有無は分からない** |
| 他人の `members` を1件 `get` | 拒否（このルールは `list` だけ） |
| メンバーから外された人が、自分の uid で探す | 外されたイベントは返らない（文書が消えているため） |
| どこかの `members`（トップレベル、`foo/x/members`、`members` の下の `members`）に書き込む | 拒否（このルールは `list` だけで、書き込みを許可しない） |

- 結論：非メンバーが知り得るのは、**「自分は、そのイベントのメンバーではない」という、自分自身のことだけ**。他人の情報・イベントの有無は、分からない
- 前提：`members` の `uid` の項目は、ドキュメントIDと一致する（作成のルールが `uid == ドキュメントID` を強制する）。**Firebaseコンソールで、手で `members` を作るときは、この一致を守る**（守らないと、ある uid の文書として、別の人の文書が見えることがあり得る）
- 無料枠：空の結果でも、検索1回につき、読み取り1回として数えられる。ログインが必要なため、誰でもできる注文の `get`（§6）より、悪用の余地は小さい。同じく、当面は許容する

- テストが、ルールの要の行を本当に検査していることを、ルールをわざと壊して確かめた（#3）：`!existsAfter`・招待の期限・オーナーの自己削除の制限・コレクショングループの uid 条件・`creators` の照合・`deleting` の制限を、それぞれ消すと、テストが失敗する。未知のサブコレクションを許可すると、テストが失敗する。PR #26 のレビューで足した行（参加・招待の `isActiveEvent`、イベントの作成の `getAfter(members).role`）も、同じく、消すとテストが失敗する
- #4 で足したルール（注文・墓標・メニュー・カウンター・レジ締め）も、要の行を1つずつ無効にして確かめた。墓標の排他（両方向）、注文の作成の `createdBy`・`updatedBy`・時刻・支払い・`total`・行数・初期値（`cancelledFrom`・`readyAt`・`cancelledAt`）、更新の遷移・`cancelledFrom`・`updatedBy`・`updatedAt`・支払い、カウンターの +1、メニューの価格・名前、レジ締めの `diff`・`closedAt`/`closedBy`・メモの長さは、消すとテストが失敗する
  - 消してもテストが通った3行は、**ほかの条件が同じことを保証する、重ねがけ**のため、残す：`number is int && number >= 1`（カウンターは1以上なので、「前の値＋1 ＝ 番号」から導かれる）、`validDay(day)`（その日のカウンターは、IDが日付の形式でないと作れない）、`qr is bool`（状態の条件が、`qr == true` か `qr == false` を求める）

**墓標の排他を `!existsAfter` にした理由**（#4）
- 設計の初期案は、`!exists`（書き込みの**前**の状態）だった。これだと、**同じバッチで、同じ `orderId` の注文と墓標を両方作る**と、どちらのルールも「相手は、まだ無い」と判断し、両方が通る（テストで確かめた）
- `!existsAfter`（書き込みの**後**の状態）なら、相手が同じバッチで作られることも見える。墓標・注文は、イベントの削除中以外は消せないため、「後に無い」は「前にも無い」を含む。読み取りの回数は変わらない
- アプリの確定・やめるは、どちらか一方しか書かないため、これまでも起こらない。メンバーがわざと行う場合への備え（[ADR-0004](../adr/0004-void-tombstone.md) の追記）

## 6. 想定するリスクと、公開時の追加対策

- **注文の `get` は誰でもできる**ため、注文IDを知る人が、読み取りを繰り返すと、**全イベント共通の無料枠**（読み取り5万／日）を使い切れる（SPEC 7.2）。注文IDは、推測できない20文字なので、実際に行えるのは、QRを持つ人だけ。当面は、許容する
- 一般公開の前（U5）：
  - `canCreateEvent()` を緩める前に、App Check を導入する。**お客様画面にも**導入を検討する
  - 無料枠の使用量の確認（Firebaseコンソール）の運用を決める
  - 招待・イベント作成の頻度の制限は、ルールでは難しいため、別途検討する
