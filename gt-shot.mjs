/** Scratch: screenshot the catalog page. Deleted when done. */
import { chromium } from 'playwright';
const base = process.env.GT_BASE ?? 'http://localhost:5173';
const dir = process.env.GT_DIR;
const tag = process.env.GT_TAG ?? 'v';
const b = await chromium.launch();
for (const [w, h, name] of [[1440, 900, 'desktop'], [390, 844, 'mobile'], [1440, 2100, 'desktop-tall'], [390, 2600, 'mobile-tall']]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await p.goto(base, { waitUntil: 'load' });
  await p.waitForFunction(() => !!window.__gittimeline, null, { timeout: 30000 });
  await p.getByTestId('catalog-link').click();
  await p.waitForTimeout(2500);
  const cards = await p.locator('.catalog-card').count();
  console.log(`${name} ${w}x${h}: ${cards} cards, errors=${errs.length ? errs.join(' | ') : 'none'}`);
  await p.screenshot({ path: `${dir}/${tag}-${name}.png` });
  await p.close();
}
await b.close();
