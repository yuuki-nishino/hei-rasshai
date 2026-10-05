# 毎度おおきに（maido-ookini）設計書

[SPEC.md](./SPEC.md) の要件を実現するための設計の全体像。詳細は、`design/` の各文書に分ける。
状態：初期案。★は、実装前に Emulator や実機で検証する項目。

## 1. 全体像

```
[お客様のスマホ]                      [スタッフの端末（1台が基本）]
  /s?e=&o=（QR）                         / （Google ログイン）
  customer.html（軽い別エントリ）         index.html（Preact・Service Worker）
        │ onSnapshot（注文1件）                 │ Auth / Firestore
        └──────────────┬─────────────────────┘
                       ▼
              Firebase（Spark・無料）
              ├─ Authentication（Google）
              ├─ Cloud Firestore（asia-northeast1）
              └─ Hosting
```

- サーバー（自前のAPI）はない。クライアントが、Firestore に、セキュリティルールの下で直接アクセスする
- アクセス制御は、すべて `firestore.rules`。クライアントのチェックは、あくまで使いやすさのため

## 2. 詳細設計の文書

| 文書 | 内容 |
|---|---|
| [design/data-model.md](./design/data-model.md) | コレクション・項目・制約・インデックス・状態遷移・集計/CSV/パースの計算仕様 |
| [design/security-rules.md](./design/security-rules.md) | 権限表、`firestore.rules`、招待・参加・イベント作成の流れ、ルールの検証項目 |
| [design/data-access.md](./design/data-access.md) | API設計（データアクセス層の関数・型・エラー・購読・接続状態・イベント削除） |
| [design/order-confirm.md](./design/order-confirm.md) | 注文確定フロー（状態遷移・トランザクション・確認・復元） |
| [design/screens.md](./design/screens.md) | 画面ごとの設計（データ・状態・操作・エラー・お客様画面） |
| [design/testing.md](./design/testing.md) | テスト計画（ドメイン・ルール・結合・実機） |

設計判断の記録：[ADR-0001 Preact](./adr/0001-use-preact.md)、[ADR-0002 PWAの範囲](./adr/0002-pwa-scope.md)、[ADR-0003 招待はメールアドレス宛て](./adr/0003-invite-by-email.md)、[ADR-0004 「やめる」は墓標で排他する](./adr/0004-void-tombstone.md)、[ADR-0005 スタッフ用とお客様用を別々にビルドする](./adr/0005-separate-builds.md)

## 3. 技術構成

| 項目 | 採用 |
|---|---|
| フロント | Vite + TypeScript + Preact（ADR-0001）、`@preact/signals` |
| PWA | `vite-plugin-pwa`。Service Workerは最後に導入。ホーム画面への追加は任意（ADR-0002） |
| DB | Cloud Firestore（Spark・無料、`asia-northeast1`） |
| 認証 | Firebase Authentication（Googleのみ）。★U1 |
| ホスティング | Firebase Hosting（無料） |
| Firebase SDK | modular SDK（`firebase/app`, `firebase/auth`, `firebase/firestore`） |
| QR生成 | `qrcode-generator` などの軽量ライブラリ（クライアント側。スタッフ側のみ） |
| テスト | Vitest、Firebase Emulator Suite、`@firebase/rules-unit-testing` |

## 4. アプリの構成

### 4.1 レイヤー
```
UI（screens / components）
  └─ 状態（signals・hooks）
       └─ データアクセス（lib/data）… Firestore / Auth を呼ぶ唯一の場所
            └─ ドメイン（lib/domain）… 日付・集計・遷移・パース・CSV。Firebaseに依存しない純粋関数
```
- 依存は、上から下の一方向。UI が Firestore を直接呼ばない。ドメインは、Firebase を import しない（単体テストしやすくするため）

