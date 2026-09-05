import { expect, test, type Page } from '@playwright/test';
import { waitForReady } from './helpers';

/**
 * There is something on the stage.
 *
 * This is the check that was missing. A camera cue with a non-finite frame
 * makes `applyCamera` compute a scale of zero, culling rejects everything, and
 * the performance plays to the end having drawn nothing at all — no error, no
 * warning, a black rectangle with working chrome on top of it. Four of the
 * twelve shipped plans were doing this and every existing test passed.
 *
 * Pixels rather than internals, because every internal was self-consistent:
 * the plan was valid, the renderer did as it was told, the clock advanced.
 */

/** What fraction of a grid of samples is brighter than the background? */
async function inkedFraction(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const off = document.createElement('canvas');
    off.width = 160;
    off.height = 90;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0, off.width, off.height);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      // The stage is near-black; anything the performance draws is brighter
      // than the deepest background gradient by a wide margin.
      if (data[i]! + data[i + 1]! + data[i + 2]! > 90) lit++;
    }
    return lit / (data.length / 4);
  });
}

test.describe('the stage is not blank', () => {
  test('the demo draws something at every point in its run', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    const duration = await page.evaluate(() => window.__gittimeline.duration);

    const readings: string[] = [];
    for (const frac of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      await page.evaluate((t) => window.__gittimeline.seek(t), duration * frac);
      await page.waitForTimeout(350);
      const ink = await inkedFraction(page);
      readings.push(`${Math.round(frac * 100)}%: ${(ink * 100).toFixed(1)}%`);
      expect(ink, `at ${Math.round(frac * 100)}% of the run — readings so far ${readings.join(', ')}`).toBeGreaterThan(0.002);
    }
  });

  test('the camera never asks the renderer to divide by nothing', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    const bad = await page.evaluate(() => {
      const g = window.__gittimeline;
      const out: string[] = [];
      for (let i = 0; i <= 200; i++) {
        const t = (g.duration * i) / 200;
        g.seek(t);
        const c = g.camera;
        if (!c) continue;
        const at = `t=${t.toFixed(1)}s`;
        if (![c.x, c.y, c.w, c.h, c.punch].every((n) => Number.isFinite(n))) out.push(`${at} non-finite`);
        else if (c.w <= 0 || c.h <= 0) out.push(`${at} w=${c.w} h=${c.h}`);
        else if (c.w > 2600 || c.h > 1500) out.push(`${at} frame ${Math.round(c.w)}x${Math.round(c.h)} past the maximum`);
      }
      return out;
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });
  test('the longest history on the shelf draws something too', async ({ page }) => {
    // The demo is three minutes long, so its camera is keyframed at the
    // nominal step and it could never have caught this. The divergence needs a
    // stretched grid, which needs a long performance — the only ones on the
    // shelf. This is the case that was actually broken.
    test.setTimeout(300_000);
    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    const shelf = page.getByTestId('catalog');
    if (!(await shelf.isVisible().catch(() => false))) test.skip(true, 'no catalog built into this bundle');

    const longest = await page.evaluate(async () => {
      const list = (await (await fetch('/catalog/index.json')).json()).entries as Array<{ slug: string; durationSeconds?: number }>;
      return list.reduce((a, b) => ((b.durationSeconds ?? 0) > (a.durationSeconds ?? 0) ? b : a)).slug;
    });
    await shelf.getByTestId(`catalog-${longest.replace('/', '-')}`).click();
    await page.getByTestId('scope-full').click();
    await page.waitForFunction((s) => window.__gittimeline.source?.slug === s, longest, { timeout: 240_000 });

    const duration = await page.evaluate(() => window.__gittimeline.duration);
    for (const frac of [0.05, 0.4, 0.8]) {
      await page.evaluate((t) => window.__gittimeline.seek(t), duration * frac);
      await page.waitForTimeout(500);
      const ink = await inkedFraction(page);
      expect(ink, `${longest} at ${Math.round(frac * 100)}% of ${(duration / 60).toFixed(0)} min`).toBeGreaterThan(0.001);
    }
  });
});
