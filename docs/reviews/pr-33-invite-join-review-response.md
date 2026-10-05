# PR #33 のレビューへの対応

[PR #33 のレビュー](./pr-33-invite-join-review.md) の指摘について、反映するもの・見送るものを、理由とともに整理する。

- 日付：2026-10-05
- 判断：**採用**＝指摘どおり反映／**修正して採用**＝方針は採用し、やり方を変えた／**対応不要**＝すでに満たしている／**見送り**＝反映しない
- 反映先の略称：DA＝`design/data-access.md`、TS＝`design/testing.md`、T＝テスト
- すべて、PR #33 の中で反映した

| # | 判断 | 内容と理由 | 反映先 |
|---|---|---|---|
| J1 | **採用（範囲を広げた）** | オンライン必須の書き込みの完了を、8秒で打ち切る（`withTimeout`。時間切れは `AppError('timeout')`＝「送れていません」）。レビューの指摘の `joinEvent` に加え、参考に挙がった `createEvent` と、同じ形の `createInvite`・`cancelInvite` にも入れた。送信待ちが端末に残り、あとで通ることは避けられないため、画面の案内をそれぞれに合わせた：参加は「もう一度」（まずメンバーかを確かめるので、二重にならない）、イベントの作成は「もう一度作成する前に、一覧で確かめてください」（押し直すと二重になり得る）、招待は「招待中の一覧を確かめてください」（同じ文書の上書きなので、二重にならない） | `lib/data/events.ts`・`members.ts`、`staff/join/JoinPage.tsx`・`event/CreateEventPage.tsx`・`members/InvitePanel.tsx`、DA §3.9、TS §4、T |
| J2（再レビュー） | **採用** | 参加のバッチが `permission` で失敗したら、`getDocFromServer(members/{自分})` で1回だけ確かめ直し、メンバーなら `'already'` を返す。前回の時間切れで残った送信待ちが、今回の確認の後に先に通ると、今回のバッチは既存のメンバーの上書き（ルールは `update: if false`）として拒否されるため。確かめ直しも失敗したときは、元の `permission` を返す | `lib/data/events.ts`、DA §3.2、T |

## 確認

- 結合テスト：22件（J1 +2、J2 +1）。J2 は、最初の確認を `permission-denied` にし、サーバーにはメンバーがある状態を作って、`already` になることを確かめた。直した行を外すと、このテストが失敗することも確かめた。`getDocFromServer` の後に `disableNetwork` を差し込み、確認の直後に通信が切れる場合を作った。`joinEvent`・`createEvent` が、止まらずに `timeout` になることを確かめた。参加は、つながり直すと送信待ちが通り、もう一度呼ぶと `already` になることも確かめた（既知の制約の確認）
