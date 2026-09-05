/** Scratch: does a plan baked at one preset correctly decline a different one? Deleted when done. */
import { chromium } from 'playwright';
const base = process.env.GT_BASE ?? 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
const fetched = [];
page.on('request', (r) => { if (r.url().includes('/catalog/')) fetched.push(r.url().split('/').pop()); });

await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__gittimeline, null, { timeout: 60000 });

const run = async (label, setup) => {
  fetched.length = 0;
  await page.evaluate(async (s) => {
    const m = await import('/src/app/controller.ts');
    const store = await import('/src/app/store.ts');
    store.updateSettings(JSON.parse(s));
    m.cancelRun();
  }, JSON.stringify(setup));
  const t0 = Date.now();
  await page.evaluate(async () => {
    const m = await import('/src/app/controller.ts');
    void m.loadCatalogEntry('facebook-react.gittimeline.gz', 'React');
  });
  await page.waitForFunction(() => window.__gittimeline.source?.slug === 'facebook/react', null, { timeout: 300000, polling: 200 });
  const info = await page.evaluate(() => ({ planHash: window.__gittimeline.planHash, duration: Math.round(window.__gittimeline.duration), nodes: window.__gittimeline.nodeX?.length }));
  console.log(`${label.padEnd(26)} ${((Date.now() - t0) / 1000).toFixed(2)}s  ${info.nodes} nodes  ${info.duration}s  ${info.planHash.slice(0, 12)}  fetched=${[...new Set(fetched)].join(',')}`);
  return info;
};

const a = await run('defaults (plan)', { lengthMode: 'natural', reducedMotion: false });
const b = await run('extended (must fall back)', { lengthMode: 'extended' });
const c = await run('reduced motion (fall back)', { lengthMode: 'natural', reducedMotion: true });
const d = await run('back to defaults (plan)', { lengthMode: 'natural', reducedMotion: false });
console.log(`\nsame plan on both default runs: ${a.planHash === d.planHash}`);
console.log(`extended differs from default: ${b.planHash !== a.planHash}`);
console.log(`reduced motion differs:        ${c.planHash !== a.planHash}`);
console.log(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
await browser.close();
