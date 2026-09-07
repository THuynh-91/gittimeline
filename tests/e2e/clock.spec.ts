import { expect, test, type Page } from '@playwright/test';
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
    // Below about 1.6 frames a second the frames are longer than the clamp
    // itself, so the clock cannot keep real time and the machine — not this
    // code — is the reason. Say so rather than fail; a loaded box is not a
    // regression. The manufactured interval is 220ms, so this only trips when
    // something else has taken the machine.
    test.skip(seen.fps < 1.6, `machine is loaded (${seen.fps.toFixed(1)} fps, frames longer than the clamp)`);
    // Generous, because the point is the difference between "slower than real
    // time by a rounding error" and "less than half speed". At 220ms a frame
    // the old clamp gave 0.45x by arithmetic: 0.1 of clock for 0.22 of wall.
    expect(seen.rate, `${seen.rate.toFixed(2)}x at ${seen.fps.toFixed(1)} fps`).toBeGreaterThan(0.9);
  });

  test('a device gives up the picture once there is no resolution left to give', async ({ page }) => {
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
    await load(page);
    await page.evaluate(() => (window.__gittimeline.render.enabled = true));

    const before = await page.evaluate(() => window.__gittimeline.render.counts.qualitySteppedDown);

    // Twenty consecutive frames over a tenth of a second is one step, and the
    // counter resets after each, so this is room for two with a margin.
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
        const tick = () => (++n >= 75 ? done() : raf(tick));
        raf(tick);
      });
      blocking = false;
      window.requestAnimationFrame = raf;
    }, 130);

    const after = await page.evaluate(() => window.__gittimeline.render.counts.qualitySteppedDown);
    expect(after - before, 'the picture gave something up').toBeGreaterThan(0);
  });

  test('does not jump when a hidden tab comes back', async ({ page }) => {
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

    // One frame's worth at most, not the second and a half that elapsed.
    expect(jump, `the clock moved ${jump.toFixed(2)}s across the gap`).toBeLessThan(0.2);
  });
});
