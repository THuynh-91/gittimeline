/** Scratch: click-to-first-frame for every catalog entry, with and without the precompiled plan. Deleted when done. */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.GT_BASE ?? 'http://localhost:5173';
const outFile = process.env.GT_OUT ?? 'gt-perf-results.json';
const budget = Number(process.env.GT_BUDGET ?? 900) * 1000;
const modes = (process.env.GT_MODES ?? 'plan,dataset').split(',');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

// The entry list comes from the artifacts on disk rather than from
// `index.json`, which is being rewritten by another job while this runs.
const dir = 'public/catalog';
const entries = readdirSync(dir)
  .filter((f) => f.endsWith('.meta.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  .map((m) => ({ ...m, planFile: m.file.replace(/\.gittimeline\.gz$/, '.gtperf.gz') }))
  .map((m) => ({ ...m, planBytes: existsSync(join(dir, m.planFile)) ? statSync(join(dir, m.planFile)).size : null }))
  .sort((a, b) => a.commits - b.commits);

const results = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};

for (const e of entries) {
  if (only.length && !only.some((o) => e.slug.toLowerCase().includes(o.toLowerCase()))) continue;
  results[e.slug] ??= {};
  Object.assign(results[e.slug], { slug: e.slug, datasetBytes: e.bytes, planBytes: e.planBytes, commits: e.commits, merges: e.merges });

  for (const mode of modes) {
    if (mode === 'plan' && !e.planBytes) continue;
    if (results[e.slug][mode]?.ok && !process.env.GT_FORCE) {
      console.log(`${e.slug} [${mode}]: cached ${(results[e.slug][mode].ms / 1000).toFixed(1)}s`);
      continue;
    }
    const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const rec = { mode };
    const errors = [];
    let bytes = 0;
    page.on('pageerror', (err) => errors.push(String(err).slice(0, 200)));
    page.on('crash', () => errors.push('PAGE CRASHED'));
    page.on('response', (r) => {
      const len = Number(r.headers()['content-length'] ?? 0);
      if (r.url().includes('/catalog/') && r.status() === 200 && len) bytes += len;
    });
    try {
      // The comparison is the same build with the plan taken away, not a
      // different build.
      if (mode === 'dataset') await page.route('**/*.gtperf.gz', (route) => route.fulfill({ status: 404, body: 'blocked' }));
      const github = [];
      await page.route('https://api.github.com/**', (route) => {
        github.push(route.request().url());
        return route.abort();
      });

      await page.goto(base, { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__gittimeline, null, { timeout: 60000 });

      // The card's own click handler, called directly: `index.json` (and so
      // the shelf) is in flux, and this is the function it would have called.
      const t0 = Date.now();
      await page.evaluate(async (f) => {
        const m = await import('/src/app/controller.ts');
        void m.loadCatalogEntry(f, 'measured');
      }, e.file);
      await page.waitForFunction((s) => window.__gittimeline.source?.slug === s, e.slug, { timeout: budget, polling: 200 });
      rec.ms = Date.now() - t0;

      Object.assign(rec, await page.evaluate(() => {
        const g = window.__gittimeline;
        return { planHash: g.planHash, duration: Math.round(g.duration), nodes: g.nodeX?.length ?? 0, commits: g.stats?.commits ?? null, phase: g.phase };
      }));
      rec.catalogBytes = bytes;
      rec.github = github.length;
      rec.ok = true;
    } catch (err) {
      rec.ok = false;
      rec.error = (err instanceof Error ? err.message : String(err)).split('\n')[0];
    }
    rec.pageErrors = errors.slice(0, 3);
    results[e.slug][mode] = rec;
    writeFileSync(outFile, `${JSON.stringify(results, null, 2)}\n`);
    console.log(
      `${e.slug.padEnd(24)} [${mode.padEnd(7)}] ${rec.ok ? `${(rec.ms / 1000).toFixed(2)}s  ${rec.nodes} nodes  ${(rec.catalogBytes / 1e6).toFixed(1)} MB down  gh=${rec.github}  ${rec.planHash?.slice(0, 12)}` : `FAILED ${rec.error} ${rec.pageErrors.join(' | ')}`}`,
    );
    await browser.close();
  }

  const a = results[e.slug].plan;
  const b = results[e.slug].dataset;
  if (a?.ok && b?.ok) {
    console.log(`  ${a.planHash === b.planHash ? 'PLAN HASH MATCHES' : `PLAN HASH DIFFERS  ${a.planHash} vs ${b.planHash}`}  ${(b.ms / a.ms).toFixed(1)}x faster`);
  }
}
