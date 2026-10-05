# PR #34 のレビューへの対応

[PR #34 のレビュー](./pr-34-members-review.md) の各指摘について、反映するもの・見送るものを、理由とともに整理する。

- 日付：2026-10-05
- 判断：**採用**＝指摘どおり反映／**修正して採用**＝方針は採用し、やり方を変えた／**対応不要**＝すでに満たしている／**見送り**＝反映しない
- 反映先の略称：DA＝`design/data-access.md`、SC＝`design/screens.md`、T＝テスト
- すべて、PR #34 の中で反映した

| # | 判断 | 内容と理由 | 反映先 |
|---|---|---|---|
| K1 | **採用** | まず、手元の SDK（`@firebase/firestore` の `common-*.esm.js`）で、指摘どおりであることを確かめた（`setDatabaseDeletedListener` が、`versionchange` の `newVersion === null` で `terminate` する）。消す前に、`BroadcastChannel`（`hei-cache`）で、ほかのタブに「消去する」と知らせ、受け取ったタブは再読み込みするようにした。`clearLocalCache` の JSDoc と、DA §8 の誤った前提（別のタブがあると消せない）を直した。Emulator につないだ画面で、2つのタブを開き、片方でログアウトすると、もう片方も再読み込みされ、ログイン画面になることを確かめた。`hei:clearOnStart` は、IndexedDB そのもののエラーで消せなかったときのために残す（K2 の一度きりの扱いと組み合わせる） | `lib/data/cache.ts`、`state/cacheClear.ts`、DA §8 |
| K2 | **採用** | 消去に失敗したら、`sessionStorage` に `hei:clearFailed` を残し、同じセッションの間は、自動の消去（一覧に戻ったとき・起動時・外れたことが分かったとき）を試さない。`terminate` の後に失敗したときは、`db` が使えないため、再読み込みはする（再読み込みの後は、試さないので、繰り返さない）。印は残し、次のセッションで試す | `state/cacheClear.ts`、`state/storage.ts`、DA §8、SC §1.3 |
| K3 | **採用** | `onServerMembership` で、サーバーの `memberOf` にあるイベントを、印から外す（`pruneClearMark`。空になったら印を消す）。純粋関数として `lib/domain/cacheClear.ts` に足し、単体テストで確かめた | `lib/domain/cacheClear.ts`、`state/cacheClear.ts`、DA §8、T（単体 +2） |
| K4（再レビュー） | **採用** | `subscribeMyEvents` で、サーバーの一覧なら、`onServerMembership`（印からの除外と、外れたことの記録）を、`hidden` を読む前に呼ぶようにした。新しく外れたイベントは、もともと一覧に無いため、絞り込みの結果は変わらない。外されたイベントを開いていた場合に、すぐ消去を試す動きも変わらない（選択を外す前に呼ぶため、`lost.includes(current)` で判断される） | `state/myEvents.ts` |
| K5（再レビュー） | **採用** | `pruneClearMark` は、何も外さなければ同じ `mark` を返す。印がある間に、一覧が届くたびに保存し直さないようにした。単体テスト「変わらなければ同じオブジェクト」を足した | `lib/domain/cacheClear.ts`、T（単体 +1） |

## 確認

- 単体テスト：64件（`pruneClearMark` ×3 を追加。うち1件は再レビュー K5）。型・Lint は通過
- K1：Emulator につないだ画面で、2つのタブを使って確認した（上記）。K2 は、IndexedDB の削除の失敗を手元で起こしにくいため、コードの確認だけ
