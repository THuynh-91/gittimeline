import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Build output, never source. `dist-*` covers the scratch output directories
  // a build gets pointed at when `dist/` is busy being served; without it a
  // single `vite build --outDir dist-agent` puts several hundred errors from
  // minified bundles into `eslint .`.
  { ignores: ['dist/**', 'dist-*/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.worker },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded PRNG (src/model/prng.ts) so compiled output stays deterministic.' },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
);
