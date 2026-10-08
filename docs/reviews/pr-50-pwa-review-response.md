# PR #50 レビューへの対応

対象：[pr-50-pwa-review.md](./pr-50-pwa-review.md)

| # | 判断 | 内容 | 反映先 |
|---|---|---|---|
| W1 | **採用** | `index.html` の手書きの `<link rel="manifest">` を消し、プラグインに任せた。ビルド後の `dist/index.html` に、1つだけ入ることを確かめた | `index.html` |
| W2 | **一部採用（運用で補う）** | 設計の意図（動作中の画面を、途中で入れ替えない）は保つ。デプロイ後は、各端末で、アプリを完全に閉じて開き直す運用を、DESIGN.md §9 に書いた。「新しい版があります」の表示と、版の表示は、必要になったら、別のIssueで足す（見送り） | DESIGN.md §9 |
| W3 | **採用**（W1で解消） | 開発サーバーでは、`<link rel="manifest">` が出なくなった | `index.html` |
| W4 | **採用** | `globPatterns` から `png`・`webmanifest` を外し、アイコンは `includeAssets`（`apple-touch-icon`）と manifest に任せた。事前キャッシュの重複が無くなった（13件 → 11件）。ビルドの検査は、壊れるときは必ず失敗する側のため、そのままにする | `vite.config.ts` |
