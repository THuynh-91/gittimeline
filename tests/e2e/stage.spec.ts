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

/**
 * What fraction of a grid of samples is brighter than the background?
 *
 * The pixels are taken via `toDataURL` and read back through an `Image`,
 * rather than by drawing the live canvas into an offscreen one. The stage is a
 * `desynchronized` canvas, which the compositor does not own, and reading it
 * directly stalls indefinitely on a large history — `drawImage(canvas, ...)`
 * never returned on Linux's 332,279 nodes, and neither does `page.screenshot`.
 * `toDataURL` does. Getting this wrong once already produced a "the app is
 * broken" report that was really a broken measurement.
 */
async function inkedFraction(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const url = document.querySelector('canvas')!.toDataURL('image/jpeg', 0.7);
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('could not read the stage back'));
      img.src = url;
    });
    const off = document.createElement('canvas');
    off.width = 160;
    off.height = 90;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(img, 0, 0, off.width, off.height);
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
});
