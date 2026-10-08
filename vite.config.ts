/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// ビルドは、スタッフ用とお客様用を、別々に行う（DESIGN.md §4.3）。
// 1回のビルドで2つの入口を作ると、Firestore SDK が共有チャンクになり、
// スタッフ用の永続キャッシュ（IndexedDB）のコードが、お客様用にも読み込まれるため。
// - scripts/build.mjs：スタッフ用（dist を作り直す）→ BUILD_TARGET=customer でお客様用（dist に追加）
// - 開発サーバー（npm run dev）は、両方の HTML をそのまま配信する
const target = process.env.BUILD_TARGET === 'customer' ? 'customer' : 'staff';

// お客様用のバンドルに、Auth・スタッフ側のコード・永続キャッシュが入っていたら、ビルドを失敗させる
const customerForbidden = [/[\\/]@firebase[\\/]auth[\\/]/, /[\\/]src[\\/]lib[\\/]firebase[\\/]staff\./, /[\\/]src[\\/]staff[\\/]/];

function customerBundleGuard(): Plugin {
  return {
    name: 'customer-bundle-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const id = chunk.moduleIds.find((m) => customerForbidden.some((re) => re.test(m)));
        if (id) this.error(`お客様用のバンドルに、含めてはいけないモジュールがあります：${id}`);
        // Firestore の永続キャッシュ（IndexedDB）が使う、オブジェクトストア名
        if (chunk.code.includes('remoteDocuments')) this.error('お客様用のバンドルに、Firestore の永続キャッシュが含まれています');
      }
    },
  };
}

// Service Worker とホーム画面への追加（manifest）は、スタッフ用のビルドだけに入れる（ADR-0002、DESIGN.md §8）。
// - 登録は src/staff/main.tsx（本番のビルドだけ。開発サーバーでは入れない）
// - 新しい版は、裏で取得して待機させ、次の起動で切り替える（skipWaiting・clientsClaim を使わない）
// - お客様画面（/s）：ナビゲーションのフォールバックから外し、事前キャッシュにも入れない（★W1）。scripts/build.mjs が、ビルド後に検査する
function staffPwa(): Plugin[] {
  return VitePWA({
    injectRegister: false,
    registerType: 'prompt',
    includeAssets: ['icons/apple-touch-icon.png'], // manifest と manifest のアイコンは、プラグインが事前キャッシュに足す。<link rel="manifest"> も、ビルド時にプラグインが足す（index.html には書かない）
    manifest: {
      name: '毎度おおきに',
      short_name: '毎度おおきに',
      lang: 'ja',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#a63a24',
      background_color: '#f5f0e6',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      // アプリ本体（HTML・JS・CSS。アイコンは includeAssets と manifest）を事前キャッシュする。手書きの文字（woff2。使った分だけ）は、下の実行時キャッシュ。古い形式（woff）は入れない
      globPatterns: ['**/*.{html,js,css}'],
      globIgnores: ['customer.html', 'assets/customer-*'],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/s(\/|\?|$)/, /^\/customer\.html/, /^\/__\//],
      cleanupOutdatedCaches: true,
      runtimeCaching: [
        {
          urlPattern: ({ url }) => /^\/assets\/zen-kurenaido-.*\.woff2$/.test(url.pathname),
          handler: 'CacheFirst',
          options: { cacheName: 'fonts', expiration: { maxEntries: 60 } },
        },
      ],
    },
  });
}

export default defineConfig({
  plugins: [preact(), ...(target === 'customer' ? [customerBundleGuard()] : staffPwa())],
  build: {
    emptyOutDir: target === 'staff',
    rollupOptions: {
      input: resolve(import.meta.dirname, target === 'customer' ? 'customer.html' : 'index.html'),
    },
  },
  test: {
    environment: 'node',
    projects: [
      // 単体テスト（Firebase に依存しない）
      { extends: true, test: { name: 'unit', include: ['test/domain/**/*.test.ts', 'src/**/*.test.ts'] } },
      // ルールのテスト（Firestore Emulator が必要。npm run test:rules が、Emulator を起動して実行する）
      {
        extends: true,
        test: { name: 'rules', include: ['test/rules/**/*.test.ts'], fileParallelism: false, testTimeout: 20000, hookTimeout: 20000 },
      },
      // データアクセスの結合テスト（Firestore Emulator が必要。npm run test:data）
      {
        extends: true,
        test: { name: 'data', include: ['test/data/**/*.test.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 20000 },
      },
    ],
  },
});
