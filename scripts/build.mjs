// スタッフ用 → お客様用の順に、別々にビルドする（DESIGN.md §4.3）
//   node scripts/build.mjs              … 本番の設定値（.env.production）
//   node scripts/build.mjs development  … dev の設定値（.env.development）
// mode は、読み込む .env だけを切り替える。コードは、どちらも本番用（圧縮あり）にする。
import { build } from 'vite';

const mode = process.argv[2] ?? 'production';
process.env.NODE_ENV = 'production';

for (const target of ['staff', 'customer']) {
  process.env.BUILD_TARGET = target;
  await build({ mode });
}
