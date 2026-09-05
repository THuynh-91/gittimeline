/**
 * Click everything on the landing page and say what breaks.
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173';
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
const notes = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 140)}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 140)}`); });

const mode = () => page.evaluate(() => window.__gittimeline.mode);
const home = async () => {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
};

await home();

// Every control on the landing, in tab order, with its accessible name.
const controls = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('.landing button, .landing a, .landing input')) {
    const r = el.getBoundingClientRect();
    out.push({
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute('data-testid') || '',
      name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 40),
      y: Math.round(r.top),
      x: Math.round(r.left),
      w: Math.round(r.width),
      visible: r.width > 0 && r.height > 0,
    });
  }
  return out;
});
notes.push({ controlCount: controls.length, controls });

// --- Navigation: does each route go, and does Back come home?
for (const [label, testid] of [['catalog', 'catalog-link'], ['signin', 'signin-link'], ['catalog cta', 'catalog-cta']]) {
  await home();
  const el = await page.$(`[data-testid=${testid}]`);
  if (!el) { problems.push(`${label}: control [data-testid=${testid}] not found`); continue; }
  await el.click();
  await page.waitForTimeout(1200);
  const after = await mode();
  notes.push({ nav: label, wentTo: after });

  // Back
  const backs = await page.$$('[data-testid$="-back"], .page-back');
  if (!backs.length) { problems.push(`${label}: no back control on the ${after} page`); continue; }
  await backs[0].click();
  await page.waitForTimeout(1500);
  const home2 = await mode();
  if (home2 !== 'landing') problems.push(`${label}: BACK DID NOT WORK — still in mode "${home2}"`);
  else {
    const moving = await page.evaluate(async () => {
      const a = window.__gittimeline.time;
      await new Promise((r) => setTimeout(r, 1500));
      return Math.abs(window.__gittimeline.time - a) > 0.05;
    });
    if (!moving) problems.push(`${label}: back reached the landing but the demo is frozen`);
  }
}

// --- Browser back button, which is a different thing entirely.
await home();
await page.getByTestId('signin-link').click();
await page.waitForTimeout(900);
await page.goBack().catch(() => {});
await page.waitForTimeout(1200);
const afterBrowserBack = await mode();
notes.push({ browserBack: afterBrowserBack });
if (afterBrowserBack !== 'landing') problems.push(`browser Back: left in mode "${afterBrowserBack}" — history not wired`);

// --- Try chips
await home();
const tryBtns = await page.$$('.ways button');
notes.push({ tryChips: tryBtns.length });

// --- Play with an empty field
await home();
await page.getByTestId('play-button').click();
await page.waitForTimeout(2500);
notes.push({ emptyPlay: await mode() });
if ((await mode()) !== 'player') problems.push('empty PLAY did not start the demo');

// --- Keyboard reachability
await home();
const tab = [];
for (let i = 0; i < 12; i++) {
  await page.keyboard.press('Tab');
  tab.push(await page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName.toLowerCase()}:${(a.getAttribute('data-testid') || a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 26)}` : 'none';
  }));
}
notes.push({ tabOrder: tab });

await b.close();
console.log(JSON.stringify({ problems, notes }, null, 1));
