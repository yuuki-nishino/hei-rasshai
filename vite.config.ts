/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// マルチページ構成（DESIGN.md §4.3）。
// customer.html は、Auth・スタッフ画面・QR生成・Service Worker を含めない別バンドルにする。
export default defineConfig({
  plugins: [preact()],
  build: {
    rollupOptions: {
      input: {
        staff: resolve(import.meta.dirname, 'index.html'),
        customer: resolve(import.meta.dirname, 'customer.html'),
      },
    },
  },
  test: {
    include: ['test/domain/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
