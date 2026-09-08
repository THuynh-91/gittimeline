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
 * without filling anything. So a twelfth of the frame has to carry ink of its
 * own, which is the measurement that read 0.00% in six of six samples.
 *
 * ---
 *
 * **The threshold is the band, not three quarters, and that is a decision
 * rather than a measurement.**
 *
 * Everything above is still true: 0.82 does put more history on screen, and
 * this test asserted ink past 0.75 because that followed. The owner then
 * reported 0.82 as "so far right now" against the 55-60% they remembered, and
 * chose the band back at 0.62-0.72. The reasoning against the measurement is
 * that an empty right-hand band is not only waste, it is also headroom: the
 * head sits at the band's left edge, so the space to its right is where
 * arriving work is seen coming.
 *
 * So the ink no longer reaches three quarters, by design. Measured on the demo
 * at 1600x900 after the revert: 62.3%, 67.8% and 62.7% at 35%, 60% and 85%.
 * The floor is 0.58, which the head clears at every sample and which still
 * fails if the camera drifts back towards the middle of the frame -- the
 * original complaint this file exists for. The twelfth checked is the eighth
 * (0.583 to 0.667), where the head actually lands.
 *
 * This is written down rather than deleted because the next person to measure
 * ink per twelfth will find the right of the frame empty and be tempted to
 * "fix" it again. It has been fixed, and then unfixed on purpose.
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
    test(`ink reaches the head band at ${Math.round(at * 100)}% of the demo`, async ({ page }) => {
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
      expect(r.inkFrac!, `the rightmost lit column is at ${(r.inkFrac! * 100).toFixed(1)}% of the width`).toBeGreaterThan(0.58);
      expect(r.twelfths[7], `ink in the eighth twelfth of the frame (all twelve: ${r.twelfths.join(',')})`).toBeGreaterThan(0);
    });
  }
});

/**
 * Nothing is drawn on the page's own controls.
 *
 * The same viewer: "on public-apis the merge rings and their labels (`338
 * commits converge`, `478 commits converge`) are drawn straight through the
 * COMMITS and CONTROLS pills, and the biggest rings are clipped off the bottom
 * edge."
 *
 * They were. `.band`'s background is a gradient that is fully transparent at
 * its own top edge, which is the row the pills sit on, and `.vbtn` is
 * `rgba(7,8,12,0.6)` — so canvas ink under a pill shows *through* it. And the
 * renderer's own idea of how much room the band needs was 150 px, copied from
 * `--band` in the stylesheet, which is a `min-height`: measured off
 * `getBoundingClientRect` at eight window shapes the band is 241 px tall and
 * the pills start 199 px from the bottom. So the stage was composing and
 * captioning into 49 px of the page's controls, and drawing history over all
 * 91 px of it. Lit canvas pixels inside the pills' own boxes, public-apis at
 * 1600x900: 435 of 1,800 and 492 of 1,968 at the worst of eleven points.
 *
 * Zoomed out rather than seeked to that moment. The collision needs content
 * far from the spine, which on a given entry happens at particular times and
 * particular window shapes — and the manual camera reaches the same state on
 * the demo in one call, deterministically, on the path a viewer reaches by
 * scrolling out. Before the fix this puts hundreds of lit pixels in both
 * pills; after it, none, because the stage is clipped to its own bottom edge
 * rather than each stroke being faded by its own height (which cannot work:
 * an active merge edge climbs from an outer lane to the spine, so no single
 * height taken off it is right for most of its length).
 */
