import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// レイヤーの依存は上から下の一方向（DESIGN.md §4.1）
const noFirebaseSdk = {
  regex: '^@?firebase(/|$)',
  message: 'Firebase SDK は lib/firebase・lib/data だけで使う（DESIGN.md §4.1）',
};
const noLibFirebase = {
  group: ['**/lib/firebase/*'],
  message: 'UI から lib/firebase を直接呼ばない。lib/data を通す（DESIGN.md §4.1）',
};
const noStaffCode = {
  group: ['**/staff/**', '**/staff', '**/state/**', '**/firebase/staff*'],
  message: 'お客様画面は、スタッフ側のコードを読み込まない（DESIGN.md §4.3）',
};
const restrict = (...patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['*.config.{js,ts}', 'scripts/**'],
    languageOptions: { globals: globals.node },
  },
  {
    // ドメインは Firebase・UI に依存しない純粋関数
    files: ['src/lib/domain/**/*.{ts,tsx}'],
    rules: restrict(
      { ...noFirebaseSdk, message: 'lib/domain は Firebase を import しない（DESIGN.md §4.1）' },
      { group: ['preact', 'preact/*', '@preact/*'], message: 'lib/domain は UI に依存しない（DESIGN.md §4.1）' },
      { group: ['../*'], message: 'lib/domain は、lib/domain の中だけを import する（DESIGN.md §4.1）' },
    ),
  },
  {
    // UI は Firestore・Auth を直接呼ばない（lib/data を通す）
    files: ['src/staff/**', 'src/components/**', 'src/state/**'],
    rules: restrict(noFirebaseSdk, noLibFirebase),
  },
  {
    // お客様画面は、スタッフ側のコードを読み込まない（ADR-0001、DESIGN.md §4.3）
    files: ['src/customer/**'],
    rules: restrict(noFirebaseSdk, noLibFirebase, noStaffCode),
  },
  {
    // お客様用のデータアクセスは、スタッフ用の初期化を読み込まない（data-access.md §1）
    files: ['src/lib/data/customerOrder.ts'],
    rules: restrict(noStaffCode),
  },
);
