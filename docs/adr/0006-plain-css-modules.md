# ADR-0006: CSS は、素のCSS＋CSS変数＋CSS Modules で書く（Tailwind を入れない）

- 状態: 採用（Accepted）
- 日付: 2026-10-05

## 背景

- #29 で、見た目の決まり（色・文字・余白）と共通部品を作る（[visual.md](../design/visual.md)）
- 画面は、スタッフ用（十数画面）とお客様用（1画面）。お客様用は、軽さを保つ（ADR-0005、screens.md §4.3）
- フロントエンドのデザインの資料（taste-skill など）は、Tailwind を前提にしたものが多い

## 検討した選択肢

| 案 | 内容 | 評価 |
|---|---|---|
| A | Tailwind（v4、Vite プラグイン） | 書くのが速く、余白・色の段階がそろう。使ったクラスだけが残る。ただし、JSX の `class` が長くなり読みにくい。色などの決まりは、結局 CSS変数（`@theme`）で持つため、決まりの置き場所が二重になりがち。依存が増える |
| **B** | **素のCSS＋CSS変数＋CSS Modules** | 決まりは `tokens.css` の CSS変数の1か所。部品ごとの CSS は、CSS Modules（Vite に組み込み）でクラス名がぶつからない。依存が増えない。書く量は A より多い |
| C | CSS-in-JS（styled-components など） | 実行時のコストと依存が増える。Preact との組み合わせの情報が少ない |

## 決定

B を採用する。

- 決まり：`src/styles/tokens.css`（CSS変数）、土台：`src/styles/base.css`。スタッフ用・お客様用の両方の入口で読み込む
- 部品・画面の CSS：`*.module.css`。値は CSS変数を使い、色を直接書かない

## 結果

- 良い点：依存が増えない。決まりが1か所。お客様用の CSS は、使う部品の分だけ（#29 の時点で gzip後 約1.6KB）
- 悪い点：Tailwind 前提の資料は、読み替えが要る。部品が増えると、CSS ファイルが増える
- 見直す条件：画面が大きく増えて、CSS の書く量が負担になった場合。決まりが CSS変数にまとまっているため、Tailwind の `@theme` に移すのは難しくない