test.describe('the page keeps its controls', () => {
  test('no history is drawn on the COMMITS and CONTROLS pills, or off the bottom edge', async ({ page }) => {
    // Short, so the outer lanes reach the bottom of the window. The band is
    // 241 px of any window, so the shorter the window the more of the picture
    // is standing on it — and 620 is a laptop with a browser's chrome on it,
    // not a contrivance.
    await page.setViewportSize({ width: 1280, height: 620 });
    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    if (!(await shelfPresent(page))) test.skip(true, 'no catalog built into this bundle');
    /**
     * The busiest history that still compiles inside a test, rather than the
     * smallest one.
     *
     * The other tests in this file take the smallest artifact on the shelf,
     * for the reason `catalog.spec.ts` gives: naming an entry makes a test
     * about the build script's contents. This one cannot. The collision needs
     * *simultaneous* branches, enough of them for the outer lanes to reach the
     * band, and the smallest entry does not have them — measured at this
     * window on the build before the fix, mdBook puts zero lit pixels below
     * the stage at 40%, 50% and 60% of its run, so the same test written
     * against it would pass before and after and guard nothing. On
     * public-apis, a pull-request treadmill where half the history is merges,
     * it put 148, 699 and 321 pixels inside the COMMITS pill.
     *
     * So the entry is chosen by the property the test needs — the most commits
     * of anything small enough to compile in a browser in seconds — rather
     * than by name. On the shelf as it stands that is public-apis, which is
     * also the entry the viewer was looking at.
     */
    const busiest = await page.evaluate(async () => {
      const list = (await (await fetch(window.__gittimeline.catalogUrl('index.json'))).json()).entries as Array<{ slug: string; bytes: number; commits: number }>;
      const small = list.filter((e) => e.bytes < 1_500_000);
      return small.length ? small.reduce((a, b) => (b.commits > a.commits ? b : a)).slug : null;
    });
    if (!busiest) test.skip(true, 'no shelf entry small enough to compile in a test');
    await page.getByTestId(`catalog-${busiest!.replace('/', '-')}`).click();
    await page.getByTestId('scope-full').click();
    await waitForReady(page);
    const boxes = {
      commits: (await page.getByTestId('toggle-rail').boundingBox())!,
      controls: (await page.getByTestId('toggle-controls').boundingBox())!,
    };

    const seen: Array<{ at: number; commits: number; controls: number; belowStage: number; anyInk: number }> = [];
    for (const at of [0.4, 0.5, 0.6]) {
      await page.evaluate((f) => {
        window.__gittimeline.pause();
        window.__gittimeline.seek(window.__gittimeline.duration * f);
      }, at);
      await page.waitForFunction(() => window.__gittimeline.buffering === false, null, { timeout: 60_000 });
      await page.waitForTimeout(700);
      const r = await page.evaluate(async (rects) => {
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))));
        const c = document.querySelector('[data-testid="stage-canvas"]') as HTMLCanvasElement;
        const box = c.getBoundingClientRect();
        const off = document.createElement('canvas');
        off.width = c.width;
        off.height = c.height;
        const octx = off.getContext('2d')!;
        octx.drawImage(c, 0, 0);
        const { data, width, height } = octx.getImageData(0, 0, off.width, off.height);
        const dpr = c.width / box.width;
        const lit = (x0c: number, y0c: number, x1c: number, y1c: number, skipY: [number, number] | null) => {
          let n = 0;
          const x0 = Math.max(0, Math.round(x0c * dpr));
          const x1 = Math.min(width, Math.round(x1c * dpr));
          const y0 = Math.max(0, Math.round(y0c * dpr));
          const y1 = Math.min(height, Math.round(y1c * dpr));
          for (let y = y0; y < y1; y++) {
            if (skipY && y >= skipY[0] * dpr && y <= skipY[1] * dpr) continue;
            for (let x = x0; x < x1; x++) {
              const i = (y * width + x) * 4;
              if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) > 60) n++;
            }
          }
          return n;
        };
        // 199 CSS px, which is `safe.bottom` — the renderer's own statement of
        // where the stage stops. There is no hook for it, so it is spelled out
        // here with this comment rather than derived from something else.
        const stageBottom = box.height - 199;
        // The nameplate is a label rather than history, and is deliberately
        // clamped to the canvas rather than to the safe area — it detached
        // from the spine when it was clamped to the safe area — so the rows it
        // occupies are excluded.
        const plate = window.__gittimeline.spineLabel;
        const skip: [number, number] | null = plate ? [plate.y - 14, plate.y + 14] : null;
        return {
          commits: lit(rects.commits.x - box.x, rects.commits.y - box.y, rects.commits.x - box.x + rects.commits.width, rects.commits.y - box.y + rects.commits.height, null),
          controls: lit(rects.controls.x - box.x, rects.controls.y - box.y, rects.controls.x - box.x + rects.controls.width, rects.controls.y - box.y + rects.controls.height, null),
          belowStage: lit(0, stageBottom, box.width, box.height, skip),
          // Something has to be drawn at all, or this passes on a blank
          // canvas. Over the whole canvas rather than over the stage, so the
          // number does not move when `safe.bottom` does.
          anyInk: lit(0, 0, box.width, box.height, null),
        };
      }, boxes);
      seen.push({ at, ...r });
    }

    const all = JSON.stringify(seen);
    for (const s of seen) expect(s.anyInk, `the stage is drawing something to keep off the controls at ${s.at} (${all})`).toBeGreaterThan(8000);
    expect(seen.map((s) => s.commits), `lit canvas pixels inside the COMMITS pill (${all})`).toEqual([0, 0, 0]);
    expect(seen.map((s) => s.controls), `lit canvas pixels inside the CONTROLS pill (${all})`).toEqual([0, 0, 0]);
    expect(seen.map((s) => s.belowStage), `lit canvas pixels below the stage, nameplate rows aside (${all})`).toEqual([0, 0, 0]);
  });
});

