import { expect, test } from './muted';
import { waitForReady } from './helpers';

/**
 * The renderer composes inside the page's real chrome, not a constant.
 *
 * `Renderer.settings.safe` is documented as "screen-space safe insets (top
 * chrome, bottom timeline)" and for most of this project's life nothing set
 * it, so its defaults were the value: `bottom: 199`, measured once off a real
 * page and then frozen.
 *
 * It was wrong at every shape measured. `.band` is a column that grows to hold
 * its contents, so it is 239 px at 1600x900, 1280x720 and 844x390, and 271 px
 * at 390x844 where the transport wraps. The frozen 199 therefore let history
 * be drawn into 40 px of the page's own controls on a desktop and 72 px on a
 * phone -- which is the defect `present.spec.ts`'s "the page keeps its
 * controls" was written for, patched at the wrong end.
 *
 * Asserted as an identity against the live elements rather than against a
 * number, so this cannot go stale the way the constant did.
 */
test.describe('the stage composes inside the page', () => {
  for (const [w, h] of [[1600, 900], [1280, 720], [844, 390], [390, 844]] as const) {
    test(`safe insets match the page's chrome at ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/#demo=1');
      await waitForReady(page);
      // The insets are written from a ResizeObserver, so give the layout a
      // frame to settle before reading both sides of the identity.
      await page.waitForTimeout(400);

      const r = await page.evaluate(() => {
        const band = document.querySelector('.band');
        const top = document.querySelector('.topbar, .sitebar');
        return {
          band: band ? Math.round(band.getBoundingClientRect().height) : null,
          top: top ? Math.round(top.getBoundingClientRect().height) : null,
          safe: window.__gittimeline.safeInsets,
        };
      });

      expect(r.safe, 'the renderer reports its insets').not.toBeNull();
      expect(r.band, 'the band is on the page').not.toBeNull();
      expect(r.safe!.bottom, `safe.bottom vs .band height (${JSON.stringify(r)})`).toBe(r.band);
      if (r.top != null && r.top > 0) {
        expect(r.safe!.top, `safe.top vs top chrome height (${JSON.stringify(r)})`).toBe(r.top);
      }
      // And it is not the frozen constant that this replaced.
      expect(r.safe!.bottom, 'not the old hard-coded 199').not.toBe(199);
    });
  }

  /**
   * And the page's furniture cannot re-frame the stage once it has settled.
   *
   * The first version of this measurement observed `.band` with a
   * `ResizeObserver` and followed it forever. The band is a column that grows
   * to hold its contents and the travel slider is *added to it* when a
   * performance ends -- so the slider appeared, the insets changed, the camera
   * re-fitted, and a pan changed zoom. `explore.spec.ts` caught it on WebKit
   * in CI, scale going 0.286 to 0.743, and only there: the same spec passes on
   * Chromium and Firefox, so this could not be reproduced locally.
   *
   * That test checks the symptom a viewer would notice. This one checks the
   * mechanism, so the fix cannot be undone quietly by something that happens
   * to keep the zoom stable.
   */
  test('the band growing at the end of a show does not move the insets', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/#demo=1');
    await waitForReady(page);
    // Past the settle window, so the insets are locked.
    await page.waitForTimeout(1600);
    const before = await page.evaluate(() => ({
      band: Math.round(document.querySelector('.band')!.getBoundingClientRect().height),
      safe: window.__gittimeline.safeInsets!.bottom,
      scale: window.__gittimeline.view?.scale ?? null,
    }));
    expect(before.safe, 'insets match the band before the end').toBe(before.band);

    // To the end, where the travel slider is added to the band.
    await page.evaluate(() => {
      const g = window.__gittimeline;
      g.pause();
      g.seek(g.duration);
    });
    await page.waitForTimeout(1200);

    const after = await page.evaluate(() => ({
      band: Math.round(document.querySelector('.band')!.getBoundingClientRect().height),
      safe: window.__gittimeline.safeInsets!.bottom,
      scale: window.__gittimeline.view?.scale ?? null,
    }));

    // The premise: the band really does grow. If this ever stops being true
    // the test below is vacuous and should be deleted rather than trusted.
    expect(after.band, `the band grows when the show ends (${JSON.stringify({ before, after })})`).toBeGreaterThan(before.band);
    // The invariant: the insets do not follow it.
    expect(after.safe, `insets stay put (${JSON.stringify({ before, after })})`).toBe(before.safe);
  });
});