### 4.2 ディレクトリ
```
maido-ookini/
├─ index.html                 # スタッフ用エントリ
├─ customer.html              # お客様用エントリ（別バンドル）
├─ src/
│  ├─ staff/                  # スタッフ画面（app, auth, event, order, kitchen, sales, closing, menu）
│  ├─ customer/               # お客様画面
│  ├─ components/             # 共通部品（StatusBar, ConfirmDialog, Toast, BigButton …）
│  ├─ state/                  # signals（認証・現在のイベント・接続状態・購読データ）
│  └─ lib/
│     ├─ firebase/
│     │  ├─ staff.ts          # スタッフ用の初期化（Auth・永続キャッシュ）。Emulator接続
│     │  └─ customer.ts       # お客様用の初期化（Firestoreのみ・メモリキャッシュ。firebase/auth を含めない）
│     ├─ data/                # auth, events, members, menu, orders, closings, writes, errors
│     │  └─ customerOrder.ts  # お客様用の watchOrder だけ（staff.ts を import しない）
│     └─ domain/              # day, summary, closing, bulkMenu, csv, order(遷移・計算), confirmFlow, connection, customerView, url
├─ public/                    # アイコン、manifest（Service Worker導入時）
├─ docs/                      # SPEC.md, DESIGN.md, design/, adr/
├─ firestore.rules
├─ firestore.indexes.json
├─ firebase.json
├─ .env.development / .env.production
└─ test/                      # domain, rules, data（Emulator）
```

### 4.3 ビルドとホスティング
- Vite で、`index.html`（スタッフ用）と `customer.html`（お客様用）を、**別々にビルドする**（`npm run build` が、スタッフ用 → お客様用の順に、同じ `dist/` へ出力する）。お客様用エントリは、Auth・スタッフ画面・QR生成・Service Workerを含めない
  - 1回のビルドで2つのエントリを作る（マルチページ構成）と、Firestore SDK が共有チャンクになり、スタッフ用の永続キャッシュ（IndexedDB）のコードが、お客様用にも読み込まれる（gzip後 162KB → 分けると 136KB）。そのため、ビルドを分ける（[ADR-0005](./adr/0005-separate-builds.md)）
  - お客様用のビルドは、`@firebase/auth`・`src/staff/`・`lib/firebase/staff.ts`・永続キャッシュのコードが含まれていたら、失敗させる（`vite.config.ts` の `customerBundleGuard`）
  - 開発サーバー（`npm run dev`）は、両方のHTMLを配信する（`/` と `/customer.html`。`/s` の rewrite は Hosting のみ）
- `firebase.json`：
  - rewrite：`/s` → `/customer.html`、その他 → `/index.html`
  - ヘッダー：`Referrer-Policy: same-origin`、`X-Content-Type-Options: nosniff`。Service Workerのファイルは、キャッシュしない（`Cache-Control: no-cache`）
  - **クリックジャッキング対策**：`Content-Security-Policy: frame-ancestors 'self'`（と、古いブラウザ向けに `X-Frame-Options: SAMEORIGIN`）。他のサイトから、画面を `iframe` で埋め込まれ、取り消しなどを押させられるのを防ぐ。`'none'` ではなく `'self'` にするのは、`authDomain` をHostingと同じドメインにしたとき、Firebase Authの `iframe`（同じドメインの `/__/auth/iframe`）を、阻害しないため
  - CSP全体（`script-src` など）は、Firebase AuthとGoogleのスクリプト・Viteのインライン処理との兼ね合いが大きく、今回は見送る
- ★W1 Service Workerのスコープと、`/s` の関係（お客様画面に影響しないこと。ナビゲーションのフォールバックから `/s` を除外する）
- ★W2 `frame-ancestors 'self'` が、Googleログイン（popup / redirect、`authDomain` の `iframe`）に影響しないこと

## 5. 環境とデプロイ

| 環境 | 用途 | Firebase |
|---|---|---|
| ローカル | 開発。Emulator（Auth・Firestore）で、本番データに触れない | Emulator |
| 開発用プロジェクト（`maido-ookini-dev`） | **PRの確認・実機での確認**（Googleログインは、実際のFirebaseが必要）。PRのブランチを、devの本体（`https://maido-ookini-dev.web.app`）にデプロイする。プレビューチャンネルは、URLごとに、Authの承認済みドメインの追加が要るため、使わない | Spark |
| 本番 | イベントで使う | Spark（`maido-ookini`） |

