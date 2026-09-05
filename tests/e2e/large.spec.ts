import { expect, test } from '@playwright/test';

/**
 * The largest history on the shelf, in its own file so the tracer can be
 * switched off at the top level, which is the only place Playwright allows it.
 *
 * `trace: 'retain-on-failure'` records a screencast of every test and throws it
 * away when the test passes — so a trace is being captured throughout, and
 * capturing one means screenshotting the page. The stage is a `desynchronized`
 * canvas that the compositor does not own, and screenshotting it above roughly
 * forty thousand nodes never returns. The test was not failing: the recorder
 * watching it hung, and took the whole ten-minute budget with it. The same
 * steps outside the tracer run in thirty-five seconds.
 */
test.use({ trace: 'off' });

test.describe('the largest history', () => {
  test('the longest history on the shelf draws something too', async ({ page }) => {
    // The demo is three minutes long, so its camera is keyframed at the
    // nominal step and it could never have caught this. The divergence needs a
    // stretched grid, which needs a long performance — the only ones on the
    // shelf. This is the case that was actually broken.
    //
    // Counted rather than photographed. Reading the pixels back is what the
    // test above does and it is the better check, but it does not survive this
    // size: the stage is a `desynchronized` canvas and above roughly forty
    // thousand nodes both `page.screenshot` and `canvas.toDataURL` stall
    // indefinitely — ten minutes on Linux without returning. `nodesDrawn` is
    // the same question asked of the renderer, and it is exactly the counter
    // that read zero while the plan, the clock and the culling were all
    // behaving perfectly.
    test.setTimeout(600_000);
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
    await page.waitForFunction((s) => window.__gittimeline.source?.slug === s, longest, { timeout: 300_000 });

    const duration = await page.evaluate(() => window.__gittimeline.duration);
    for (const frac of [0.05, 0.4, 0.8]) {
      const drawn = await page.evaluate(async (t) => {
        const g = window.__gittimeline;
        g.seek(t);
        const prof = g.render;
        prof.enabled = true;
        prof.counts.nodesDrawn = 0;
        prof.counts.edgesDrawn = 0;
        g.play();
        await new Promise((r) => setTimeout(r, 1200));
        g.pause();
        prof.enabled = false;
        return { nodes: prof.counts.nodesDrawn, edges: prof.counts.edgesDrawn };
      }, duration * frac);
      expect(drawn.nodes + drawn.edges, `${longest} at ${Math.round(frac * 100)}% of ${(duration / 60).toFixed(0)} min drew ${drawn.nodes} nodes and ${drawn.edges} edges`).toBeGreaterThan(0);
    }
  });
});
