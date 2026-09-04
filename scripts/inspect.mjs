// Visual inspection: open the app, play the demo, capture frames at key moments, log console errors.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? './shots';
const HASH = process.argv[3] ?? '';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(`http://localhost:4173/${HASH}`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/00-landing.png` });

if (!HASH) {
  // Start the full demo from the landing page.
  await page.getByTestId('play-button').click();
}
await page.waitForTimeout(800);
const times = [2, 6, 10, 14, 18, 22, 26, 30, 36, 42, 48, 54, 58];
for (const t of times) {
  // seek via exposed player? Use keyboard seek: set time directly through the timeline slider is complex; we wait real time instead.
  const current = await page.evaluate(() => window.__gitdance?.time ?? null);
  void current;
  await page.waitForTimeout(t === times[0] ? 1500 : 4000);
  const info = await page.evaluate(() => {
    const clock = document.querySelector('[data-testid="clock"]')?.textContent ?? '';
    const caption = document.querySelector('[data-testid="caption"]')?.textContent ?? '';
    return { clock, caption };
  });
  await page.screenshot({ path: `${OUT}/t-${String(t).padStart(2, '0')}.png` });
  console.log(`shot @${t}s`, info.clock, '|', info.caption);
}
console.log('console issues:', errors.length ? errors : 'none');
await browser.close();
