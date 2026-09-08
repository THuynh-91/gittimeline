import { expect, test } from './muted';
import { shelfPresent, waitForReady } from './helpers';

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
 * The closing frame is a picture of the history, and not a picture of nothing.
 *
 * A cold viewer, sent the app knowing only that it plays Git history: "all
 * three repos I finished collapsed to a broken cream dotted line across an
 * otherwise empty black screen, no nodes, no tags, no threads, no tally."
 *
 * Every review before this one measured *coverage* — how much of the history
 * sits inside the closing frame — and each concluded the shot was fixed when
 * coverage went up. Coverage was never the problem. Measured at 1600x900,
 * paused and settled at `t = duration`, before the fix:
 *
 *   rust-lang/mdBook         106.1% of its history in frame, 0.17% of it lit
 *   public-apis/public-apis  106.0%                          0.18%
 *
 * The whole history was in frame and every commit was being drawn. The
 * renderer draws inside `ctx.scale(view.scale, view.scale)`, so a node radius,
 * a stroke width and a lane separation are all in *world* units: at mdBook's
 * closing scale of 0.0106 a lane gap was 0.57 device pixels and a node radius
 * was 0.04. Nothing was missing from the frame. It was all there, a fortieth
 * of a pixel wide.
 *
 * So this asks for the three quantities "no nodes, no threads, no tally" is
 * about, and not for coverage:
 *
 *   lane gap        the world-to-screen scale times `LANE_GAP`. Under a pixel
 *                   and neighbouring branches are the same pixel.
 *   commits/frame   at most one per `TABLEAU_COMMIT_PX` of stage width. 1,220
 *                   commits across 1,232 px is a bar, not a graph, however
 *                   wide each disc is drawn.
 *   lit fraction    read off the canvas, because that is the complaint.
 *
 * On the shelf rather than on the demo, deliberately. The demo is 177 nodes
 * over 15,936 world units, sparse enough that its whole history *can* be
 * drawn — so the bound does not engage there at all, which is the point of
 * expressing it as a density, and is why `fallback.spec.ts` can still ask the
 * demo to end on 95% of itself. The same test written against the demo would
 * pass before the fix and after it, and would guard nothing.
 */
test.describe('the last frame shows the history it just played', () => {
  test('the closing tableau draws commits, threads and tallies rather than a hairline', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    if (!(await shelfPresent(page))) test.skip(true, 'no catalog built into this bundle');
    // The smallest artifact on the shelf, for the same reason `catalog.spec.ts`
    // picks it: naming an entry turns this into a test of the build script's
    // contents. Whichever it is, it is a real history of thousands of commits,
    // which is all this needs.
    const cheapest = await page.evaluate(async () => {
      const list = (await (await fetch(window.__gittimeline.catalogUrl('index.json'))).json()).entries as Array<{ slug: string; bytes: number }>;
      return list.reduce((a, b) => (b.bytes < a.bytes ? b : a)).slug;
    });
    await page.getByTestId(`catalog-${cheapest.replace('/', '-')}`).click();
    await page.getByTestId('scope-full').click();
    await waitForReady(page);
    await page.evaluate(() => {
      window.__gittimeline.pause();
      window.__gittimeline.seek(window.__gittimeline.duration);
    });
    await page.waitForFunction(() => window.__gittimeline.buffering === false, null, { timeout: 60_000 });
    // The closing shot is eased into rather than cut to, so it needs a moment
    // of real time to arrive even from a seek.
    await page.waitForTimeout(1500);

    const shot = await page.evaluate(async () => {
      const g = window.__gittimeline;
      g.render.enabled = true;
      g.render.counts.nodesDrawn = 0;
      g.render.frames = 0;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      const c = document.querySelector('[data-testid="stage-canvas"]') as HTMLCanvasElement;
      const off = document.createElement('canvas');
      off.width = c.width;
      off.height = c.height;
      const octx = off.getContext('2d')!;
      octx.drawImage(c, 0, 0);
      const { data, width, height } = octx.getImageData(0, 0, off.width, off.height);
      // Threshold 60 of 255. The stage is not black — era bands and a vignette
      // wash lay faint colour over the whole frame — so a lower cutoff counts
      // the wash as ink, and a much higher one throws away a branch drawn at
      // 0.3 alpha over a near-black ground.
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) > 60) lit++;
      const v = g.view!;
      const xs = g.nodeX!;
      const left = v.cx - v.worldW / 2;
      const right = v.cx + v.worldW / 2;
      let inFrame = 0;
      for (const x of xs) if (x >= left && x <= right) inFrame++;
      return {
        state: g.camera!.state,
        resident: xs.length,
        inFrame,
        // `LANE_GAP` is 54 world units; spelled out because an end-to-end spec
        // runs in Node without the app's module aliases.
        laneGapPx: v.scale * 54,
        litPct: (lit / (width * height)) * 100,
        // Less 24 CSS px of chrome on each side, which is `safe.left`/`right`.
        safeW: c.getBoundingClientRect().width - 48,
        nodesPerFrame: g.render.frames > 0 ? g.render.counts.nodesDrawn / g.render.frames : 0,
      };
    });

    expect(shot.state, 'the closing shot is the tableau').toBe('tableau');
    expect(shot.resident, 'a catalog entry is a real history').toBeGreaterThan(400);
    // One commit per eight pixels of stage. See `TABLEAU_COMMIT_PX`. The 1.25
    // allows for the margin past the head and for a commit sitting on the
    // frame's own edge. It does not allow for 1,220.
    expect(shot.inFrame, `commits in the closing frame (${shot.inFrame} of ${shot.resident} resident)`).toBeLessThan((shot.safeW / 8) * 1.25);
    expect(shot.inFrame, 'the closing frame is of the ending, not of nothing').toBeGreaterThan(20);
    expect(shot.laneGapPx, `lane gap in the closing frame: ${shot.laneGapPx.toFixed(2)} px`).toBeGreaterThan(6);
    expect(shot.litPct, `lit fraction of the closing frame: ${shot.litPct.toFixed(3)}%`).toBeGreaterThan(0.3);
    expect(shot.nodesPerFrame, 'commits are actually drawn').toBeGreaterThan(20);
  });
});

