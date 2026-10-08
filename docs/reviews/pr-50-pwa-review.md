# PR #50 のレビュー（Service Workerとホーム画面への追加）

- 日付：2026-10-08
- 対象：[PR #50](https://github.com/yuuki-nishino/maido-ookini/pull/50)（#20。`vite.config.ts` の `staffPwa`、`src/staff/main.tsx`、`index.html`、`scripts/build.mjs`、DESIGN.md §8、testing.md §5）
- 観点：正しさ（バグ）
- 重大度：🔴 高（SPEC違反・データ不整合・権限の漏れ）／🟠 中／🟡 低／ℹ️ 情報
- 確認したこと：コードの差分を読んだ。PRのブランチ（`feature/#20-pwa`）を別の作業ツリーでビルドし（`node scripts/build.mjs development`）、`dist/index.html`・`dist/sw.js`・`dist/manifest.webmanifest` を確かめた。ビルドは成功し、ビルドの検査（★W1）も通った。テストは動かしていない。実機（Service Workerの実際の動き、機内モード、ホーム画面アプリ）は確かめていない。PR本文の未確認の3項目（devの実機）も、このレビューの範囲外

## 結論

**🔴・🟠の指摘は無い。** `/s`・`/customer.html`・`/__/` がナビゲーションのフォールバックから外れていること、事前キャッシュにお客様用のファイルが入っていないこと、`sw.js` が `no-cache` で配信されることは、ビルドの出力と `firebase.json` で確かめた。W1の趣旨は守られている。W1（実機）と U1 の確認は、PR本文のとおり、マージ前に必要。

| # | 重大度 | 内容 |
|---|---|---|
| W1 | 🟡 低 | ビルド後の `dist/index.html` に、`<link rel="manifest">` が2つ入る |
| W2 | 🟡 低 | 新しい版への切り替えが「すべての画面を閉じたあと」だけで、再読み込みでは切り替わらない。スタッフに伝わる手段が無い |
| W3 | ℹ️ 情報 | `npm run dev`・`dev:emu` では、`/manifest.webmanifest` が存在せず、`index.html` が返る |
| W4 | ℹ️ 情報 | 事前キャッシュに、同じファイルが2回入る。ビルドの検査は、文字列の一致に頼っている |

## 指摘

### W1 🟡 manifest の `<link>` が重複する

**場所**：`index.html:7`、`vite.config.ts`（`staffPwa`）

**問題**：`index.html` に手書きした `<link rel="manifest" href="/manifest.webmanifest" />` に加えて、`vite-plugin-pwa` が、ビルド時に同じ `<link>` を `</head>` の前へ足す。実際にビルドした `dist/index.html` に、2つ入っていた。

**起こりうること**：動作上の実害は、ほぼ無い（同じURLを指す）。ただし、ブラウザによっては、2回の取得や警告になる。また、手書きのほうは、`npm run dev` では存在しないファイルを指す（W3）。

**直し方の案**：手書きの `<link rel="manifest">` を消す（プラグインに任せる）。または、プラグイン側で `injectRegister` と別の項目（`manifest` の注入）を止める設定を調べて、手書きに一本化する。`apple-touch-icon` は、プラグインが足さないので、手書きのままでよい。

### W2 🟡 新しい版が、再読み込みでは切り替わらない

**場所**：`vite.config.ts`（`registerType: 'prompt'`、`skipWaiting`・`clientsClaim` なし）、DESIGN.md §8

**問題**：新しい Service Worker は、`waiting` のまま、開いている画面（タブ・ホーム画面アプリ）がすべて閉じるまで有効にならない。再読み込みでは切り替わらない。ホーム画面アプリや、開きっぱなしのタブでは、「全部閉じる」ことが、ほとんど起きない。画面側にも、更新を促す表示や、`SKIP_WAITING` を送る処理が無い（生成された `sw.js` には、`SKIP_WAITING` を受ける処理がある）。

**起こりうること**：デプロイしたあと、スタッフが「再読み込みしたから新しい版のはず」と思っても、古い版のままになる。不具合の修正や、ルール・データの形の変更が、端末に届かない。イベント当日に、端末ごとに版が違う状態が、長く続くおそれがある。

**直し方の案**：
- 設計の意図（動作中の画面を、途中で入れ替えない）は保ったまま、運用で補う。DESIGN.md §9 に、「デプロイしたら、全端末で、アプリを完全に閉じてから開き直す」を書く
- または、後続のIssueで、「新しい版があります。更新」の表示（`SKIP_WAITING` を送って再読み込み）を足す。レジ中は押さないで済む
- いずれの場合も、どの版が動いているかが分かるように、画面のどこかに版を出すと、確かめやすい

### W3 ℹ️ 開発サーバーで、manifest が壊れる

**場所**：`index.html:7`

**問題**：`npm run dev`・`npm run dev:emu` では、プラグインの出力が無い。`/manifest.webmanifest` へのアクセスは、開発サーバーの既定のフォールバックで `index.html`（HTML）が返り、ブラウザのコンソールに、manifest の解析エラーが出る可能性がある。

**直し方の案**：W1で手書きの `<link>` を消せば、同時に解消する。

### W4 ℹ️ 事前キャッシュの重複と、ビルドの検査の前提

**場所**：`vite.config.ts`（`globPatterns`）、`scripts/build.mjs:48`

**確認したこと**：
- 生成された `sw.js` の事前キャッシュに、`icons/icon-192.png`・`icon-512.png`・`icon-maskable-512.png`・`manifest.webmanifest` が、2回ずつ入っていた（`globPatterns` の `png`・`webmanifest` と、プラグインが足す manifest のアイコンの両方に当たるため）。同じ `revision` なので、Workbox のエラーにはならず、実害は無い。`png` と `webmanifest` を `globPatterns` から外せば、重複は減る（ただし、`apple-touch-icon` は、残す必要がある）
- ビルドの検査は、`sw.js`（圧縮済み）の文字列に頼る（`url:"…"` と、`^\/s(\/|\?|$)` の一致）。Workbox や minify の出力の形が変わると、検査が「空」で失敗する（安全側）。ただし、`denylist` の正規表現は、書き方が変わっても意味が同じなら、検査が通らなくなる。壊れるときは、必ず失敗する側なので、現状は、許容できる

## よかった点

- 最初のビルド（スタッフ用）で `sw.js` を作るため、お客様用の成果物が、事前キャッシュに入らない構造になっている（検査もある）
- `no-cache` が、`sw.js`・`workbox-*.js` にも効いており、更新の確認が毎回行われる
- `/__/`（Googleログインのリダイレクト）を、フォールバックから外している
