/** Scratch: when does the progress panel change during a long open? Deleted when done. */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const base = process.env.GT_BASE ?? 'http://localhost:4173';
const want = process.argv[2];
const budget = Number(process.env.GT_BUDGET ?? 900) * 1000;
const entry = JSON.parse(readFileSync('public/catalog/index.json', 'utf8')).entries.find((e) => e.slug.toLowerCase().includes(want.toLowerCase()));
const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto(base, { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__gittimeline, null, { timeout: 30000 });
await p.getByTestId('catalog-link').click();
const card = p.getByTestId(`catalog-${entry.slug.replace('/', '-')}`);
await card.waitFor({ state: 'visible', timeout: 15000 });

const t0 = Date.now();
let last = null;
const timeline = [];
const poll = setInterval(() => {
  p.evaluate(() => {
    const el = document.querySelector('[data-testid="prelude"]');
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : null;
  })
    .then((txt) => {
      if (txt !== last) {
        last = txt;
        timeline.push([Date.now() - t0, txt]);
        console.log(`${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(7)}s  ${txt ?? '(no panel)'}`);
      }
    })
    .catch(() => {});
}, 200);

await card.click();
await p.waitForFunction((s) => window.__gittimeline.source?.slug === s, entry.slug, { timeout: budget, polling: 250 });
clearInterval(poll);
console.log(`\n${entry.slug}: first frame at ${((Date.now() - t0) / 1000).toFixed(1)}s after click, ${timeline.length} distinct panel states`);
const gaps = timeline.map((r, i) => (i ? r[0] - timeline[i - 1][0] : r[0]));
console.log(`longest gap with no visible change: ${(Math.max(...gaps, Date.now() - t0 - timeline[timeline.length - 1][0]) / 1000).toFixed(1)}s`);
await b.close();
