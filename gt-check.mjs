import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const o = {};
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const a = await page.evaluate(() => window.__gittimeline.time);
await page.waitForTimeout(4000);
o.landingRate = +(((await page.evaluate(() => window.__gittimeline.time)) - a) / 4).toFixed(2);
o.landingDurationMin = await page.evaluate(() => +(window.__gittimeline.duration / 60).toFixed(1));
o.landingCommits = await page.evaluate(() => window.__gittimeline.stats.commits);
o.landingThreads = await page.evaluate(() => window.__gittimeline.stats.maxConcurrentThreads);
o.musicOnLanding = await page.evaluate(() => window.__gittimeline.music?.playing ?? null);
await page.screenshot({ path: process.argv[2] + '/V-landing.png' });
o.lit = await page.evaluate(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=0;i<d.length;i+=16) if(d[i]+d[i+1]+d[i+2]>120) n++; return +(n/(d.length/16)*100).toFixed(2); });

await page.getByRole('button', { name: /play demo/i }).click();
await page.waitForTimeout(2500);
o.whole = !!(await page.$('[data-testid=fit-whole]'));
o.musicWhilePlaying = await page.evaluate(() => window.__gittimeline.music?.playing ?? null);
for (const el of await page.$$('button')) if (((await el.textContent())||'').trim()==='Names') { await el.click(); break; }
await page.waitForTimeout(600);
await page.screenshot({ path: process.argv[2] + '/V-names-off.png' });
o.labelsAfterNamesOff = await page.evaluate(() => window.__gittimeline.settings.labels);
await b.close();
console.log(JSON.stringify(o, null, 1));
