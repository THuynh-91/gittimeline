/**
 * Render every wordmark option on the real page and photograph each one, so the
 * choice is made by looking rather than by describing.
 */
import { chromium } from 'playwright';

const SHOTS = process.argv[2];
const IVORY = '#f4e9d2';
const ACCENT = '#7fd6ff';
const SLATE = '#6f7d99';
const WARN = '#ffb070';
const DIM = '#b5b1a8';

const VARIANTS = [
  ['A-plain', `<span style="color:${IVORY}">GitTimeline</span>`],
  ['B-both-words', `<span style="color:${ACCENT}">Git</span><span style="color:${IVORY};margin-left:-0.12em">Timeline</span>`],
  ['C-first-word', `<span style="color:${ACCENT}">Git</span><span style="color:${DIM};margin-left:-0.12em">Timeline</span>`],
  ['D-initials', `<span style="color:${ACCENT}">G</span><span style="color:${IVORY}">it</span><span style="color:${ACCENT};margin-left:-0.12em">T</span><span style="color:${IVORY}">imeline</span>`],
  ['E-second-word', `<span style="color:${IVORY}">Git</span><span style="color:${ACCENT};margin-left:-0.12em">Timeline</span>`],
  ['F-weight-only', `<span style="color:${IVORY};font-weight:600">Git</span><span style="color:${IVORY};opacity:0.62;margin-left:-0.12em">Timeline</span>`],
  ['G-slate-second', `<span style="color:${IVORY}">Git</span><span style="color:${SLATE};margin-left:-0.12em">Timeline</span>`],
  ['H-warm', `<span style="color:${WARN}">Git</span><span style="color:${IVORY};margin-left:-0.12em">Timeline</span>`],
];

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1000, height: 190 } });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Freeze the animation so every variant is photographed over the same frame.
await page.evaluate(() => window.__gittimeline.pause());
await page.waitForTimeout(400);

for (const [name, html] of VARIANTS) {
  await page.evaluate((h) => {
    const el = document.querySelector('.title');
    if (el) el.innerHTML = h;
  }, html);
  await page.waitForTimeout(200);
  const el = await page.$('.title');
  await el.screenshot({ path: `${SHOTS}/wm-${name}.png` });
}

// One sheet with all of them stacked, which is the only way to actually compare.
await page.setViewportSize({ width: 1000, height: 900 });
await page.evaluate((variants) => {
  document.body.innerHTML = `<div id="sheet" style="background:#07080c;padding:26px 30px;font-family:ui-sans-serif,system-ui,sans-serif"></div>`;
  const sheet = document.getElementById('sheet');
  for (const [name, html] of variants) {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:20px';
    row.innerHTML =
      `<div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#6f7d99;margin-bottom:5px">${name}</div>` +
      `<div style="font-size:34px;letter-spacing:0.36em;font-weight:300">${html}</div>` +
      `<div style="font-size:12px;letter-spacing:0.24em;text-transform:uppercase;margin-top:7px">${html}</div>`;
    sheet.appendChild(row);
  }
}, VARIANTS);
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/wm-SHEET.png`, fullPage: true });

await b.close();
console.log('rendered', VARIANTS.length, 'variants at hero size and top-bar size');
