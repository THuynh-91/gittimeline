/**
 * Drop the catalog files nothing will ever ask for.
 *
 *   node scripts/prune-catalog.mjs [--dir DIR] [--apply]
 *
 * A shipped entry can carry two files: the dataset (`.gittimeline.gz`, the
 * history) and the plan (`.gtperf.gz`, the choreography compiled from it). When
 * a plan is present the browser loads it and never compiles anything, so the
 * dataset is read for exactly one purpose afterwards — filling the commit
 * ledger back in with subjects and links, which the plan does not carry.
 *
 * And that fill-in has a size limit of its own, for a reason unrelated to
 * bandwidth: reading an artifact ends in one synchronous pass through
 * `buildDataset` that cannot be broken up, and CPython's 133,027 commits take
 * about six seconds of it. Six seconds of frozen stage in the middle of a
 * performance already playing is worse than a ledger without subjects, so
 * `HYDRATE_MAX_BYTES` in src/app/controller.ts refuses anything larger.
 *
 * The consequence had gone unnoticed: for every entry above that limit, the
 * dataset is shipped and never fetched. Measured on the current shelf that is
 * 636 MB of 981 MB — and GitHub Pages will not publish a site over a gigabyte,
 * so those files were not merely idle, they were the thing blocking the deploy.
 *
 * This is deliberately a separate step rather than something the builder does,
 * because the datasets are worth keeping locally: they are what a plan is
 * rebuilt from when the choreography changes, and re-cloning Chromium to get
 * one back is an hour nobody should spend.
 */
import { readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const flag = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const dir = resolve(flag('dir', 'public/catalog'));
const apply = process.argv.includes('--apply');

// Read the threshold from the source rather than restating it. A number
// duplicated into a build script is a number that will disagree with the app
// the first time somebody tunes it.
const controller = readFileSync(resolve('src/app/controller.ts'), 'utf8');
const match = controller.match(/HYDRATE_MAX_BYTES\s*=\s*([\d_]+)/);
if (!match) {
  console.error('Could not find HYDRATE_MAX_BYTES in src/app/controller.ts — refusing to guess.');
  process.exit(1);
}
const hydrateMax = Number(match[1].replace(/_/g, ''));

const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
let kept = 0;
let dropped = 0;
const removals = [];

for (const entry of index.entries) {
  const datasetPath = join(dir, entry.file);
  if (!existsSync(datasetPath)) continue;
  const bytes = statSync(datasetPath).size;
  // No plan means the dataset is the only way in, whatever its size.
  const reachable = !entry.plan || bytes <= hydrateMax;
  if (reachable) {
    kept += bytes;
    continue;
  }
  dropped += bytes;
  removals.push({ slug: entry.slug, file: entry.file, bytes });
}

for (const r of removals) {
  console.log(`${r.slug.padEnd(24)} ${((r.bytes / 1e6).toFixed(1) + ' MB').padStart(9)}  ${apply ? 'removed' : 'would remove'}`);
  if (apply) rmSync(join(dir, r.file), { force: true });
}

console.log(
  `\n${removals.length} unreachable dataset${removals.length === 1 ? '' : 's'}: ` +
    `${(dropped / 1e6).toFixed(0)} MB ${apply ? 'removed' : 'to remove'}, ${(kept / 1e6).toFixed(0)} MB of datasets kept.`,
);
if (!apply) console.log('Nothing changed. Pass --apply to delete them.');
