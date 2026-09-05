/** Scratch: measure click-to-first-frame for every catalog entry. Deleted when done. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.GT_BASE ?? 'http://localhost:4173';
const outFile = process.env.GT_OUT ?? 'gt-measure-results.json';
const budget = Number(process.env.GT_BUDGET ?? 900) * 1000;
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const index = JSON.parse(readFileSync('public/catalog/index.json', 'utf8'));
const results = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};

for (const e of index.entries) {
  if (only.length && !only.some((o) => e.slug.toLowerCase().includes(o.toLowerCase()))) continue;
  if (results[e.slug]?.ok && !process.env.GT_FORCE) { console.log(`${e.slug}: cached ${(results[e.slug].totalMs / 1000).toFixed(1)}s`); continue; }

  const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const rec = { slug: e.slug, bytes: e.bytes, commits: e.commits };
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 200)));
  page.on('crash', () => errors.push('PAGE CRASHED'));
  try {
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__gittimeline, null, { timeout: 30000 });

    const stages = new Set();
    let firstPreludeMs = null;
    const t0 = Date.now();
    const poll = setInterval(() => {
      page
        .evaluate(() => {
          const p = document.querySelector('[data-testid="prelude"]');
          return p ? p.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) : null;
        })
        .then((s) => {
          if (s) {
            if (firstPreludeMs == null) firstPreludeMs = Date.now() - t0;
            stages.add(s);
          }
        })
        .catch(() => {});
    }, 300);

    void page.evaluate((f) => window.__gittimeline.loadArtifact(`/catalog/${f}`), e.file).catch(() => {});
    await page.waitForFunction((s) => window.__gittimeline.source?.slug === s, e.slug, { timeout: budget, polling: 250 });
    rec.totalMs = Date.now() - t0;
    clearInterval(poll);

    const info = await page.evaluate(() => {
      const g = window.__gittimeline;
      return { duration: Math.round(g.duration), stats: g.stats, nodes: g.nodeX?.length ?? 0, phase: g.phase };
    });
    Object.assign(rec, info);
    rec.firstPreludeMs = firstPreludeMs;
    rec.stageCount = stages.size;
    rec.stages = [...stages].slice(0, 12);
    rec.ok = true;
  } catch (err) {
    rec.ok = false;
    rec.error = (err instanceof Error ? err.message : String(err)).split('\n')[0];
    try {
      rec.lastPrelude = await page.evaluate(() => document.querySelector('[data-testid="prelude"]')?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 200) ?? null);
    } catch { /* page may be gone */ }
  }
  rec.pageErrors = errors.slice(0, 3);
  results[e.slug] = rec;
  writeFileSync(outFile, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`${e.slug.padEnd(24)} ${rec.ok ? `${(rec.totalMs / 1000).toFixed(1)}s  ${rec.stats?.commits ?? '?'} commits  ${rec.nodes} nodes  prelude@${rec.firstPreludeMs}ms x${rec.stageCount}` : `FAILED ${rec.error}`}`);
  await browser.close();
}