- 設定値は `.env.*` の `VITE_FIREBASE_*`（項目は `.env.example`）。`VITE_USE_EMULATOR=true` のときだけ、Emulatorに接続する。Firebaseの設定値は、秘密ではないが、リポジトリには入れない（`.env.development`・`.env.production` はgit管理外）
- Emulator用の `.env.emulator` だけは、git管理する。プロジェクトIDを `demo-maido-ookini`（`demo-` で始まるIDは、実在のプロジェクトに接続しない）にし、秘密を含まないため。Firebaseのプロジェクトがなくても、ローカルで開発できる
- `.firebaserc`：`dev` → `maido-ookini-dev`、`prod` → `maido-ookini`。`default` は dev（誤って本番にデプロイしないため）
- コマンド：`npm run dev`（dev の Firebase）/ `npm run dev:emu`（Emulator）/ `npm run emulators` / `npm run build`（本番の設定値）/ `npm run build:dev`（dev の設定値）/ `npm test`

### セットアップ手順（本番・開発用とも）
1. Firebaseプロジェクトを作成（Sparkプラン。IDの空きを確認）
2. Firestoreを作成（本番モード、`asia-northeast1`）
3. Authenticationで、Googleログインを有効化。承認済みドメインに、Hostingのドメインを追加
4. ウェブアプリを登録し、設定値を `.env` に入れる
5. `creators/{許可するメールアドレス}` を、コンソールで作成する（最初は運営者自身）。**IDは小文字で登録する**（ルールは、ログイン中のメールを `lower()` にして比較するため、大文字を含むIDには一致しない）
6. `npx firebase deploy -P <dev か prod>`（ルール・インデックス・Hosting。下の「デプロイ」）
7. 当日までに、スタッフの端末でログインする（C2）

### デプロイ（#6）
devは、PRのたびに、手元から行う（のちに GitHub Actions にする）。本番は、イベントの前に、**main から**、手動で行う（ユーザーの明示的な指示があるときだけ）。

```sh
git switch feature/#12-…          # 確認したい PR のブランチ
npm ci                             # 依存を、lock どおりにする
npx firebase deploy -P dev         # ルール・インデックス・Hosting をまとめて
npx firebase deploy -P dev --only firestore:rules   # ルールだけ（ルールを変えた PR で、画面がまだ無いとき）
```

- **ビルドは、デプロイの直前に、自動で行われる**（`firebase.json` の `hosting.predeploy`）。`npm run typecheck` の後、`node scripts/build.mjs --project $GCLOUD_PROJECT` が、デプロイ先に対応する `.env`（dev → `.env.development`、本番 → `.env.production`）でビルドする。手で `npm run build:dev` を忘れたり、別の設定値の `dist/` を、そのままデプロイしたりすることがない
- `.env` の取り違えを防ぐため、`.env.{mode}` の `VITE_FIREBASE_PROJECT_ID` が、デプロイ先と違えば、ビルドを止める。対応表に無いプロジェクトへのデプロイも止める（`scripts/build.mjs`）
- dev は、1つの環境を、すべての PR で共有する。**最後にデプロイした PR の状態**になる。ルールも、プロジェクト全体に効く。そのため、別の PR を確かめるときは、そのブランチで、デプロイし直す
- デプロイの後に確かめること：
  - `https://maido-ookini-dev.web.app/`（スタッフ用）と `/s`（お客様用）が開く
  - 応答のヘッダー（`Referrer-Policy`・`X-Content-Type-Options`・`Content-Security-Policy: frame-ancestors 'self'`・`X-Frame-Options`）。`curl -sI https://maido-ookini-dev.web.app/s`
  - ルールを変えた PR では、反映されたルールが、手元の `firestore.rules` と一致すること
- Authの承認済みドメイン：`maido-ookini-dev.web.app`・`maido-ookini-dev.firebaseapp.com`・`localhost` は、プロジェクトの作成時に、自動で入っている（#6 で確認）。独自ドメインを使うときだけ、追加する

## 6. 認証

