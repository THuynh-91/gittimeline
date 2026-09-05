import { chromium } from 'playwright';

const base = process.argv[2];
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const out = {};
page.on('pageerror', (e) => (out.pageerror = String(e).slice(0, 160)));

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// 3. Landing pace.
const a = await page.evaluate(() => window.__gittimeline.time);
await page.waitForTimeout(4000);
const c = await page.evaluate(() => window.__gittimeline.time);
out.landingSecondsPerRealSecond = +((c - a) / 4).toFixed(2);

// Load a short history so the end arrives quickly.
await page.getByRole('button', { name: /play demo/i }).click();
await page.waitForTimeout(1500);
out.musicWhilePlaying = await page.evaluate(() => window.__gittimeline.music?.playing ?? null);

// 2. One switch for every commit name.
const clickBtn = async (label) => {
  for (const el of await page.$$('button')) if (((await el.textContent()) || '').trim() === label) { await el.click(); return true; }
  return false;
};
await clickBtn('Names');
await page.waitForTimeout(500);
out.namesOff = await page.evaluate(() => ({
  rail: !!document.querySelector('.rail'),
  labels: window.__gittimeline.settings?.labels ?? 'n/a',
}));
await clickBtn('Names');

// 1. Music at the end.
await page.evaluate(() => window.__gittimeline.seek(window.__gittimeline.duration - 0.4));
await page.waitForTimeout(3500);
out.atEnd = await page.evaluate(() => ({
  playing: window.__gittimeline.playing,
  t: Math.round(window.__gittimeline.time),
  dur: Math.round(window.__gittimeline.duration),
  music: window.__gittimeline.music?.playing ?? null,
}));

// 4. Whole picture.
await page.evaluate(() => window.__gittimeline.zoom(6));
await page.waitForTimeout(900);
const zoomed = await page.evaluate(() => +window.__gittimeline.viewport.worldW.toFixed(0));
const fit = await page.$('[data-testid=explore-fit]');
out.wholePictureButton = !!fit;
if (fit) {
  await fit.click();
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({ worldW: +window.__gittimeline.viewport.worldW.toFixed(0), bounds: window.__gittimeline.stats ? null : null }));
  out.zoomedWorldW = zoomed;
  out.afterFitWorldW = after.worldW;
  out.zoomedOut = after.worldW > zoomed * 2;
}

await b.close();
console.log(JSON.stringify(out, null, 1));
