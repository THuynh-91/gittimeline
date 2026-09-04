import { PEOPLE, Script } from './synthetic';
import type { Dataset } from '@/model/types';

/**
 * The built-in deterministic demo, written as a ride.
 *
 * In roughly half a minute it exercises the whole motion language — commit
 * traversal, divergence, several threads moving at once, contributor
 * signatures and a handoff, merge approach and impact, tags, a bot, a live
 * unmerged tip, a quiet year and the settle afterwards — and it deliberately
 * builds: a small merge, then a long-running branch of sixteen commits landing
 * as one heavy convergence, then an octopus pulling four efforts together at
 * once. Because impact scale follows the number of commits absorbed, those
 * three merges look and sound progressively bigger.
 */
export function buildDemoDataset(): Dataset {
  const s = new Script('gitdance-demo', '2021-02-03T09:00:00Z', 'main');
  const { mara, devi, kofi, ines, yuki, bot } = PEOPLE;

  // --- Formation: one person, quiet and linear. The stage is nearly empty.
  s.commit('main', 'init', mara, { message: 'Initial commit: project skeleton' });
  s.commit('main', 'readme', mara, { days: 2, message: 'Write the README and a first sketch' });
  s.commit('main', 'core-loop', mara, { days: 3, message: 'Add the core update loop' });
  s.commit('main', 'config', mara, { days: 4, message: 'Load configuration from a file' });

  // --- First divergence: a second line appears. Two performers now.
  s.branch('feature/auth', 'main');
  s.commit('feature/auth', 'auth-scaffold', devi, { days: 2, message: 'Scaffold the auth module' });
  s.commit('main', 'logging', mara, { days: 1, message: 'Structured logging' });
  s.commit('feature/auth', 'auth-tokens', devi, { days: 2, message: 'Issue and verify session tokens' });
  s.commit('main', 'cli', mara, { days: 1, message: 'Command-line entry point' });

  // --- The long game begins: a rewrite branch that will run for months.
  s.branch('rewrite/engine', 'main');
  s.commit('rewrite/engine', 'rw-01', ines, { days: 1, message: 'Begin the engine rewrite' });

  // --- A third line: now three performers move at once.
  s.branch('perf/render', 'main');
  s.commit('perf/render', 'perf-profile', ines, { days: 1, message: 'Profile the render path' });
  s.commit('feature/auth', 'auth-middleware', devi, { days: 1, message: 'Auth middleware and guards' });
  s.commit('rewrite/engine', 'rw-02', yuki, { days: 0.5, message: 'Extract the scheduler' });
  s.commit('main', 'errors', mara, { days: 1, message: 'Consistent error reporting' });
  s.commit('perf/render', 'perf-batching', kofi, { days: 1, message: 'Batch draw calls' });
  s.commit('feature/auth', 'auth-tests', devi, { days: 1, message: 'Auth integration tests' });
  s.commit('rewrite/engine', 'rw-03', yuki, { days: 0.5, message: 'New entity storage' });

  // --- Handoff on the main line: Kofi takes over from Mara.
  s.commit('main', 'ci', kofi, { days: 1, message: 'Continuous integration workflow' });
  s.commit('rewrite/engine', 'rw-04', ines, { days: 0.5, message: 'Port the renderer to the new engine' });

  // --- Beat one: a modest merge. Four commits converge.
  s.keep('feature/auth');
  s.merge('main', 'feature/auth', 'merge-auth', kofi, { days: 1, message: 'Merge feature/auth: sessions, tokens and guards' });
  s.commit('rewrite/engine', 'rw-05', yuki, { days: 0.5, message: 'Threaded asset loading' });
  s.commit('main', 'docs-auth', kofi, { days: 1, message: 'Document authentication' });
  s.commit('perf/render', 'perf-cache', kofi, { days: 0.5, message: 'Cache tessellated paths' });
  s.commit('rewrite/engine', 'rw-06', ines, { days: 0.5, message: 'Deterministic frame stepping' });

  // Criss-cross: main flows into perf before perf comes back.
  s.merge('perf/render', 'main', 'perf-sync', kofi, { days: 0.5, message: 'Merge main into perf/render' });
  s.commit('rewrite/engine', 'rw-07', yuki, { days: 0.5, message: 'Rewrite the input layer' });
  s.commit('perf/render', 'perf-final', kofi, { days: 1, message: 'Tune the batching thresholds' });
  s.keep('perf/render');
  s.merge('main', 'perf/render', 'merge-perf', mara, { days: 1, message: 'Merge perf/render: 3x faster frames' });
  s.tag('v1.0.0', 'merge-perf');

  // The rewrite keeps accumulating while the main line moves on.
  s.commit('rewrite/engine', 'rw-08', ines, { days: 1, message: 'Physics on the new scheduler' });
  s.commit('main', 'fix-cli', kofi, { days: 0.5, message: 'Fix a CLI argument edge case' });
  s.commit('rewrite/engine', 'rw-09', yuki, { days: 0.5, message: 'Audio subsystem' });
  s.commit('rewrite/engine', 'rw-10', ines, { days: 0.5, message: 'Serialization format v2' });
  s.commit('rewrite/engine', 'rw-11', devi, { days: 0.5, message: 'Migrate the auth module across' });
  s.commit('rewrite/engine', 'rw-12', ines, { days: 0.5, message: 'Remove the last of the old engine' });

  // --- Beat two: the heavy one. Twelve commits of rewrite land at once.
  s.keep('rewrite/engine');
  s.merge('main', 'rewrite/engine', 'merge-rewrite', ines, { days: 1, message: 'Merge rewrite/engine: the new engine is the engine' });
  s.tag('v2.0.0', 'merge-rewrite');
  s.commit('main', 'settle', mara, { days: 2, message: 'Settle the dust after the rewrite' });

  // --- A quiet year. The calendar spins; the stage barely breathes.
  s.commit('main', 'bump-deps', bot, { days: 340, message: 'Bump dependencies' });

  // --- Renewed activity: four efforts at once, converging together.
  s.commit('main', 'revive', mara, { days: 8, message: 'Back to it: modernize the build' });
  for (const [branch, who, msgs] of [
    ['feature/plugins', yuki, ['Plugin API surface', 'Plugin loader with sandboxing', 'Plugin authoring guide']],
    ['feature/i18n', devi, ['Extract user-facing strings', 'Runtime locale switching', 'Locale tests']],
    ['feature/theme', ines, ['Theme tokens', 'Dark and light themes', 'Theme switching']],
    ['feature/api', kofi, ['Public API surface', 'API reference generator', 'API stability tests']],
  ] as const) {
    s.branch(branch, 'main');
    msgs.forEach((m, i) => s.commit(branch, `${branch}-${i}`, who, { days: 0.3, message: m }));
    s.keep(branch);
  }
  s.commit('main', 'ts-strict', mara, { days: 0.4, message: 'Enable strict TypeScript' });
  s.commit('main', 'release-notes', kofi, { days: 0.4, message: 'Draft the release notes' });

  // --- Beat three: an octopus. Four branches, one downbeat.
  s.merge('main', ['feature/plugins', 'feature/i18n', 'feature/theme', 'feature/api'], 'octopus', mara, {
    days: 0.8,
    message: 'Merge plugins, i18n, themes and the public API',
  });
  s.tag('v3.0.0', 'octopus');

  // --- Release: the structure exhales, and one line is still open today.
  s.commit('main', 'polish', mara, { days: 3, message: 'Polish the landing experience' });
  s.branch('docs/site', 'main');
  s.commit('docs/site', 'docs-site', ines, { days: 2, message: 'Start the documentation site' });
  s.commit('main', 'fix-typo', kofi, { days: 1, message: 'Fix a typo in the changelog' });
  s.commit('docs/site', 'docs-nav', ines, { days: 2, message: 'Navigation for the docs site' });
  s.keep('docs/site');

  return s.build({ description: 'Built-in synthetic performance — no network required.', owner: 'gitdance' });
}