- Googleログイン。永続化は `browserLocalPersistence`
- ★U1：`signInWithPopup` / `signInWithRedirect` のどちらを使うかを決めるため、**Safariのタブ**での動作を、早めに実機（iPhone・Android）で確認する。リダイレクトを使う場合は、`authDomain` を、Hostingと同じドメインにする（ストレージの分離対策）
- ホーム画面に追加したアプリは、Safariとは保存領域が別のため、**そのアプリの中で**ログインが必要。ポップアップ／リダイレクトの動作、アプリを閉じて開き直したときと機内モードでのログイン保持を、実機で確認できてから、追加を勧める。それまでは、Safariのタブでの利用を前提にする
- Safariのタブのまま使う場合、しばらく開かないと、保存領域が消されてログアウトされることがある。当日の数日前にもログイン状態を確認する運用にする（C2）
- メンバー・招待・権限の設計は、[design/security-rules.md](./design/security-rules.md)

## 7. 購読の方針と無料枠

Spark無料枠：読み取り5万／日、書き込み2万／日、削除2万／日。**全ユーザーで共有**する。

| 画面 | 購読の方針 |
|---|---|
| 調理（と接続状態の判定） | `status in ['preparing','ready']` のみを、**イベントを選んでいる間は、Shell で常に購読**する（どのタブでも接続状態を判定するため）。済みの表示を出すときだけ、その日の全注文を追加で購読 |
| 売上・レジ締め | 画面を開いたとき（と「更新」）に、その日の `day` で取得。常時購読はしない |
| お客様 | 自分の1ドキュメントのみ購読（`onSnapshot`）。ポーリングは、読み取りが増えるため使わない |
| メニュー | 全件購読（100件以下） |
| イベント一覧 | コレクショングループで `members` を購読 → 各イベントを `get` |

- 見積もり：1注文あたり、書き込み約5回（確定で2回、ステータス更新で約3回）。2万／日なら、全体で約4000注文／日まで。1イベント数百件なら、同時に10イベント程度まで余裕がある
- 読み取りは、ルールの `exists` / `get` を含めて数える。注文の確定は、ルールの読み取りが、1件あたり最大5回程度（メンバー確認・墓標・カウンターの前後）、状態の更新は、1回程度。1イベント数百件なら、5万／日に収まる
- 注文の `get` は、誰でもできるため、注文IDを知る人が、読み取りを繰り返すと、全イベント共通の枠を使い切れる（[security-rules.md](./design/security-rules.md) §6）。当面は、許容する
- 複合インデックスが必要なクエリは書かない。調理画面の並べ替えなどは、クライアントで行う

## 8. オフラインとPWA

- Firestoreのオフライン永続化を有効にする（`persistentLocalCache` + `persistentMultipleTabManager`）。**スタッフ側のみ**。お客様画面は、メモリキャッシュ
- 注文の確定はトランザクション（通信必須）。ステータス変更は通常の書き込み（オフラインでも受け付け、復帰後に送られる）
- 接続状態の表示：オンライン／オフライン／未送信◯件（判定方法は [design/data-access.md](./design/data-access.md) §6）
- ステータス変更が溜まっている間に、別メンバーが同じ注文を変更した場合は、サーバー側のルール（遷移の検証）で、不正な遷移を拒否する。拒否されたら、スタッフに通知する（再読み込みをまたいだ拒否は、通知できない。既知の制約：[data-access.md](./design/data-access.md) §6.2）
- 「未送信◯件」は、ローカルの書き込みの `Promise` を、アプリ側で数える（`hasPendingWrites` では、「渡した」「取り消し」の注文が、購読の範囲から外れて数えられないため）
- ログアウト時と、メンバーでなくなったときは、端末のキャッシュ（IndexedDB）を消す（[data-access.md](./design/data-access.md) §8）
- Service Worker：アプリ本体（HTML/JS/CSS）をキャッシュし、オフラインでも開けるようにする（他のアプリに切り替えて、Safariのタブが破棄されたあとの再読み込みに備える）。**開発中は入れず、マイルストーン7で独立した作業として足す**
- `manifest`（`name`：毎度おおきに、`short_name`：毎度おおきに）とアイコンは用意するが、ホーム画面への追加は任意（ADR-0002）
- Service Workerは、新しい版を、通信があるときに裏で取得し、次の起動で切り替える。イベント当日の朝にデプロイしない（運用）

