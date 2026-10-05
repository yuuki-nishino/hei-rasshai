# PR #34 のレビュー（メンバー管理と、キャッシュの消去）

- 日付：2026-10-05
- 対象：[PR #34](https://github.com/yuuki-nishino/maido-ookini/pull/34)（#9。`src/lib/data/cache.ts`、`src/state/cacheClear.ts`、`src/state/myEvents.ts` など）。レビュー時の HEAD は `d8c1d19`
- 観点：正しさ（バグ）
- 重大度：🔴 高（SPEC違反・データ不整合・権限の漏れ）／🟠 中／🟡 低／ℹ️ 情報

## 結論

**この PR で、K1 と K2 を直すことを勧める。**

- K1：別のタブを開いたまま消去すると、そのタブが、黙って使えなくなる
- K2：消去が失敗し続ける端末では、再読み込みが止まらなくなる

どちらも、キャッシュの消去が「別のタブがあると失敗する」という前提で作られていることから来ている。しかし、実際の SDK は、そのようには動かない。

| # | 重大度 | 内容 |
|---|---|---|
| K1 | 🟠 中 | 消去は、別のタブがあっても失敗しない。SDK が、別のタブの Firestore を終了させる。そのタブは、再読み込みされないまま使えなくなる |
| K2 | 🟠 中 | 消去が失敗すると、印を残したまま再読み込みする。起動時にまた消去を試すため、再読み込みが止まらない |
| K3 | 🟡 低 | 消去待ちの印から、イベントが外れない。メンバーに戻っても、消去が終わるまで、そのイベントを開けない |

## 指摘

### K1 🟠 消去は、別のタブがあっても失敗しない。別のタブが、黙って使えなくなる

**場所**：`src/lib/data/cache.ts:21-32`（`clearLocalCache`）、`src/state/cacheClear.ts:13`・`:81-106`（`hei:clearOnStart`）

**問題**：
- `clearLocalCache` の JSDoc（23行目）は、「別のタブが開いていると消せない（failed-precondition → AppError('conflict')）」としている。設計書（data-access.md §8、248行目）も、同じ前提で `hei:clearOnStart` を持ち越す
- スタッフ用の `db` は、`persistentMultipleTabManager` を使う（`src/lib/firebase/staff.ts:27`）。この設定の SDK（`@firebase/firestore` の `common-*.esm.js`）は、次のように動く
  - どのタブも、起動時に `persistence.setDatabaseDeletedListener(() => e.terminate())` を登録する（「When a user calls clearPersistence() in one client, all other clients need to be terminated to allow the delete to succeed.」）
  - IndexedDB の削除で `versionchange`（`newVersion === null`）が届くと、そのタブの Firestore を `terminate` する
- そのため、別のタブがあっても消去は**成功し**、別のタブの Firestore は、知らせのないまま終了する

**起こりうること**：スタッフが、アプリを2つのタブ（または、PWAとブラウザ）で開いている。タブAでログアウトする。または、タブAでイベントから外れたことが分かり、キャッシュが消される。

**結果**：
- タブAは、再読み込みされる。タブBは、再読み込みされず、Firestore が終了したまま残る
- タブBでは、購読の更新が黙って止まる（調理画面などが古いまま）。書き込みは「The client has already been terminated.」で失敗し、画面には、内容のはっきりしない失敗の表示が出る。同じタブでログインし直しても、直らない
- `hei:clearOnStart` の持ち越し（`cacheClear.ts:13`、`:86-89`、`:95-106`）は、起きない失敗のための処理になっている

**直し方の案**：
- 消去の前に、`BroadcastChannel` で、ほかのタブに「消去する」と知らせ、受け取ったタブは再読み込みする。再読み込みした先では、キャッシュが消えているか、消去中なので、起動時の処理に任せる
- `clearLocalCache` の JSDoc と、data-access.md §8 の「別のタブが開いていて消せないとき」を、実際の動き（別のタブは終了させられる）に合わせて直す。`hei:clearOnStart` が要らなくなるなら、外す
- 直す前に、dev で、タブを2つ開いて再現するかを確かめるとよい（SDK のコードを読んだ結果で、実機では確かめていない）

### K2 🟠 消去が失敗し続けると、再読み込みが止まらない

**場所**：`src/state/cacheClear.ts:68-78`（`clearAndReload`）、`:107`（`clearCacheOnStart`）

**問題**：
- `clearAndReload` は、消去に失敗しても、印（`hei:clearPending`）を残したまま `location.reload()` する（74行目のコメント「印を残し、次の起動時にもう一度試す」）
- 再読み込みの後、`clearCacheOnStart` → `tryClearCache` は、未送信が無ければ `decideCacheClear` で `'clear'` と判断し、また `clearAndReload` に進む
- やり直しの回数にも、「1回の起動につき1回まで」にも、上限が無い

**起こりうること**：IndexedDB の削除が、毎回失敗する端末。たとえば、Safari のプライベートブラウズでの IndexedDB のエラーや、iOS の IndexedDB の不具合。

**結果**：再読み込みが繰り返され、利用者は止められない。サイトのデータを手で消すまで、アプリが使えない。

なお、`hei:clearOnStart` の経路（95-106行目）は、先に印を消してから試すため、繰り返さない。

**直し方の案**：
- 失敗したら、`sessionStorage` などに「この起動では試した」と残し、同じセッションの再読み込みの後は、自動では試さない。または、失敗の回数を数え、上限を超えたら、確認（`cacheClearAsk` と同じような表示）に切り替える
- 失敗したときは、再読み込みせずに、そのまま一覧に戻す、という手もある。ただし、`terminate(db)` の後に失敗した場合、`db` はもう使えないため、再読み込みは要る。その場合は、上の「1回まで」と組み合わせる

### K3 🟡 消去待ちの印から、イベントが外れない

**場所**：`src/state/cacheClear.ts:35-44`（`onServerMembership`）、`src/state/myEvents.ts:44-49`

**問題**：
- 印の `events` は、`mergeClearMark` で足されるだけで、外されることがない。外れるのは、消去が終わったとき（`setMark(null)`）だけ
- `subscribeMyEvents` は、印にあるイベントを一覧から隠し、選んでいれば選択を外す（49行目）。サーバーの `memberOf` に、そのイベントが戻っていても変わらない

**起こりうること**：未送信の書き込みが残ったまま、e1 から外される。印に e1 が入り、消去は後回しになる。そのあと、オーナーが招待し直し、本人が `/join` から参加し直す。

**結果**：参加し直したのに、e1 が一覧に出ず、開いても一覧に戻される。消去が終わるまで（未送信が流れるまで、または、24時間たって確認を取るまで）、e1 を使えない。

**直し方の案**：`onServerMembership` で、`memberOf` にあるイベントを、印の `events` から外す。空になったら、印を消す（`setMark(null)`）。`lib/domain/cacheClear.ts` に、純粋関数として足すと、単体テストで確かめやすい。

## 問題なしと確認した点

- `hasPendingWrites` は、確かめられないとき（例外・時間切れ）に、「未送信あり」（消さない側）に倒している
- 外れたことの判定（`onServerMembership`）は、`fromCache` でない、サーバーの一覧だけで行っている（`myEvents.ts:51`）
- `hei:clearOnStart` の経路は、先に印を消してから試すため、繰り返しにならない
