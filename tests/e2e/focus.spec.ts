import { expect, test } from './muted';
import type { Page } from '@playwright/test';
import { waitForReady } from './helpers';

/**
 * Following a contributor has to light something.
 *
 * The Help panel offers a list of contributors under "Select one to follow
 * their work through the structure". Focusing one dims the stage to 28% and
 * lights that person's work — except that it only ever tested a node's own
 * `contributorIdx`, and on a large history 98 to 99.9% of commits are inside
 * aggregated runs. The arithmetic: Chromium has 923 individually-drawn nodes
 * for 15,832 contributors, 0.058 each; LLVM 0.092; Node 0.214. So selecting
 * almost anybody dimmed everything and lit nothing at all.
 *
 * `AggregateSpan.contributorIds` has always listed everyone inside a run, so
 * the work was in the picture and only missing from the attribution.
 */
test.describe('following a contributor', () => {
  /**
   * Bright pixels on a paused, settled frame, read without `screenshot`.
   *
   * *Bright*, and that is the whole point of the measurement. Focus does not
   * remove anything — it takes what is not the focused contributor's from 0.95
   * down to 0.28 — so counting merely *lit* pixels cannot tell "their work is
   * shown" from "the whole stage was dimmed and nothing was kept". The first
   * version of this test counted lit pixels above a low threshold and passed
   * with the fix reverted, which is the failure mode this project has a
   * written rule about. What survives at full strength is the answer.
   */
  const litPixels = async (page: Page) =>
    page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      const c = document.querySelector('[data-testid="stage-canvas"]') as HTMLCanvasElement;
      // `drawImage` into an offscreen canvas: the stage is `desynchronized`,
      // and `toDataURL` and `page.screenshot` both hang on large plans.
      // At the canvas's own size. Downsampling averages 4x4 blocks, which
      // turns a one-pixel bright line into a sixteenth of its brightness and
      // destroys exactly the signal being measured: the first version of this
      // read 320x200 and could not find any full-strength pixels at all.
      const off = new OffscreenCanvas(c.width, c.height);
      const ctx = off.getContext('2d')!;
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      let bright = 0;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i]! * 0.2126 + d[i + 1]! * 0.7152 + d[i + 2]! * 0.0722;
        if (l > 26) lit++;
        if (l > 140) bright++;
        sum += l;
      }
      return { lit, bright, mean: +(sum / (d.length / 4)).toFixed(2) };
    });

  /**
   * There is no test here for "focusing a contributor lights their work", and
   * that is deliberate rather than an omission.
   *
   * Three attempts, all of which passed with the fix reverted and therefore
   * tested nothing. Counting *lit* pixels cannot work, because focus dims from
   * 0.95 to 0.28 rather than removing anything. Counting *bright* pixels at a
   * downsampled resolution cannot work either, because averaging 4x4 blocks
   * turns a one-pixel line into a sixteenth of its brightness. And counting
   * bright pixels at native resolution on a real shelf entry still cannot
   * work, because the main line is ivory furniture that is never dimmed by
   * contributor focus, so the count has a large floor no choice of contributor
   * can go below.
   *
   * What would settle it is knowing which contributor to pick — one whose
   * commits appear in some aggregate's `contributorIds` and on no node's own
   * `contributorIdx` — and that is not on the test surface. Noted in
   * `docs/notes/status.md` as the way to close it rather than left as a passing test
   * that looks load-bearing.
   */
  test('and nothing is brightened when nobody is focused', async ({ page }) => {
    /**
     * The helper that answers "draw this at full strength" returns true when
     * there is no focus at all, which is right for a node and wrong for the
     * narrower question the commit caps ask. Reading the wider answer there lit
     * every cap on the stage at 0.9 instead of 0.38 whenever nobody was
     * selected — which is most of the time.
     */
    await page.goto('/');
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.loadFixture('11-dense-linear-burst'));
    await waitForReady(page);
    await page.evaluate(() => {
      window.__gittimeline.pause();
      window.__gittimeline.seek(window.__gittimeline.duration);
    });
    await page.waitForTimeout(1000);
    const unfocused = await litPixels(page);

    await page.getByTestId('help-button').click();
    const first = page.locator('.contrib-list button').first();
    await first.click();
    await page.waitForTimeout(500);
    const focused = await litPixels(page);

    // Focus can only ever dim: 0.95 down to 0.28 for what is not theirs, and
    // what is theirs was already at full strength. So no pixel may get
    // brighter, and the mean must not rise.
    expect(focused.mean, `mean luminance ${unfocused.mean} unfocused, ${focused.mean} focused`).toBeLessThanOrEqual(unfocused.mean + 0.01);
  });
});
