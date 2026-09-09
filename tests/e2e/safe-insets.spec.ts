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
});
