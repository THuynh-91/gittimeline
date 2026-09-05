/**
 * Where does a large history stop?
 *
 * Loads one artifact and watches the compile stage change, so a stall can be
 * attributed to a phase instead of guessed at.
 */
import { chromium } from 'playwright';
import { appendFileSync } from 'node:fs';

const out = process.argv[2];
const slug = process.argv[3];
const budgetMs = Number(process.argv[4] ?? 900000);
const say = (o) => { const s = JSON.stringify(o); console.log(s); appendFileSync(out, s + '\n'); };

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1200, height: 700 } });
page.on('pageerror', (e) => say({ slug, pageerror: String(e).slice(0, 200) }));
page.on('console', (m) => { if (m.type() === 'error') say({ slug, consoleError: m.text().slice(0, 200) }); });

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
const file = `${slug.replace('/', '-')}.gittimeline.gz`;

const t0 = Date.now();
await page.evaluate((f) => { window.__gittimeline.loadArtifact(`/catalog/${f}`); }, file);

let lastStage = null;
let done = false;
while (Date.now() - t0 < budgetMs) {
  const s = await page.evaluate((want) => ({
    phase: window.__gittimeline.phase,
    stage: window.__gittimeline.compileStage ?? null,
    progress: window.__gittimeline.progress ?? null,
    slug: window.__gittimeline.source?.slug ?? null,
    dur: window.__gittimeline.duration,
    arrived: window.__gittimeline.source?.slug === want,
  }), slug).catch((e) => ({ evalFailed: String(e).slice(0, 120) }));

  const key = `${s.phase}/${s.stage}`;
  if (key !== lastStage) {
    say({ slug, at: +((Date.now() - t0) / 1000).toFixed(1), ...s });
    lastStage = key;
  }
  if (s.arrived && s.dur > 0) { done = true; break; }
  await new Promise((r) => setTimeout(r, 2000));
}

say({ slug, finished: done, totalSeconds: +((Date.now() - t0) / 1000).toFixed(1) });
if (done) {
  const info = await page.evaluate(() => ({
    commits: window.__gittimeline.stats.commits,
    dots: window.__gittimeline.nodeX?.length ?? null,
    minutes: +(window.__gittimeline.duration / 60).toFixed(1),
    threads: window.__gittimeline.stats.maxConcurrentThreads,
  }));
  say({ slug, ...info });
}
await b.close();
