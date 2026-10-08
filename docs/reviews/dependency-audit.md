# 依存パッケージの脆弱性（npm audit）への対応

`npm audit` の指摘ごとに、影響の有無と対応を記録する。**新しい確認は、上に追記する**（古い記録は消さない）。

- 判断：**対応**＝更新・置き換えなどで解消した／**影響なし**＝このアプリの使い方では、悪用できない（理由を書く）／**保留**＝影響はあり得るが、修正版がない（見直す条件を書く）
- 判断の前提：利用者に配信されるのは `dist/`（ブラウザ用のバンドル）だけ。`devDependencies` は、手元とCIの Node.js でのみ動く
- 見直す時期：Firebase SDK・CLI の更新時と、本番デプロイの前（DESIGN.md §9）

## 2026-10-09（#23：本番デプロイの前の確認。firebase@12.19.0、firebase-tools@15.32.1）

`npm audit`：17件（moderate 5、high 12）。**2026-10-04 の記録と同じ件数・同じ内容**で、新しい指摘はない。本番の依存（`npm audit --omit=dev`）の4件は、すべて `@grpc/grpc-js`（および、それを含む `firebase` 系）で、判断は前回のとおり**影響なし**（ブラウザ版は `grpc` を含まない）。開発用の依存（`firebase-tools`）も同じ。見直す条件（Firebase SDK・CLI の更新時）は、変わらない。

## 2026-10-04（#2：firebase@12.19.0、firebase-tools@15.32.1 の追加時）

### 本番の依存（`dependencies`）

| パッケージ（経路） | 重大度 | 内容 | 判断 | 理由 |
|---|---|---|---|---|
| `@grpc/grpc-js@1.9.16`（`firebase` → `@firebase/firestore`） | high | [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j)：設定によって、未承認の証明書を承認済みとして扱う／[GHSA-f596-whhp-79r4](https://github.com/advisories/GHSA-f596-whhp-79r4)：サーバーのエラーの内容が、クライアントに漏れる | **影響なし** | ① `grpc-js` を使うのは、Firestore の Node.js 版（`dist/index.node.*.js`）だけ。ブラウザでは、`package.json` の `browser`・`exports.browser` により `dist/index.esm.js` が使われ、そこに `grpc` は含まれない（文字列の検索で確認）。ブラウザ版の通信は WebChannel ② 2件目は、gRPC のサーバーを立てた場合の問題で、このアプリはサーバーを持たない ③ `npm audit fix --force` の修正案は `firebase@9.14.0` への格下げで、採らない。Firebase 側の更新を待つ |

`@firebase/firestore`・`@firebase/firestore-compat`・`firebase` の high は、上の `@grpc/grpc-js` を含むことによるもの（同じ件）。

### 開発用の依存（`devDependencies`：`firebase-tools`）

| パッケージ（経路） | 重大度 | 内容 | 判断 |
|---|---|---|---|
| `basic-ftp@5.3.1`（`proxy-agent` → `pac-proxy-agent` → `get-uri`） | high | [GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r)：FTPの一覧の解析で、CPUを使い切る（DoS） | **影響なし** |
| `braces@3.0.3`（`chokidar`） | high | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)：深く入れ子にしたパターンで、スタックがあふれる（DoS） | **影響なし** |
| `re2@1.24.1`（`superstatic`＝Hosting Emulator） | moderate | [GHSA-ff84-5f28-78qj](https://github.com/advisories/GHSA-ff84-5f28-78qj) ほか3件：正規表現の処理で、異常終了・隣のメモリの読み出し | **影響なし** |
| `@opentelemetry/core@1.30.1`（`@google-cloud/pubsub`） | moderate | [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf)：Baggage の伝播で、メモリを無制限に確保する | **影響なし** |
| `uuid`（`gaxios`） | moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)：v3/v5/v6 で、バッファの境界を確認しない | **影響なし** |

理由（共通）：
- `firebase-tools` は、手元とCIの Node.js の中だけで動き、`dist/` に入らない（利用者に配信されない）
- いずれも、攻撃者が細工した入力（FTPの応答、パターン、正規表現の対象、HTTPヘッダー）を渡せることが前提。ここで扱う入力は、自分のリポジトリのファイルと、Firebase・Google のサーバーの応答だけ
- Emulator（Hosting を含む）は、`127.0.0.1` でのみ待ち受け、外部から届かない
- 修正は、`firebase-tools` 側の依存の更新を待つ