## 9. 運用上の設計

| 項目 | 方針 |
|---|---|
| バックアップ | Firestoreの自動エクスポートはSparkでは使えない。**日ごとのCSV保存**を、バックアップの代わりにする（C4） |
| 使用量の確認 | Firebaseコンソールで、読み取り・書き込みの使用量を、イベント前後に確認する（U5のときは、頻度を上げる） |
| ログ | 画面のエラーは、`console.error` のみ。外部のログサービスは使わない |
| 時計 | 端末の日時を、自動設定にする（`day` の計算が、端末の時計に依存するため。C2） |
| 依存の脆弱性 | Firebase SDK・CLI の更新時と、本番デプロイの前に、`npm audit` を確認する。指摘ごとの判断（対応・影響なし・保留）と理由は、[reviews/dependency-audit.md](./reviews/dependency-audit.md) に追記する |

## 10. 実装の進め方（マイルストーン案）

1. **土台**：Vite + TS + Preact、Firebase初期化（Emulator対応）、Googleログイン（★U1：Safariのタブで、popup / redirectを実機確認）、ルールとEmulatorテスト（メンバー制、招待、注文の更新制限）、`lib/domain` の骨組みとテスト
2. **イベントとメンバー**：イベント作成、一覧、招待、参加、メンバー管理
3. **メニュー管理**：追加・編集・並べ替え・売り切れ・まとめて追加
4. **注文確定**：[order-confirm.md](./design/order-confirm.md) のフロー（採番、冪等性、タイムアウト、墓標、保留中の注文の復元）。確定フローのreducerと、結合テストを書く
5. **調理画面とお客様画面**：状態遷移、QR、リアルタイム反映（お客様画面は別エントリ）
6. **売上とレジ締め**：集計、CSV、締め、「締め後に変更あり」
7. **オフライン対応と接続状態の表示**：Service Workerの導入（ADR-0002）、オフライン時の挙動、未送信件数。ホーム画面アプリでのログインを実機で確認し、追加を勧めるかを決める（★U1）
8. **仕上げ**：UI調整、実機での通し確認（[testing.md](./design/testing.md)）、イベント削除（★U4）、本番デプロイ

## 11. 設計上の要確認事項（まとめ）

| # | 内容 | 確認する場面 |
|---|---|---|
| U1 | Googleログイン（popup / redirect、`authDomain`）。Safariのタブはマイルストーン1、ホーム画面アプリは、追加を勧める前に確認 | マイルストーン1・7、実機 |
| U4 | イベント削除（Cloud Functionsなしで、配下を消す）の件数・時間・中断時の動作 | マイルストーン8 |
| R1〜R11 | ルールの検証項目（[security-rules.md](./design/security-rules.md) §5）。**R8（墓標の排他）が、確定フローの安全性の要** | マイルストーン1・Emulator |
| W1 | Service Workerと `/s` の関係（お客様画面に影響しないこと） | マイルストーン5・7。**`/s` の配信は #6 で確認済み**（dev で、`/s`・`/s?e=…&o=…` がお客様用の `customer.html` を、`/join` などそれ以外がスタッフ用の `index.html` を返す。ヘッダーも付く）。Service Worker との関係は M7 |
| W2 | `frame-ancestors 'self'` が、Googleログインに影響しないこと | マイルストーン1・実機 |
| F1 | お客様画面の初回JavaScriptが、gzip後200KB以下か（Firestore SDKの大きさ）。#2の時点で、Preact＋Firestore（メモリキャッシュ・`getDoc` 1回）で、約137KB | マイルストーン5 |
| N1 | 接続状態の推定（`fromCache` が10秒続いたらオフライン）が、実機で、遅すぎ・早すぎないか | マイルストーン7 |
| M1 | Gmailの別名・Workspaceのエイリアスで、招待のメールアドレスが一致しないときの扱い | マイルストーン2・実機 |
