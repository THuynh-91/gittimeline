import { chromium } from 'playwright';
import { appendFileSync } from 'node:fs';

const out = process.argv[2];
const say = (o) => { const s = JSON.stringify(o); console.log(s); appendFileSync(out, s + '\n'); };

const TARGETS = process.argv.slice(3);

const b = await chromium.launch();
for (const slug of TARGETS) {
  const page = await b.newPage({ viewport: { width: 1400, height: 800 } });
  page.setDefaultTimeout(600000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 180)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 180)); });
  const file = `${slug.replace('/', '-')}.gittimeline.gz`;
  const t0 = Date.now();
  try {
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
    await page.evaluate((f) => window.__gittimeline.loadArtifact(`/catalog/${f}`), file);
    await page.waitForFunction((s) => window.__gittimeline.source?.slug === s, slug, { timeout: 600000 });
    const info = await page.evaluate(() => ({
      commits: window.__gittimeline.stats.commits,
      merges: window.__gittimeline.stats.merges,
      people: window.__gittimeline.stats.contributors,
      threads: window.__gittimeline.stats.maxConcurrentThreads,
      dots: window.__gittimeline.nodeX?.length ?? null,
      minutes: +(window.__gittimeline.duration / 60).toFixed(1),
    }));
    say({ slug, ok: true, seconds: +((Date.now() - t0) / 1000).toFixed(1), ...info, errs: errs.slice(0, 2) });
  } catch (e) {
    say({ slug, ok: false, seconds: +((Date.now() - t0) / 1000).toFixed(1), why: String(e).split('\n')[0].slice(0, 140), errs: errs.slice(0, 3) });
  } finally {
    await page.close();
  }
}
await b.close();
say({ done: true });