/**
 * The right of the stage carries ink.
 *
 * The same viewer: "the frontier never gets past about 60% of the width." She
 * was describing the arithmetic rather than an impression. The camera holds
 * main's drawn head inside a band; the correction only ever pushes it back to
 * the *near* edge of that band; and the director composes around the phrase it
 * is playing, which is almost always left of the head — so the head is not
 * somewhere in a band, it is pinned at its left edge. That edge was
 * `width * 0.6`. Measured on mdBook, thirteen consecutive frames in the first
 * six seconds: the nameplate's x was a constant 1010 in a 1600-wide window,
 * which is the head at exactly 960, which is `width * 0.6` to the pixel.
 *
 * And nothing is drawn right of the head, by construction — that is what the
 * tests at the top of this file are for. So the band was setting the empty
 * share of the frame directly. Ink per horizontal twelfth at threshold 60, six
 * samples across mdBook and public-apis at 1600x900: the last four twelfths
 * read 0.00% in six of six, and the rightmost lit column sat between 59.9% and
 * 74.7% of the frame.
 *
 * Two assertions, because the first alone is satisfiable by the wrong thing:
 * one caption placed near the right edge would move the rightmost lit column
 * without filling anything. So the ninth and tenth twelfths of the frame each
 * have to carry ink of their own, which is the measurement that read 0.00% in
 * six of six samples.
 *
 * Not asserted: `presentAudit().mainHeadScreenX`. That is main's newest
 * *landed commit*, and the camera composes around the drawn end of the stroke,
 * which runs ahead of it by up to a commit gap — 0.23 of the width at 35% of
 * the demo, where a long ribbon sits on the spine. So the landed commit reads
 * 0.590 of the width after this change and would have read 0.371 before it:
 * improved by exactly the same 0.22, and useless as an absolute threshold,
 * because any bound that fails at 0.371 also fails at 0.590. The ink is both
 * the honest quantity and the one the viewer named.
 */
test.describe('the frontier reaches the right of the frame', () => {
  for (const at of [0.35, 0.6, 0.85]) {
    test(`ink reaches past three quarters of the width at ${Math.round(at * 100)}% of the demo`, async ({ page }) => {
      await page.goto('/#demo=1');
      await waitForReady(page);
      await page.evaluate((f) => {
        window.__gittimeline.pause();
        window.__gittimeline.seek(window.__gittimeline.duration * f);
      }, at);
      await waitForReady(page);

      const r = await page.evaluate(async () => {
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))));
        const c = document.querySelector('[data-testid="stage-canvas"]') as HTMLCanvasElement;
        const off = document.createElement('canvas');
        off.width = c.width;
        off.height = c.height;
        const octx = off.getContext('2d')!;
        octx.drawImage(c, 0, 0);
        const { data, width, height } = octx.getImageData(0, 0, off.width, off.height);
        const twelfths = new Array(12).fill(0) as number[];
        const per = Math.ceil(width / 12);
        let rightmost = -1;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) > 60) {
              twelfths[Math.min(11, Math.floor(x / per))]!++;
              if (x > rightmost) rightmost = x;
            }
          }
        }
        return { inkFrac: rightmost < 0 ? null : rightmost / width, twelfths };
      });

      test.skip(r.inkFrac == null, 'nothing is drawn at this point');
      expect(r.inkFrac!, `the rightmost lit column is at ${(r.inkFrac! * 100).toFixed(1)}% of the width`).toBeGreaterThan(0.75);
      expect(r.twelfths[8], `ink in the ninth twelfth of the frame (all twelve: ${r.twelfths.join(',')})`).toBeGreaterThan(0);
      expect(r.twelfths[9], `ink in the tenth twelfth of the frame (all twelve: ${r.twelfths.join(',')})`).toBeGreaterThan(0);
    });
  }
});
