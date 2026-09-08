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

/**
 * Nothing is drawn past MASTER, and this time it was read off the canvas.
 *
 * `MAIN_FRONTIER` clips every stroke and drops every commit right of main's
 * newest landed commit, and `canvas.ts` called that airtight. It was not, and
 * nothing here could have caught it: `presentAudit().overhang` counts nodes
 * *eligible* to be drawn rather than nodes drawn, so it reads zero on a frame
 * with a spark, a merge ring and a branch's energy trail all lit past MASTER.
 * `proposal-picture-and-claim.md` section 7 recorded the clip as "implemented
 * and airtight by construction, but unverified observationally". Verified now,
 * and it was false.
 *
 * Four passes went through neither `drawPolyline` nor the node guard:
 *
 *   bodies         the travelling spark, bounded by the playhead through
 *                  `travelU` and by nothing else. 15 performers drawn right of
 *                  main's head on streamed Kubernetes at 25% of its show.
 *   effects        the merge ring, wave and spokes, anchored on a commit that
 *                  might itself be past the frontier.
 *   tip beacons    the pulsing ring on an unmerged branch, which is precisely
 *                  the object most likely to sit past main's head.
 *   drawPartial    the contributor energy trail, which clipped against the
 *                  view window only while its comment claimed it did "the same
 *                  clipping `drawPolyline` does". Under `lighter` compositing,
 *                  so it was the brightest of the four.
 *
 * Measured at 1600x900 with labels off, over four fixtures at four points
 * each, as pixels past `frontierScreenX` at a channel maximum above 80:
 *
 *   before   223, 223, 223, 169, 114, 89, 87, 81, 76, 73, 40, 15, 14, 12, 5, 2
 *   after     15, 13, 12, 11, 10, 9, 9, 9, 7, 6, 6, 6, 6, 5, 4, 2
 *
 * `MAX_SPILL_PX` is 28, which every sample above clears after the fix and ten
 * of sixteen fail before it. It is not zero and cannot be: the commit *at*
 * main's head is drawn, and it is a disc with a radius and a halo, so its
 * right half is legitimately past the line its centre sits on. What the bound
 * says is that nothing with its own position out there is being drawn — and
 * the residual is a glyph radius, which is what 2-15 px is.
 *
 * Labels are turned off at the setting rather than excluded from the scan.
 * MASTER's nameplate stands `PLATE_GAP` (50 px) right of the head it names and
 * merge captions 12 px right of their node; those are labels, not history,
 * and a scan that has to guess which rows to skip is the trap this file's
 * first block declined to walk into. Turning them off removes the guessing.
 */
const MAX_SPILL_PX = 28;

/** Labels off before the app boots: they are legitimately right of the head. */
const LABELS_OFF = () => localStorage.setItem('gittimeline.settings.v1', JSON.stringify({ labels: 'minimal' }));

test.describe('nothing is drawn past MASTER', () => {
  for (const fixture of ['05-long-running-side-thread', '12-merge-storm', '21-pull-request-treadmill', '03-two-parallel-threads']) {
    test(`${fixture}: no ink past main's head`, async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.addInitScript(LABELS_OFF);
      await page.goto('/');
      await waitForReady(page);
      await page.evaluate((f) => window.__gittimeline.loadFixture(f), fixture);
      await waitForReady(page);

      const worst: Array<{ at: number; past: number; front: number; overhang: number }> = [];
      for (const at of [0.2, 0.4, 0.6, 0.8]) {
        await page.evaluate((f) => {
          window.__gittimeline.pause();
          window.__gittimeline.seek(window.__gittimeline.duration * f);
        }, at);
        const r = await page.evaluate(async () => {
          // Three frames, because the camera is smoothed and the frontier is a
          // property of the frame that was drawn rather than of the seek.
          await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))));
          const a = window.__gittimeline.presentAudit();
          if (!a || a.frontierScreenX == null) return null;
          const c = document.querySelector('[data-testid="stage-canvas"]') as HTMLCanvasElement;
          const rect = c.getBoundingClientRect();
          const dpr = c.width / rect.width;
          const off = new OffscreenCanvas(c.width, c.height);
          const o = off.getContext('2d')!;
          o.drawImage(c, 0, 0);
          const { data, width, height } = o.getImageData(0, 0, c.width, c.height);
          let right = -1;
          for (let x = width - 1; x >= 0 && right < 0; x--) {
            for (let y = 0; y < height; y++) {
              const i = (y * width + x) * 4;
              if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) > 80) { right = x; break; }
            }
          }
          return { front: a.frontierScreenX, right: right < 0 ? null : right / dpr, overhang: a.overhang, head: a.mainHeadScreenX, w: rect.width };
        });
        test.skip(!r, 'the frontier has no position at this point');
        // The whole measurement is meaningless if main's head is off the frame:
        // "past the head" would then be most of the stage. It never is — the
        // camera holds it at 86% of the width — and saying so here is what
        // turns that into a checked fact rather than an assumption.
        expect(r!.head, "main's head is on the frame").not.toBeNull();
        expect(r!.head!, "main's head is on the frame").toBeGreaterThan(0);
        expect(r!.head!, "main's head is on the frame").toBeLessThan(r!.w);
        worst.push({ at, past: r!.right == null ? -Infinity : r!.right - r!.front, front: r!.front, overhang: r!.overhang });
      }
      // Reported together so a failure says which point and by how much,
      // rather than stopping at the first one.
      const bad = worst.filter((w) => w.past > MAX_SPILL_PX);
      expect(bad, `ink past main's head, in px: ${JSON.stringify(worst.map((w) => ({ at: w.at, past: Math.round(w.past), overhang: w.overhang })))}`).toEqual([]);
    });
  }

  /**
   * The camera and the audit describe the same point.
   *
   * The head band composes around `spineTip` — the drawn end of main's stroke
   * — and every measurement was reported against the newest landed commit.
   * While the frontier is on those are the same point, because the stroke
   * between the head and the commit after it is clipped away and `spineTip` is
   * clamped to the clip. Before the clamp they differed by however far the
   * current stroke had eased, and one run put main's head at -4030 px on a
   * 1600 px frame with nothing available to say which of the two numbers was
   * being reported.
   *
   * This asserts the *equality*, not a tolerance, because it is an identity
   * and not an approximation. It is conditional on `MAIN_FRONTIER` being on,
   * which is a constant and not a setting for exactly this sort of reason: if
   * it is ever switched off, the eased tip becomes correct again and this test
   * is the thing that should be made to say so.
   */
  for (const at of [0.25, 0.5, 0.75]) {
    test(`the camera's head and the audit's head are one point at ${Math.round(at * 100)}%`, async ({ page }) => {
      await page.goto('/#demo=1');
      await waitForReady(page);
      await page.evaluate((f) => {
        window.__gittimeline.pause();
        window.__gittimeline.seek(window.__gittimeline.duration * f);
      }, at);
      const a = await page.evaluate(async () => {
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))));
        return window.__gittimeline.presentAudit();
      });
      test.skip(!a || a.mainHeadX == null || a.mainTipX == null, 'main has no head at this point');
      expect(a!.mainTipX!, "the drawn end of main's stroke is its newest commit").toBeCloseTo(a!.mainHeadX!, 6);
      expect(a!.frontierX!, 'and the frontier is that same point').toBeCloseTo(a!.mainHeadX!, 6);
      // Which is what makes the screen readings comparable, and the reading
      // the composition is judged on.
      expect(a!.mainTipScreenX!).toBeCloseTo(a!.mainHeadScreenX!, 3);
    });
  }
});
