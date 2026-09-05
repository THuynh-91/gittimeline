import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The Worker's tests are kept out of the app's suite deliberately. `worker/` is
 * a separate deployable with its own lifecycle — it is not built by Vite, not
 * typechecked by the app's tsconfig, and not shipped to Pages — so folding it
 * into the root `vitest run` would tie a green app suite to a service the app
 * does not require in order to work.
 *
 * Run it from the repository root:  npx vitest run --config worker/vitest.config.mjs
 */
export default defineConfig({
  // Pinned to this directory so the command above works from the repository
  // root, where Vitest would otherwise resolve the include glob against the
  // root and find nothing.
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['test/**/*.test.mjs'],
    environment: 'node',
    globals: false,
  },
});
