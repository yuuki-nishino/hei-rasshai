import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

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
    files: ['*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  // レイヤーの依存は上から下の一方向（DESIGN.md §4.1）
  {
    // ドメインは Firebase・UI に依存しない純粋関数
    files: ['src/lib/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['firebase', 'firebase/*', '@firebase/*'], message: 'lib/domain は Firebase を import しない（DESIGN.md §4.1）' },
            { group: ['preact', 'preact/*', '@preact/*'], message: 'lib/domain は UI に依存しない（DESIGN.md §4.1）' },
            { group: ['../*'], message: 'lib/domain は、lib/domain の中だけを import する（DESIGN.md §4.1）' },
          ],
        },
      ],
    },
  },
  {
    // UI は Firestore・Auth を直接呼ばない（lib/data を通す）
    files: ['src/staff/**', 'src/customer/**', 'src/components/**', 'src/state/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['firebase', 'firebase/*', '@firebase/*'], message: 'UI から Firebase を直接呼ばない。lib/data を通す（DESIGN.md §4.1）' },
          ],
        },
      ],
    },
  },
  {
    // お客様画面は、スタッフ側のコードを読み込まない（ADR-0001、DESIGN.md §4.3）
    files: ['src/customer/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['firebase', 'firebase/*', '@firebase/*'], message: 'UI から Firebase を直接呼ばない。lib/data を通す（DESIGN.md §4.1）' },
            { group: ['**/staff/**', '**/staff', '**/state/**', '**/lib/firebase/staff*'], message: 'お客様画面は、スタッフ側のコードを読み込まない（DESIGN.md §4.3）' },
          ],
        },
      ],
    },
  },
);
