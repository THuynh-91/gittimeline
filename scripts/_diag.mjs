import { chromium } from '@playwright/test';
const token = process.env.GH_TOKEN ?? '';
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 860 } });
const reqs = [];
page.on('response', async (r) => {
  const u = r.url();
  if (!u.startsWith('https://api.github.com/')) return;
  reqs.push(`${r.status()} ${u.replace('https://api.github.com/repos/rust-lang/mdBook', '')} auth=${r.request().headers()['authorization'] ? 'yes' : 'NO'}`);
});
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.__gittimeline);
await page.getByTestId('token-disclosure').click();
await page.getByTestId('landing-token').fill(token);
await page.getByRole('button', { name: 'Use', exact: true }).click();
await page.waitForTimeout(400);
await page.getByTestId('url-input').fill('rust-lang/mdBook');
await page.getByTestId('play-button').click();
const ch = page.getByTestId('scope-chooser');
if (await ch.waitFor({ timeout: 30000 }).then(() => true).catch(() => false)) {
  console.log('scope chooser shown:', (await ch.innerText()).split('\n').slice(0,3).join(' / ').slice(0,180));
  await page.getByTestId('scope-full').click();
}
await page.waitForFunction((w) => window.__gittimeline.source?.slug.toLowerCase() === w, 'rust-lang/mdbook', { timeout: 300000 }).catch(() => console.log('TIMED OUT'));
await page.waitForTimeout(1500);
console.log('stats:', JSON.stringify(await page.evaluate(() => window.__gittimeline.stats)));
console.log('requests:');
for (const r of reqs) console.log('  ', r);
await b.close();
