import { expect, test } from './muted';
import { waitForReady } from './helpers';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { BranchActivity } from '../../src/model/types';

for (const stem of ['kubernetes-kubernetes', 'torvalds-linux']) {
  test(`${stem}: global counts, mobile groups, and muted playback`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Large local packages use one engine; fixture interaction runs on all three.');
    const dir = `public/catalog/${stem}.pages`;
    test.skip(!existsSync(`${dir}/manifest.json`), 'Requires locally prepared catalog packages.');
    const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
    test.skip(!manifest.overview, 'Requires an activity overview package.');
    const rows = JSON.parse(gunzipSync(readFileSync(`${dir}/${manifest.overview.file}`)).toString()) as BranchActivity[];
    const events = rows.flatMap(r => [[r.start, 1], [r.end, -1]]).sort((a, b) => a[0]! - b[0]! || b[1]! - a[1]!);
    let active = 0, peak = 0, peakTime = 0;
    for (const [time, delta] of events) { active += delta!; if (active > peak) { peak = active; peakTime = time!; } }
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/'); await waitForReady(page);
    await page.getByTestId('catalog-cta').click();
    await page.getByTestId(`catalog-${stem}`).click();
    await page.getByTestId('scope-full').click();
    await page.waitForFunction(s => window.__gittimeline.source?.slug.replace('/', '-') === s && window.__gittimeline.mode === 'player', stem);
    await page.evaluate(t => { const g = window.__gittimeline; g.pause(); g.seek(t); }, peakTime);
    await page.getByTestId('toggle-branch-overview').click();
    const counter = page.getByTestId('branch-overview-count');
    await expect(counter).toContainText(`${peak} branches with work in progress`, { timeout: 30000 });
    await expect(counter).toContainText(`${peak} lines`);
    await page.waitForFunction(() => !window.__gittimeline.buffering);
    mkdirSync('x/overview-validation', { recursive: true });
    await page.screenshot({ path: `x/overview-validation/${stem}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(counter).toContainText(`${peak} branches with work in progress`);
    await expect(counter).toContainText('groups');
    await page.screenshot({ path: `x/overview-validation/${stem}-phone.png` });
    // Linux exercises the actual 600-line desktop view; Kubernetes exercises
    // phone grouping. Both are measured after decoding and resizing settle.
    if (stem === 'torvalds-linux') await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForFunction(() => !window.__gittimeline.buffering);
    const motion = await page.evaluate(async milliseconds => {
      const g = window.__gittimeline, begin = performance.now(), t = g.time;
      const stamps: number[] = [];
      g.play();
      await new Promise<void>(resolve => { const tick = (stamp: number) => { stamps.push(stamp); if (performance.now() - begin < milliseconds) requestAnimationFrame(tick); else resolve(); }; requestAnimationFrame(tick); });
      g.pause();
      const gaps = stamps.slice(1).map((v, i) => v - stamps[i]!).sort((a, b) => a - b);
      const seconds = (performance.now() - begin) / 1000;
      return { fps: stamps.length / seconds, p99FrameMs: gaps[Math.floor(gaps.length * 0.99)], worstFrameMs: gaps.at(-1), advance: g.time - t, clockRate: (g.time - t) / seconds };
    }, stem === 'torvalds-linux' ? 15000 : 5000);
    console.log(JSON.stringify({ stem, peak, peakTime, ...motion }));
    expect(motion.clockRate).toBeGreaterThan(0.9);
    await page.getByRole('button', { name: 'Choose a branch', exact: true }).click();
    await page.getByRole('button', { name: 'Trace branch', exact: true }).click();
    await expect(page.getByTestId('branch-overview')).toHaveCount(0, { timeout: 25000 });
    await expect(page.getByTestId('panel-inspector')).toBeVisible();
  });
}

test('overview supports keyboard branch selection and returns to the detailed graph', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page);
  await page.evaluate(() => window.__gittimeline.loadFixture('05-long-running-side-thread'));
  await waitForReady(page);
  await page.evaluate(() => { const g = window.__gittimeline; g.pause(); g.seek(g.duration * 0.5); });
  await page.getByTestId('toggle-branch-overview').click();
  await expect(page.getByTestId('branch-overview')).toBeVisible();
  await expect(page.getByTestId('branch-overview-count')).toContainText('work in progress');
  await page.getByRole('button', { name: 'Choose a branch', exact: true }).click();
  await expect(page.getByTestId('overview-branch-select')).toBeVisible();
  await page.getByRole('button', { name: 'Trace branch', exact: true }).click();
  await expect(page.getByTestId('branch-overview')).toHaveCount(0);
  await expect(page.getByTestId('panel-inspector')).toBeVisible();
  expect(await page.evaluate(() => window.__gittimeline.manualCamera)).toBe(true);
});

test('overview fits a phone and can be closed without losing the playhead', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await waitForReady(page);
  await page.evaluate(() => window.__gittimeline.loadFixture('12-merge-storm'));
  await waitForReady(page);
  await page.evaluate(() => { const g = window.__gittimeline; g.pause(); g.seek(g.duration * 0.5); });
  const time = await page.evaluate(() => window.__gittimeline.time);
  await page.getByTestId('toggle-branch-overview').click();
  const box = await page.getByTestId('branch-overview').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Back to graph' }).click();
  expect(await page.evaluate(() => window.__gittimeline.time)).toBeCloseTo(time, 2);
});
