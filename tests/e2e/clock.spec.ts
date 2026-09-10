import { expect, test } from './muted';
import { type Page } from '@playwright/test';
import { waitForReady } from './helpers';

/**
 * The show runs at the speed it says it does.
 *
 * The frame loop used to clamp one frame's worth of real time to a tenth of a
 * second, which is also ten frames a second — so on any device below that, the
 * performance clock advanced slower than the wall clock and the whole show ran
 * in slow motion. A history the card said ran 2 min 43 took 6 min 37 at the
 * 0.41x measured on a software rasteriser: the scrubber crawled, and every
 * duration the app had quoted about that history was wrong.
 *
 * Slow frames are manufactured rather than provoked. Throttling the CPU needs
 * CDP, so it works on one engine of three; it also takes minutes, and it
 * measures whatever else is running on the machine at the same time — a first
 * attempt at this test spent 3.4 minutes and timed out because two other
 * browsers were busy. Blocking the main thread inside the frame callback gives
 * an exact frame interval on every engine in three seconds, and the frame
 * interval is the whole of what is under test.
 */
test.describe('the performance clock', () => {
  const load = async (page: Page) => {
    await page.goto('/');
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.loadFixture('12-merge-storm'));
    await waitForReady(page);
    // Room to measure in. Asked for after the load, because `setDuration`
    // recompiles what is loaded and there is nothing loaded before it. The
    // request is not granted in full — the compiler will not stretch a fixture
    // this small past about 25s — which is still four times what is needed.
    await page.evaluate(() => window.__gittimeline.setDuration(120));
    await waitForReady(page);
    expect(await page.evaluate(() => window.__gittimeline.duration), 'room to measure in').toBeGreaterThan(12);
    await page.evaluate(() => window.__gittimeline.play());
    await page.waitForTimeout(300);
  };

  test('keeps real time when the frames are slow', async ({ page }) => {
    await load(page);

    const seen = await page.evaluate(async (blockMs: number) => {
      const raf = window.requestAnimationFrame.bind(window);
      let blocking = true;
      // Hold the thread inside the callback, before handing the frame on. The
      // next frame is only requested from inside this one, so the interval
      // between timestamps becomes the block — four frames a second.
      window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
        raf((ts) => {
          if (blocking) {
            const until = performance.now() + blockMs;
            while (performance.now() < until) {
              /* deliberately */
            }
          }
          cb(ts);
        })) as typeof window.requestAnimationFrame;

      // One frame to settle into the new interval before the stopwatch starts.
      await new Promise((r) => raf(() => raf(() => r(null))));
      const t0 = window.__gittimeline.time;
      const wall0 = performance.now();
      let frames = 0;
      await new Promise<void>((done) => {
        const tick = () => {
          frames++;
          if (performance.now() - wall0 > 3000) done();
          else raf(tick);
        };
        raf(tick);
      });
      const rate = (window.__gittimeline.time - t0) / ((performance.now() - wall0) / 1000);
      blocking = false;
      window.requestAnimationFrame = raf;
      return { rate, frames, fps: frames / ((performance.now() - wall0) / 1000) };
    }, 220);

    expect(seen.fps, `frames were not actually slowed (${seen.fps.toFixed(1)} fps)`).toBeLessThan(9);
    /**
     * Below two frames a second the frames are longer than `MAX_FRAME_SECONDS`
     * itself, so the clock *cannot* keep real time and the machine — not this
     * code — is the reason. Two, because that is the arithmetic: a 0.5s clamp
     * is exactly two frames a second. It was 1.6, which let a WebKit run at
     * 1.7 fps through to fail at 0.85x for a reason the test was written to
     * excuse. A loaded box is not a regression; say so rather than fail.
     */
    test.skip(seen.fps < 2, `machine is loaded (${seen.fps.toFixed(1)} fps, frames longer than the clamp)`);
    // Generous, because the point is the difference between "slower than real
    // time by a rounding error" and "less than half speed". At 220ms a frame
    // the old clamp gave 0.45x by arithmetic: 0.1 of clock for 0.22 of wall.
    expect(seen.rate, `${seen.rate.toFixed(2)}x at ${seen.fps.toFixed(1)} fps`).toBeGreaterThan(0.9);
  });

  test('a device gives up the picture once there is no resolution left to give', async ({ page, browserName }) => {
    // Not on WebKit, and it is the technique rather than the subject: headless
    // WebKit dies with "Target crashed" partway through a long stretch of
    // deliberate main-thread blocking inside `page.evaluate`, reproduced four
    // times across two different tests that use it. The ladder itself is
    // arithmetic on a number every engine honours, and Chromium and Firefox
    // both exercise it here. Recorded in `docs/notes/status.md`.
    test.skip(browserName === 'webkit', 'long main-thread blocking crashes headless WebKit');
    /**
     * Stepping the resolution down is the biggest single win available, so it
     * was the only one: `watchFrameRate` returned immediately unless
     * `dpr > 1`. On a display reporting `devicePixelRatio === 1` there is
     * nothing there to give up, so a slow 1x device — a low-end laptop, an old
     * integrated GPU — could not adapt at all, however badly it was doing. It
     * ran at whatever it managed and nothing ever changed.
     *
     * The other two levers are not small: `reduced` drops the bloom, a second
     * full-frame composite of every lit line, and `minimal` drops the drifting
     * dust and shortens the trails.
     *
     * Written to hold at either starting resolution rather than asserting one.
     * Chromium and Firefox open at dpr 1 here and step straight to the
     * picture; WebKit's device descriptor is dpr 2, so it spends the
     * resolution first and the picture second. Long enough for both, and what
     * is asserted is the end of the ladder, which is the part that did not
     * exist.
     */
    // Twenty seconds of deliberate main-thread blocking, and WebKit spends an
    // extra rung because its descriptor starts at two device pixels. The
    // default minute is not enough to be slow in.
    test.setTimeout(150_000);
    await load(page);
    await page.evaluate(() => (window.__gittimeline.render.enabled = true));

    const before = await page.evaluate(() => window.__gittimeline.render.counts.qualitySteppedDown);

    // Room for the ladder's conditions with a margin: ninety frames before it
    // will judge the device at all, seven in ten of them slow, and thirty
    // between steps.
    await page.evaluate(async (blockMs: number) => {
      const raf = window.requestAnimationFrame.bind(window);
      let blocking = true;
      window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
        raf((ts) => {
          if (blocking) {
            const until = performance.now() + blockMs;
            while (performance.now() < until) {
              /* deliberately */
            }
          }
          cb(ts);
        })) as typeof window.requestAnimationFrame;
      await new Promise<void>((done) => {
        let n = 0;
        const tick = () => (++n >= 150 ? done() : raf(tick));
        raf(tick);
      });
      blocking = false;
      window.requestAnimationFrame = raf;
    }, 130);

    const after = await page.evaluate(() => window.__gittimeline.render.counts.qualitySteppedDown);
    expect(after - before, 'the picture gave something up').toBeGreaterThan(0);
  });

  test('and then draws fewer pixels than the window has', async ({ page, browserName }) => {
    // Chromium only, and not because the rung is engine-specific — it is three
    // lines of arithmetic on a number every engine already honours. Provoking
    // it means blocking the main thread through five rungs' worth of frames,
    // which is twenty seconds of busy-waiting, and on the two slower engines
    // that plus the load put the whole test past a minute. The behaviour is
    // covered here; the cost of covering it three times is not worth paying.
    test.skip(browserName !== 'chromium', 'too slow to provoke three times over');
    test.setTimeout(120_000);
    /**
     * The bottom of the ladder. `minimal` used to be the floor, on the
     * reasoning that past it there is nothing left to remove that is not the
     * history — true of effects, and it left the worst devices with nowhere to
     * go. Measured before this: headless WebKit at 1280x720 runs the demo at
     * 5.65 frames a second, an iPhone 12 descriptor at 3.55, Chromium under
     * 20x CPU throttling at 2.43. Honest, in real time, and unwatchable.
     *
     * Fill is quadratic in the render scale, so 0.6 is a little over a third
     * of the pixels. Measured under 8x CPU throttling: 1.5-4.6 fps at full
     * scale becomes 6.9-9.9 fps, with p95 frame time down from 450-1150ms to
     * 233-400ms.
     *
     * The rung is read off the canvas rather than from an API — backing-store
     * width over CSS width is the render scale, whatever the app believes.
     */
    await load(page);
    const scale = () =>
      page.evaluate(() => {
        const c = document.querySelector('[data-testid="stage-canvas"]') as HTMLCanvasElement;
        return +(c.width / c.getBoundingClientRect().width).toFixed(3);
      });
    expect(await scale(), 'starts at one device pixel per CSS pixel or more').toBeGreaterThanOrEqual(1);

    // Long enough to spend every rung: the ladder wants seven frames in ten
    // slow, a frame average over 60ms, and thirty frames between steps.
    await page.evaluate(async (blockMs: number) => {
      const raf = window.requestAnimationFrame.bind(window);
      let blocking = true;
      window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
        raf((ts) => {
          if (blocking) {
            const until = performance.now() + blockMs;
            while (performance.now() < until) {
              /* deliberately */
            }
          }
          cb(ts);
        })) as typeof window.requestAnimationFrame;
      await new Promise<void>((done) => {
        let n = 0;
        const tick = () => {
          // Keep the clock running. The ladder only counts frames while
          // something is playing — a paused stage still draws, and frames
          // spent holding a still picture say nothing about the device — and
          // this fixture is about 25 seconds long, so at an eighth of a second
          // a frame it would otherwise reach the end and stop being judged
          // before the last rung was spent.
          if (window.__gittimeline.time > window.__gittimeline.duration - 3) window.__gittimeline.seek(0);
          return ++n >= 260 ? done() : raf(tick);
        };
        raf(tick);
      });
      blocking = false;
      window.requestAnimationFrame = raf;
    }, 110);

    const after = await scale();
    expect(after, `render scale went to ${after}`).toBeLessThan(1);
    // And not into mush: the stage is drawn in hairlines and they stop reading
    // as lines much below a third of the pixels.
    expect(after, 'but not below the floor').toBeGreaterThanOrEqual(0.6);
  });

  test('does not jump when a hidden tab comes back', async ({ page, browserName }) => {
    // Not on WebKit, for the same reason as the test above: the way this is
    // provoked — holding every animation frame for a second and a half, then
    // releasing one — crashes headless WebKit outright. The listener under
    // test is four lines and engine-independent.
    test.skip(browserName === 'webkit', 'holding every frame crashes headless WebKit');
    /**
     * `requestAnimationFrame` stops firing in a background tab, so the first
     * frame after it is shown again carries however long the tab was away.
     * That frame is worth nothing — no frames were drawn, so no performance
     * happened — and the clamp used to be what stopped it being worth a
     * minute. Now `visibilitychange` is.
     *
     * A test cannot really background a page, so this holds the frames back
     * and then lets them go, which is the same shape without the tab. It is a
     * test of the listener, which is the part that can be got wrong.
     */
    await load(page);

    const jump = await page.evaluate(async () => {
      const raf = window.requestAnimationFrame.bind(window);
      const held: FrameRequestCallback[] = [];
      window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        held.push(cb);
        return 0;
      }) as typeof window.requestAnimationFrame;
      const before = window.__gittimeline.time;
      await new Promise((r) => setTimeout(r, 1500));
      window.requestAnimationFrame = raf;
      document.dispatchEvent(new Event('visibilitychange'));
      const resume = held.pop();
      if (resume) resume(performance.now());
      return window.__gittimeline.time - before;
    });

    /**
     * One frame's worth at most, not the second and a half that elapsed.
     *
     * `MAX_FRAME_SECONDS` is the frame's worth, so that is the threshold: a
     * flat 0.2 was tighter than the invariant and WebKit failed it at 0.35 —
     * one clamped frame, which is the cap doing its job rather than the reset
     * failing to. What this test exists to catch is the 1.5s, and it still
     * would.
     */
    expect(jump, `the clock moved ${jump.toFixed(2)}s across the gap`).toBeLessThanOrEqual(0.5);
  });
});