/**
 * The MAIN chip stands on the line, and is still there later.
 *
 * "The MAIN chip consistently floats 70-100px to the right of the line head
 * it's labelling." It did. It is drawn 50 px right of `spineTip`, whose own
 * comment calls it "the far end of the main line *as drawn*" — and it is not
 * that. It interpolates between the newest landed commit and the next one by
 * how much of the *time* between their impacts has passed, while the stroke is
 * revealed on the *edge's* clock, and on a spine built from ribbons those are
 * not the same. Thirteen frames in mdBook's first six seconds, the gap from
 * the chip to the rightmost lit pixel on its own row: 26, 46, 52, 53, 62, 72,
 * 76, 91, 95, 100, 122, 123, 132 px, against the 50 it was drawn at.
 *
 * The second half is the fade, and it has been reversed. The argument for a
 * floor was that going to zero left the one label naming the main line on
 * screen for 5.2 seconds of a 163-second show, and that those 5.2 seconds are
 * the opening, when there is one line on the stage and nothing for the name to
 * distinguish it from. The owner asked twice for the plate to appear and then
 * fade out, and a floor of 0.3 is not fading out. The key on the stage now
 * names the main line in its own right, so the plate is no longer the only
 * thing that does.
 *
 * So the chip is present for a window and absent afterwards, and this asserts
 * both. The absence is asserted rather than merely tolerated because a floor
 * is a one-character change and reviewers have twice restored it.
 *
 * Measured on the demo at 1600x900: present from about 1 s to about 6 s, which
 * is `PLATE_HOLD` 4 plus `PLATE_FADE` 1.2 from the spine's first commit at
 * roughly 0.8 s. Absent at 0.3 s because the spine has not begun. The gap from
 * the chip to the nearest ink over that window: 16.0, 18.5, 18.0, 19.9 px.
 *
 * The anchor is checked only while the chip is on screen, since it cannot be
 * measured otherwise -- which is exactly why the two halves share a test.
 */
test.describe('the nameplate belongs to the line', () => {
  test('the MAIN chip stands next to the ink for its window, then goes', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    const dur = await page.evaluate(() => window.__gittimeline.duration);
    const seen: Array<{ t: number; gap: number | null; present: boolean }> = [];
    // Absolute seconds, not fractions of the duration. The plate's life is
    // measured from the spine's first commit in real seconds, so on a
    // twelve-hour history a tenth of the duration is hours past the fade.
    // Reading it at fractions is what made the old version of this test claim
    // the chip was permanent.
    const HELD = [1, 2, 3, 4];
    const GONE = [8, dur * 0.5];
    for (const t of [...HELD, ...GONE]) {
      await page.evaluate((tt) => {
        window.__gittimeline.pause();
        window.__gittimeline.seek(tt);
      }, t);
      await page.waitForTimeout(250);
      const r = await page.evaluate(async () => {
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))));
        const plate = window.__gittimeline.spineLabel;
        if (!plate) return { t: window.__gittimeline.time, gap: null, present: false };
        const c = document.querySelector('[data-testid="stage-canvas"]') as HTMLCanvasElement;
        const off = document.createElement('canvas');
        off.width = c.width;
        off.height = c.height;
        const octx = off.getContext('2d')!;
        octx.drawImage(c, 0, 0);
        const { data, width, height } = octx.getImageData(0, 0, off.width, off.height);
        const dpr = c.width / c.getBoundingClientRect().width;
        // The rightmost lit pixel left of the chip, on the chip's own row —
        // which is the end of the main line as a viewer sees it, including the
        // glow of whatever body is arriving there.
        const py = Math.round(plate.y * dpr);
        const px = Math.round(plate.x * dpr);
        for (let x = px - 1; x >= 0; x--) {
          for (let d = -Math.round(9 * dpr); d <= Math.round(9 * dpr); d++) {
            const y = py + d;
            if (y < 0 || y >= height) continue;
            const i = (y * width + x) * 4;
            if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) > 60) return { t: window.__gittimeline.time, gap: plate.x - x / dpr, present: true };
          }
        }
        return { t: window.__gittimeline.time, gap: null, present: true };
      });
      seen.push({ t: Math.round(r.t * 10) / 10, gap: r.gap == null ? null : Math.round(r.gap * 10) / 10, present: r.present });
    }

    const held = seen.slice(0, HELD.length);
    const gone = seen.slice(HELD.length);

    // It is there, on the line, for its window.
    expect(held.filter((s) => !s.present), `the chip is missing during its hold at ${JSON.stringify(seen)}`).toEqual([]);
    expect(held.filter((s) => s.gap == null), `the chip has no line beside it at ${JSON.stringify(seen)}`).toEqual([]);
    // 45 rather than the 30 it is drawn at: the measurement is to the nearest
    // *lit pixel*, and between two commits the nearest lit thing is the line
    // itself, which stops where the stroke stops. Before the fix this ran to
    // 132 px on mdBook. Measured 16-20 px now.
    for (const s of held) expect(s.gap!, `the gap from the chip to the ink at t=${s.t} (all: ${JSON.stringify(seen)})`).toBeLessThan(45);

    // And it is gone afterwards, which is the point of the fade.
    expect(gone.filter((s) => s.present), `the chip is still drawn after the fade at ${JSON.stringify(seen)}`).toEqual([]);
  });
});

