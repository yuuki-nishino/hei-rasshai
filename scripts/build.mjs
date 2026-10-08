// スタッフ用 → お客様用の順に、別々にビルドする（DESIGN.md §4.3）
//   node scripts/build.mjs              … 本番の設定値（.env.production）
//   node scripts/build.mjs development  … dev の設定値（.env.development）
//   node scripts/build.mjs --project <ID> … デプロイ先のプロジェクトに合わせる（firebase.json の predeploy から呼ぶ。DESIGN.md §5）
// mode は、読み込む .env だけを切り替える。コードは、どちらも本番用（圧縮あり）にする。
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { build, loadEnv } from 'vite';

// デプロイ先のプロジェクト → 読み込む .env
const modeOfProject = {
  'maido-ookini-dev': 'development',
  'maido-ookini': 'production',
};

let mode = process.argv[2] ?? 'production';
if (process.argv[2] === '--project') {
  const project = process.argv[3];
  mode = modeOfProject[project];
  if (!mode) {
    throw new Error(`デプロイ先のプロジェクト「${project}」に対応する設定がありません（scripts/build.mjs の modeOfProject）`);
  }
  // .env の取り違え（dev のデプロイに、本番の設定値が入るなど）を防ぐ
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (env.VITE_FIREBASE_PROJECT_ID !== project) {
    throw new Error(
      `.env.${mode} の VITE_FIREBASE_PROJECT_ID（${env.VITE_FIREBASE_PROJECT_ID ?? '未設定'}）が、デプロイ先（${project}）と違います`,
    );
  }
}
process.env.NODE_ENV = 'production';

for (const target of ['staff', 'customer']) {
  process.env.BUILD_TARGET = target;
  await build({ mode });
}

// お客様画面の、初回に読み込む JavaScript（gzip後）が、200KB 以下か（DESIGN.md ★F1、screens.md §4.3）。超えたらビルドを失敗させる
const CUSTOMER_JS_LIMIT = 200 * 1024;
const customerHtml = readFileSync('dist/customer.html', 'utf8');
const scripts = [...customerHtml.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="([^"]+\.js)"/g)].map((m) => m[1]);
const bytes = scripts.reduce((sum, src) => sum + gzipSync(readFileSync(`dist${src}`)).length, 0);
console.log(`お客様画面の初回の JavaScript：gzip後 ${(bytes / 1024).toFixed(1)}KB（上限 ${CUSTOMER_JS_LIMIT / 1024}KB。${scripts.length} ファイル）`);
if (scripts.length === 0 || bytes > CUSTOMER_JS_LIMIT) {
  throw new Error(`お客様画面の初回の JavaScript が、gzip後 ${(bytes / 1024).toFixed(1)}KB です（上限 ${CUSTOMER_JS_LIMIT / 1024}KB）。内容を見直してください（DESIGN.md ★F1）`);
}

// Service Worker が、お客様画面（/s）に影響しないか（ADR-0002、DESIGN.md ★W1）。事前キャッシュにお客様用のファイルが入っていたり、
// /s へのナビゲーションを index.html に置き換える設定が欠けていたら、ビルドを失敗させる
const sw = readFileSync('dist/sw.js', 'utf8');
const precached = [...sw.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]);
const leaked = precached.filter((u) => /customer/.test(u));
if (precached.length === 0) throw new Error('dist/sw.js の事前キャッシュが空です');
if (leaked.length > 0) throw new Error(`Service Worker の事前キャッシュに、お客様用のファイルがあります：${leaked.join(', ')}`);
if (!/denylist/.test(sw) || !sw.includes('^\\/s(\\/|\\?|$)')) throw new Error('Service Worker のナビゲーションから、/s が除外されていません（DESIGN.md ★W1）');
console.log(`Service Worker：事前キャッシュ ${precached.length} 件。お客様画面（/s）は対象外`);
