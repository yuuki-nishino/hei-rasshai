/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

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

export default defineConfig({
  plugins: [preact(), ...(target === 'customer' ? [customerBundleGuard()] : [])],
  build: {
    emptyOutDir: target === 'staff',
    rollupOptions: {
      input: resolve(import.meta.dirname, target === 'customer' ? 'customer.html' : 'index.html'),
    },
  },
  test: {
    include: ['test/domain/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