/**
 * No caption is drawn twice in the same place.
 *
 * "I caught `v0.0.19` drawn twice, stacked." The data is innocent: the mdBook
 * artifact holds exactly one ref named `v0.0.19`, on one commit (`cba988f0`),
 * and the compiled plan has one node carrying it (node 153). What is doubled
 * is the drawing — thread 104 is a one-commit branch *named* `v0.0.19` whose
 * only node is 153, so the thread pass writes the name at `s.y + side * 13`
 * and the tag pass writes the same seven characters at `s.y - 14`. `place()`
 * throws away an overlap within 14 px of a row and those land 27 px apart,
 * because the node sits above the spine and `side` is +1.
 *
 * A dense sweep rather than a seek to that moment: the tag is on screen for
 * 5.5 s of a 163 s show, so a handful of evenly spaced samples would miss it.
 * One drawn frame per sample is all this needs, so two hundred of them cost a
 * few seconds — and the property is general, so it also catches whatever the
 * next pass to draw the same words twice turns out to be.
 *
 * Measured against a build with only this fix backed out: 14 across 401
 * frames, every one of them between t=20.76 and t=23.20, which is node 153's
 * tag window to the tenth of a second.
 */
test.describe('a caption is not drawn twice', () => {
  test('no two identical captions are stacked, at any point in a real history', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    if (!(await shelfPresent(page))) test.skip(true, 'no catalog built into this bundle');
    const cheapest = await page.evaluate(async () => {
      const list = (await (await fetch(window.__gittimeline.catalogUrl('index.json'))).json()).entries as Array<{ slug: string; bytes: number }>;
      return list.reduce((a, b) => (b.bytes < a.bytes ? b : a)).slug;
    });
    await page.getByTestId(`catalog-${cheapest.replace('/', '-')}`).click();
    await page.getByTestId('scope-full').click();
    await waitForReady(page);

    const r = await page.evaluate(async (n) => {
      const g = window.__gittimeline;
      g.render.enabled = true;
      // Not declared on the shared test type, because it is instrumentation
      // rather than a fact about the show. See `renderProfile.counts`.
      const counts = g.render.counts as unknown as Record<string, number>;
      g.pause();
      const bad: Array<{ t: number; stacked: number }> = [];
      let total = 0;
      for (let i = 0; i <= n; i++) {
        const t = (g.duration * i) / n;
        g.seek(t);
        counts.stackedLabels = 0;
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const c = counts.stackedLabels!;
        total += c;
        if (c > 0 && bad.length < 8) bad.push({ t: Math.round(t * 100) / 100, stacked: c });
      }
      return { total, bad, samples: n + 1 };
    }, 200);

    expect(r.total, `captions drawn twice in the same place, over ${r.samples} frames (first offenders: ${JSON.stringify(r.bad)})`).toBe(0);
  });
});
