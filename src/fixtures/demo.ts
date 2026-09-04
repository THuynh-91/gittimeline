import { PEOPLE, Script } from './synthetic';
import type { Dataset } from '@/model/types';

/**
 * The built-in deterministic demo. In roughly one minute it exercises the
 * whole motion language: commit traversal, divergence, three concurrently
 * moving threads, several contributor signatures, a handoff on the main line,
 * merge approach + impact (one major), a quiet gap with an intensity change,
 * a dense burst, a criss-cross secondary edge, a tag, a bot, an unmerged tip,
 * and post-merge settling.
 */
export function buildDemoDataset(): Dataset {
  const s = new Script('gitdance-demo', '2021-02-03T09:00:00Z', 'main');
  const { mara, devi, kofi, ines, yuki, bot } = PEOPLE;

  // Formation: a quiet linear start by one person.
  s.commit('main', 'init', mara, { message: 'Initial commit: project skeleton' });
  s.commit('main', 'readme', mara, { days: 2, message: 'Write the README and a first sketch' });
  s.commit('main', 'core-loop', mara, { days: 3, message: 'Add the core update loop' });
  s.commit('main', 'config', mara, { days: 4, message: 'Load configuration from a file' });

  // First divergence: Devi peels off to build auth while Mara keeps going.
  s.branch('feature/auth', 'main');
  s.commit('feature/auth', 'auth-scaffold', devi, { days: 2, message: 'Scaffold the auth module' });
  s.commit('main', 'logging', mara, { days: 1, message: 'Structured logging' });
  s.commit('feature/auth', 'auth-tokens', devi, { days: 2, message: 'Issue and verify session tokens' });
  s.commit('main', 'cli', mara, { days: 1, message: 'Command-line entry point' });

  // Second divergence: Inés starts a performance thread — three lines move at once.
  s.branch('perf/render', 'main');
  s.commit('perf/render', 'perf-profile', ines, { days: 2, message: 'Profile the render path' });
  s.commit('feature/auth', 'auth-middleware', devi, { days: 1, message: 'Auth middleware and guards' });
  s.commit('main', 'errors', mara, { days: 1, message: 'Consistent error reporting' });
  s.commit('perf/render', 'perf-batching', ines, { days: 2, message: 'Batch draw calls' });
  s.commit('feature/auth', 'auth-tests', devi, { days: 1, message: 'Auth integration tests' });

  // Handoff on the main line: Kofi takes over from Mara.
  s.commit('main', 'ci', kofi, { days: 2, message: 'Continuous integration workflow' });
  s.commit('perf/render', 'perf-cache', ines, { days: 1, message: 'Cache tessellated paths' });

  // The auth thread curves home: a major merge.
  s.merge('main', 'feature/auth', 'merge-auth', kofi, { days: 2, message: 'Merge feature/auth: sessions, tokens and guards' });
  s.commit('main', 'docs-auth', kofi, { days: 2, message: 'Document authentication' });

  // Criss-cross: main flows into the perf thread before perf comes back.
  s.merge('perf/render', 'main', 'perf-sync', ines, { days: 1, message: 'Merge main into perf/render' });
  s.commit('perf/render', 'perf-final', ines, { days: 2, message: 'Tune the batching thresholds' });
  s.merge('main', 'perf/render', 'merge-perf', kofi, { days: 2, message: 'Merge perf/render: 3x faster frames' });
  s.tag('v1.0.0', 'merge-perf');

  // A quiet stretch: months pass in a breath.
  s.commit('main', 'bump-deps', bot, { days: 215, message: 'Bump dependencies' });

  // Renewed activity: a dense burst with two threads and a fresh contributor.
  s.commit('main', 'revive', mara, { days: 6, message: 'Back to it: modernize the build' });
  s.branch('feature/plugins', 'main');
  s.branch('feature/i18n', 'main');
  s.commit('feature/plugins', 'plugin-api', yuki, { days: 1, message: 'Plugin API surface' });
  s.commit('feature/i18n', 'i18n-extract', devi, { days: 0.4, message: 'Extract user-facing strings' });
  s.commit('main', 'ts-strict', mara, { days: 0.4, message: 'Enable strict TypeScript' });
  s.commit('feature/plugins', 'plugin-loader', yuki, { days: 0.5, message: 'Plugin loader with sandboxing' });
  s.commit('feature/i18n', 'i18n-runtime', devi, { days: 0.4, message: 'Runtime locale switching' });
  s.commit('main', 'lint', kofi, { days: 0.4, message: 'Lint rules for the new build' });
  s.commit('feature/plugins', 'plugin-docs', yuki, { days: 0.5, message: 'Plugin authoring guide' });
  s.commit('feature/i18n', 'i18n-tests', devi, { days: 0.4, message: 'Locale tests' });
  s.commit('main', 'release-notes', kofi, { days: 0.5, message: 'Release notes draft' });
  s.merge('main', 'feature/i18n', 'merge-i18n', kofi, { days: 0.6, message: 'Merge feature/i18n' });
  s.merge('main', 'feature/plugins', 'merge-plugins', mara, { days: 0.8, message: 'Merge feature/plugins: extensibility' });
  s.tag('v2.0.0', 'merge-plugins');

  // Settling: a few calm commits and a branch that is still open today.
  s.commit('main', 'polish', mara, { days: 3, message: 'Polish the landing experience' });
  s.branch('docs/site', 'main');
  s.commit('docs/site', 'docs-site', ines, { days: 2, message: 'Start the documentation site' });
  s.commit('main', 'fix-typo', kofi, { days: 1, message: 'Fix a typo in the changelog' });
  s.commit('docs/site', 'docs-nav', ines, { days: 2, message: 'Navigation for the docs site' });
  s.keep('docs/site');

  return s.build({ description: 'Built-in synthetic performance — no network required.', owner: 'gitdance' });
}
