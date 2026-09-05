import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Build output, never source. `dist-*` covers the scratch output directories
  // a build gets pointed at when `dist/` is busy being served; without it a
  // single `vite build --outDir dist-agent` puts several hundred errors from
  // minified bundles into `eslint .`. `.*-dist` covers the same thing named
  // with a leading dot to keep it out of the way — `.measure-dist`, which
  // `scripts/_measure-server.mjs` serves the production bundle from, slipped
  // past `dist-*` for exactly that reason and put 735 of them back.
  // `.wrangler` is the same story one directory down: `worker/.gitignore` has
  // ignored it since it was added, but a flat config does not read nested
  // gitignores, so a `wrangler dev` running in the background puts its bundling
  // scratch — someone else's generated code — into this run.
  // `gt-*` are throwaway measurement scripts — already in .gitignore, so CI
  // never sees them, but a local `eslint .` was failing on an unused import in
  // a probe that had done its job an hour earlier and made the whole run look
  // red. Nothing that cannot be committed should be able to fail the lint.
  { ignores: ['dist/**', 'dist-*/**', '.*-dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', '**/.wrangler/**', 'gt-*.mjs', 'gt-*.ts'] },
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
