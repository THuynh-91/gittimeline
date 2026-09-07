import { expect, test } from './muted';
import { waitForReady } from './helpers';

/**
 * Nothing is drawn before it happens.
 *
 * `tests/unit/reveal.test.ts` asserts the easing never reveals more of a path
 * than has been travelled. That is the cause; this is the effect — the two
 * quantities that were wrong on the stage, asked of a running performance:
 *
 *   `beyondWorld`     commits drawn right of the playhead. Zero by
 *                     construction, from the guard `nd.impact > t + 0.001`.
 *   `edgesPastRule`   drawn *strokes* whose revealed prefix reaches right of
 *                     the playhead. This is the one that was broken, and the
 *                     one nothing was watching: the node guard says nothing
 *                     about a path, and §1a of
 *                     `docs/proposal-present-and-parallel.md` inferred the
 *                     second from the first and was wrong.
 *
 * Measured before the fix, on streamed Kubernetes at 40%: twenty-nine strokes
 * past the playhead, the worst revealed to a screen x of 8,723 — 7,600 px past
 * it, clipped by the frame, which is why it read as lines running off into the
 * future. Bright ink reached the frame's right edge at all six points sampled
 * across that show.
 *
 * Checked by putting the old easing back: `edgesPastRule` goes above zero and
 * this fails, so it is a guard and not a statement. **But only at 95% here** —
 * one of the four points, because the overshoot scales with a merge's reach in
 * x and the demo's merges are short. The load-bearing guard for the cause is
 * `reveal.test.ts`, which fails three ways on the same change; this one
 * watches the effect on a real performance, where the demo is the largest
 * history a browser test can compile in CI. On Kubernetes it would fail at
 * every point sampled.
 *
 * `edgesPastRule` is computed from the point list and the easing *before* the
 * clip in `drawPolyline` is applied, deliberately: it measures whether the
 * reveal is honest on its own, rather than whether the clip is covering for
 * it. Measured after the fix, the clip has nothing left to do — zero at three
 * points on Kubernetes and two on Linux — so it stands as a guarantee against
 * a future easing change, not as a working part.
 *
 * Not asserted here: that no *pixel* sits right of the playhead. It does, and
 * legitimately — 30 to 256 of them on the demo, reaching 40 to 88 px past.
 * They are the nameplate (drawn 50 px right of the head it names), the merge
 * labels (12 px right of their node), and the right half of the disc of a
 * commit centred *on* the present. A pixel threshold cannot tell those from a
 * stroke drawn early, so it would be a test that fails for the wrong reason
 * and passes for the wrong reason.
 */
test.describe('nothing is drawn before it happens', () => {
  for (const at of [0.25, 0.5, 0.75, 0.95]) {
    test(`no commit and no stroke is past the playhead at ${Math.round(at * 100)}% of the demo`, async ({ page }) => {
      await page.goto('/#demo=1');
      await waitForReady(page);
      await page.evaluate((f) => {
        window.__gittimeline.pause();
        window.__gittimeline.seek(window.__gittimeline.duration * f);
      }, at);
      await waitForReady(page);

      const audit = await page.evaluate(async () => {
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))));
        return window.__gittimeline.presentAudit();
      });

      // Two nodes are needed to fix the clock-to-x map at all, and a seek can
      // land where fewer are resident.
      test.skip(!audit || audit.worldX == null, 'the playhead has no position at this point');

      expect(audit!.beyondWorld, 'commits drawn past the playhead').toBe(0);
      expect(audit!.edgesPastRule, 'strokes revealed past the playhead').toBe(0);

      // The map those two are measured against has to be the real one. It is
      // an affine fit through the first and last resident node, which is exact
      // only because `x = naturalTime * X_PER_SECOND` with a single global
      // scale — so a non-trivial residual would mean the geometry had stopped
      // being affine in impact and both numbers above would be meaningless.
      expect(audit!.fitResidualWorld, 'x is affine in impact').toBeLessThan(1);
      // `nonMonotone` counts two things and only one of them can ever fire:
      // it walks `nodesByX`, which is sorted by x, so the x half asserts that
      // a sorted array is sorted. The impact half is the real check — that
      // walking in x order also walks in impact order, without which the
      // affine fit above is fitting a curve.
      expect(audit!.nonMonotone, 'impact rises with x').toBe(0);
    });
  }
});
