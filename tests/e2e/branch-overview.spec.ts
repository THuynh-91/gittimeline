import { expect, test } from './muted';
import type { Page } from '@playwright/test';
import { waitForReady } from './helpers';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { BranchActivity } from '../../src/model/types';

/**
 * Where the field's ink actually ends, and where the view says the playhead is.
 *
 * This is the observational check for the frontier clip. Every active thread's
 * head sits on the playhead by construction and the rest of its interval has
 * not happened, so there must be no ink to the right of it — and the last
 * round could assert that only by construction. Reading it off the pixels is
 * the difference between "true" and "shown to be true".
 *
 * `--gt-frontier` and `--gt-gutter` are published by the draw loop. `12` is
 * the plot's right padding, and is the one constant this mirrors from the
 * component.
 */
async function inkProfile(page: Page) {
  return await page.evaluate(() => {
    const c = document.querySelector('[data-testid="branch-overview-canvas"]') as HTMLCanvasElement;
    const field = c.parentElement as HTMLElement;
    const style = getComputedStyle(field);
    const frac = parseFloat(style.getPropertyValue('--gt-frontier')) / 100;
    const gutter = parseFloat(style.getPropertyValue('--gt-gutter')) || 0;
    const cssWidth = c.clientWidth;
    const scale = c.width / cssWidth;
    const data = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data;
    let rightmost = -1, inked = 0;
    for (let x = c.width - 1; x >= 0; x--) {
      let any = false;
      for (let y = 0; y < c.height; y++) if (data[(y * c.width + x) * 4 + 3]! > 8) { any = true; inked++; }
      if (any && rightmost < 0) rightmost = x;
    }
    return { frontier: gutter + (cssWidth - gutter - 12) * frac, rightmost: rightmost / scale, inked, cssWidth };
  });
}

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
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(counter).toContainText('lines');
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

    // Everything below reads the canvas back with `getImageData`, and that has
    // to happen *after* the frame measurement. Measured: probing before it
    // took Kubernetes from 60 fps to 37 and Linux from 48 to 35, because one
    // readback is enough for Chromium to stop accelerating that canvas for the
    // rest of its life. A check that quietly halves the thing it is checking
    // is worse than no check.
    //
    // Nothing is drawn after now, read off the frame rather than argued from
    // the code. The tolerance is 5 px because the glyphs that sit *on* the
    // playhead — the head squares, a spark, MASTER's orb — are centred there
    // and so reach a few pixels past it.
    const ink = await inkProfile(page);
    expect(ink.rightmost).toBeLessThan(ink.frontier + 5);
    expect(ink.rightmost).toBeGreaterThan(ink.frontier - 5);
    expect(ink.frontier).toBeLessThan(ink.cssWidth - 40);
    expect(ink.inked).toBeGreaterThan(2000);

    // The camera cannot hide a counted thread. Framing more history, then
    // dragging the playhead as far left as the clamp allows, must leave the
    // heads on screen and the header's arithmetic untouched — invariant 1.
    const before = (await counter.textContent()) ?? '';
    await page.getByTestId('overview-zoom-out').click();
    await page.getByTestId('overview-zoom-out').click();
    const box = (await page.getByTestId('branch-overview-canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.05, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const panned = await inkProfile(page);
    expect(panned.rightmost).toBeGreaterThan(0);
    expect(panned.rightmost).toBeLessThan(panned.frontier + 5);
    expect(panned.frontier).toBeGreaterThan(panned.cssWidth * 0.15);
    expect(await counter.textContent()).toBe(before);
    await page.getByTestId('overview-fit').click();
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
test('the camera frames more or less history without changing the count', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page);
  await page.evaluate(() => window.__gittimeline.loadFixture('05-long-running-side-thread'));
  await waitForReady(page);
  await page.evaluate(() => { const g = window.__gittimeline; g.pause(); g.seek(g.duration * 0.6); });
  await page.getByTestId('toggle-branch-overview').click();
  await expect(page.getByTestId('branch-overview')).toBeVisible();
  const counter = page.getByTestId('branch-overview-count');
  const count = (await counter.textContent()) ?? '';
  const span = page.getByTestId('overview-span');
  await expect(span).toContainText('back');
  const read = async () => {
    const m = /(?:(\d+)m )?(\d+)s/.exec((await span.textContent()) ?? '');
    return m ? Number(m[1] ?? 0) * 60 + Number(m[2]!) : NaN;
  };
  // The auto-framing eases, so a single read can land mid-move. Wait for two
  // identical reads rather than for one that is close to the last.
  const settle = async () => {
    let last = NaN;
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(160);
      const now = await read();
      if (now === last) return now;
      last = now;
    }
    return last;
  };
  await settle();
  // Zoom *in* first, and out second. A fixture is seconds long and the framing
  // is clamped to the duration, so at the auto framing "frame more history" is
  // frequently already saturated — which is correct, and is why WebKit caught
  // this test asserting a direction the view was right to refuse.
  for (let i = 0; i < 3; i++) await page.getByTestId('overview-zoom-in').click();
  const tight = await settle();
  for (let i = 0; i < 3; i++) await page.getByTestId('overview-zoom-out').click();
  const wide = await settle();
  expect(wide).toBeGreaterThan(tight);
  // Fit hands the framing back to the director, which lands somewhere between
  // the two by construction: it is what the tails on stage ask for.
  await page.getByTestId('overview-fit').click();
  const fitted = await settle();
  expect(Number.isNaN(fitted)).toBe(false);
  expect(fitted).toBeGreaterThanOrEqual(tight);
  const spread = page.getByTestId('overview-spread');
  await expect(spread).toHaveText('Open');
  await spread.click();
  await expect(spread).toHaveText('Wide');
  await spread.click();
  await expect(spread).toHaveText('Tight');
  // None of the camera is allowed to change what the header claims.
  expect(await counter.textContent()).toBe(count);
});

test('draws nothing after the playhead, and leaves stage after it', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page);
  await page.evaluate(() => window.__gittimeline.loadFixture('12-merge-storm'));
  await waitForReady(page);
  await page.evaluate(() => { const g = window.__gittimeline; g.pause(); g.seek(g.duration * 0.55); });
  await page.getByTestId('toggle-branch-overview').click();
  await expect(page.getByTestId('branch-overview-count')).toContainText('work in progress');
  await page.waitForTimeout(1800);
  const ink = await inkProfile(page);
  expect(ink.inked).toBeGreaterThan(200);
  expect(ink.rightmost).toBeLessThan(ink.frontier + 5);
  expect(ink.cssWidth - ink.frontier).toBeGreaterThan(30);
});
