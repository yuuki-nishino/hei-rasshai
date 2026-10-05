# docs

| 文書 | 位置付け |
|---|---|
| [SPEC.md](./SPEC.md) | 仕様書。何を作るか（要件・画面・受け入れ条件）と、決定事項・未確定事項 |
| [DESIGN.md](./DESIGN.md) | 設計書（概要）。全体像、技術構成、アプリの構成、環境・デプロイ、進め方 |
| [design/](./design/) | 詳細設計。下表のとおり、テーマごとに分ける |
| [adr/](./adr/) | 設計判断の記録（Architecture Decision Record）。1判断につき1ファイル。`NNNN-題名.md` |
| [reviews/](./reviews/) | レビューの結果と、それへの対応（採用・見送りの切り分けと理由）。`題名.md`（日付は、中に書く）。依存の脆弱性（`npm audit`）への対応も、ここに記録する（[dependency-audit.md](./reviews/dependency-audit.md)） |

### design/
| 文書 | 内容 |
|---|---|
| [data-model.md](./design/data-model.md) | データ設計。コレクション・項目・制約・インデックス・状態遷移・集計の計算仕様 |
| [security-rules.md](./design/security-rules.md) | 権限・セキュリティルール。招待・参加の流れ |
| [data-access.md](./design/data-access.md) | API設計。データアクセス層の関数・型・エラー・購読 |
| [order-confirm.md](./design/order-confirm.md) | 注文確定フロー |
| [screens.md](./design/screens.md) | 画面設計 |
| [visual.md](./design/visual.md) | 見た目の設計（色・文字・共通部品） |
| [testing.md](./design/testing.md) | テスト計画 |

## 書き分けの方針

- 仕様は「何を・なぜ」、設計は「どうやって」を書く。技術の選定やデータの持ち方は、設計に書く
- 仕様の変更が設計に影響する場合は、両方を同時に直す
- 設計判断のうち、選択肢の比較や理由を残したいものは、ADRに書き、設計書からリンクする
- ADRは、決定を変えるときは書き換えず、新しいADRを足し、古いものの状態を「置き換え済み」にする
