# 毎度おおきに（maido-ookini）

イベント向けの、注文受付・呼び出し番号・売上管理のWebアプリ。スタッフ用（PWA）と、お客様用（QRで開く状況ページ）の2つの画面。Firebase（Spark＝無料枠）で動かす。

## ドキュメント

最初に、[docs/README.md](docs/README.md) を読む。

| 文書 | 役割 |
|---|---|
| `docs/SPEC.md` | 何を作るか（要件）。決定事項と、未確定事項 |
| `docs/DESIGN.md`、`docs/design/` | どう作るか（設計）。データ・ルール・API・画面・テスト |
| `docs/adr/` | 設計判断の記録。決定を変えるときは、書き換えず、新しいADRを足す |
| `docs/reviews/` | 設計レビューと、その対応 |

- 実装は、設計書に従う。設計と食い違う実装が必要になったら、**同じPRで、設計書（必要ならSPEC・ADR）も直す**
- 設計書の★（要確認）の項目は、該当するIssueで検証し、結果を設計書に反映する

## 開発フロー（Issue駆動）

```
Issue（1PR分）→ ブランチ → 実装・テスト → PR（Closes #番号）
  → CIが通る → devにデプロイして確認 → OKならマージ
  → 本番は、イベントの前に、mainから手動でデプロイ
```

- 作業は、必ず Issue から始める。1 Issue ＝ 1 PR（半日〜1日で終わる大きさ）。Issueは、GitHub の Milestone（M1〜M8＝DESIGN.md §10 のマイルストーン）に属する
- **mainに直接pushしない**。ブランチは `feature/#12-短い題名`、`fix/#12-…`、`docs/#12-…`
- コミットは、日本語で、1行目に要点。例：`feat: イベント作成を追加 (#12)`。種類は `feat` / `fix` / `docs` / `test` / `refactor` / `chore`
- PRの本文には、`Closes #番号`、変更の概要、確認した内容（テスト・dev）を書く。設計を変えたときは、変えた文書も書く
- **マージの条件**：CI（型・Lint・単体テスト・ルールのテスト・結合テスト・ビルド）が通り、**devで動作を確認した**こと。ルール（`firestore.rules`）を変えるPRは、devにルールもデプロイして確認する（ルールは、プロジェクト全体に効く）
- devの確認は、**devプロジェクトの本体（`maido-ookini-dev`）に、PRのブランチをデプロイ**して行う（プレビューチャンネルは、Googleログインの承認済みドメインの手間が増えるため、使わない）。当面は、手元から `firebase deploy -P dev` で行う。のちに、GitHub Actionsにする
- 本番（`maido-ookini`）へのデプロイと、本番データへの操作は、**ユーザーの明示的な指示があるときだけ**行う

## 守ること

- **Blazeプランにしない**（Sparkのまま）。Cloud Functionsは使わない。無料枠の消費が増える変更は、事前に相談する
- `.env*`、サービスアカウントの鍵、認証情報を、コミットしない（このリポジトリは公開）。CIの秘密は、GitHub Secretsに置く
- セキュリティルールを変えたら、ルールのテスト（Emulator）を、同じPRで足す
- お客様画面（`customer.html`）は、Auth・Service Worker・永続キャッシュを使わず、軽さを保つ（[DESIGN.md](docs/DESIGN.md) §4）
- 個人のメールアドレスなどを、お客様が読める場所に保存しない（`createdBy` などは uid）

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（devのFirebase。`.env.development` が必要）。スタッフ用は `/`、お客様用は `/customer.html` |
| `npm run dev:emu` | 開発サーバー（Emulatorに接続。`.env.emulator`。先に `npm run emulators`） |
| `npm run emulators` | Auth・Firestore・HostingのEmulator（`demo-maido-ookini`。UIは http://127.0.0.1:4000 、Hostingは `dist/` を :5002 で配信） |
| `npm run build` | 型チェック ＋ ビルド（本番の設定値。スタッフ用・お客様用を別々に、`dist/` へ） |
| `npm run build:dev` | 同上（devの設定値。`.env.development`）。devへのデプロイでは自動で行われるため、手元で確かめるときに使う |
| `npm run typecheck` | 型チェック（`tsc -b`） |
| `npm run lint` | Lint（ESLint。レイヤーの依存の向きも検査する） |
| `npm test` | 単体テスト ＋ ルールのテスト ＋ データアクセスの結合テスト |
| `npm run test:unit` | 単体テスト（Vitest。`test/domain`、`src/**/*.test.ts`） |
| `npm run test:rules` | ルールのテスト（`test/rules`。Firestore Emulatorを起動して実行。Java 21 以上が必要） |
| `npm run test:data` | データアクセスの結合テスト（`test/data`。Firestore Emulatorを起動して実行） |
| `npx firebase deploy -P dev` | devへのデプロイ（Firebase CLIは devDependencies に入っている）。Hostingのビルドは、デプロイの直前に、devの設定値で自動で行われる（DESIGN.md §5「デプロイ」） |

- Node.js は 24（`.nvmrc`）
- CI（`.github/workflows/ci.yml`）は、PRとmainへのpushで、型・Lint・単体テスト・ルールのテスト・データアクセスの結合テスト・ビルドを実行する

## 作業の進め方

- 日本語で、簡潔に説明する。専門用語は、必要なら、かみ砕く
- コミット・プッシュ・PRの作成・Issueの作成は、依頼されたときに行う（Issueに書かれた作業の範囲では、ブランチ・コミットまでは進めてよい）
- 確認が必要な外部への操作（本番・公開される変更）の前には、一覧や内容を見せる
