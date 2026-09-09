import { expect, test } from './muted';
import { type Page } from '@playwright/test';
import { waitForReady } from './helpers';

/**
 * The persisted, two-way quality ladder, attacked rather than exercised.
 *
 * The ladder steps the picture down when frames are sustainedly slow, now
 * remembers the rung it reached in `localStorage`, and can step back up. Each
 * of those is a way to get a viewer's stage wrong: a remembered rung makes one
 * bad minute permanent, a hostile stored value could break boot outright, and
 * a ladder that moves while paused would break the exact-freeze promise
 * `demo.spec.ts` relies on.
 *
 * Three tests, all deterministic. **Two more were written and deliberately
 * left out**, and the reason matters more than the tests did:
 *
 *   - *Oscillation* -- can the ladder ping-pong between rungs? -- needs CDP CPU
 *     throttling, which timed out at 300 s without completing a single
 *     down-up-down cycle. It is measured outside the suite instead, by
 *     `x/ladder-osc.mjs`: steady throttle at 3x, 5x and 7x for 45 s each, one
 *     or two steps early in each run and none in the last third. The reason it
 *     settles is arithmetic and is asserted cheaply in
 *     `tests/unit/ladder.test.ts`.
 *   - *Climb timing* -- how long a forced floor takes to recover -- measured at
 *     4.66 s once, and that is a number about this machine on that afternoon.
 *
 * Both are timing-dependent, and a timing-dependent test in a suite that gates
 * `main` is worse than no test: this repository already has one intermittent
 * WebKit failure (`docs/reviews/webkit-explore-zoom.md`) and the cost of it is
 * that a red tick no longer means anything. So the suite gets the properties
 * that hold regardless of how fast the machine is, and the stopwatch work
 * lives in `x/` where a human reads it.
 *
 * Adapted from a subagent's `ladder-adversarial.spec.ts`.
 */

const LADDER_KEY = 'gittimeline.ladder.v1';

/** A dense fixture, playing, long enough that the ladder has something to judge. */
const load = async (page: Page) => {
  await page.goto('/');
  await waitForReady(page);
  await page.evaluate(() => window.__gittimeline.loadFixture('12-merge-storm'));
  await waitForReady(page);
  await page.evaluate(() => window.__gittimeline.setDuration(120));
  await waitForReady(page);
  await page.evaluate(() => window.__gittimeline.play());
  await page.waitForTimeout(300);
};

const scaleOf = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid="stage-canvas"]') as HTMLCanvasElement;
    return +(c.width / c.getBoundingClientRect().width).toFixed(3);
  });

/**
 * Block the main thread inside `requestAnimationFrame`.
 *
 * The same provocation `clock.spec.ts` uses, and for the same reason: it gives
 * an exact frame interval in seconds rather than asking CDP to make the whole
 * machine slow and waiting minutes to find out whether it worked.
 */
const blockFrames = (page: Page, blockMs: number, frames: number) =>
  page.evaluate(
    async ([blockMs, frames]) => {
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
          if (window.__gittimeline.time > window.__gittimeline.duration - 3) window.__gittimeline.seek(0);
          return ++n >= frames ? done() : raf(tick);
        };
        raf(tick);
      });
      blocking = false;
    },
    [blockMs, frames] as [number, number],
  );

test.describe('the quality ladder, adversarially', () => {
  test('the ladder cannot move, climb or write storage while paused', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'long main-thread blocking crashes headless WebKit; see clock.spec.ts');
    test.setTimeout(60_000);
    await load(page);
    await page.evaluate(() => window.__gittimeline.pause());
    await page.evaluate(() => (window.__gittimeline.render.enabled = true));
    await page.evaluate((key) => localStorage.removeItem(key), LADDER_KEY);

    const before = await page.evaluate(() => ({ ...window.__gittimeline.render.counts }));
    // Exactly as hard as the provocation that does force a descent while
    // playing, so a pass here means the pause is doing the work and not that
    // the stage was never pushed.
    await blockFrames(page, 110, 260);
    const after = await page.evaluate(() => ({ ...window.__gittimeline.render.counts }));
    const stored = await page.evaluate((key) => localStorage.getItem(key), LADDER_KEY);

    expect(after.dprSteppedDown, 'dpr did not step while paused').toBe(before.dprSteppedDown);
    expect(after.qualitySteppedDown, 'quality did not step while paused').toBe(before.qualitySteppedDown);
    expect(stored, 'nothing was written to storage while paused').toBeNull();
    expect(await scaleOf(page), 'render scale unchanged while paused').toBeGreaterThanOrEqual(1);
  });

  test('a hostile stored rung cannot break boot', async ({ browser }) => {
    test.setTimeout(120_000);
    const hostile: Array<string | null> = [
      null, // the key absent entirely
      'null',
      '{}',
      '"just a string"',
      JSON.stringify({ dpr: 0, quality: 'full' }),
      JSON.stringify({ dpr: -5, quality: 'full' }),
      JSON.stringify({ dpr: 99, quality: 'full' }),
      JSON.stringify({ dpr: 1, quality: 'ultra' }),
      JSON.stringify({ dpr: 1, quality: 5 }),
      JSON.stringify({ dpr: { deeply: { nested: ['junk'] } }, quality: { also: 'junk' } }),
      '[1,2,3]',
      'not json at all {{{',
    ];

    for (const raw of hostile) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const p = await ctx.newPage();
      // The mute fixture wraps `page`'s own context, so a hand-made one has to
      // re-apply the guard or this test is the one thing in the suite making
      // noise.
      await p.addInitScript(() => {
        const el = HTMLMediaElement.prototype;
        const volume = Object.getOwnPropertyDescriptor(el, 'volume')!;
        const muted = Object.getOwnPropertyDescriptor(el, 'muted')!;
        const play = el.play;
        Object.defineProperty(el, 'volume', { configurable: true, get: volume.get, set(this: HTMLMediaElement) { volume.set!.call(this, 0); } });
        Object.defineProperty(el, 'muted', { configurable: true, get: muted.get, set(this: HTMLMediaElement) { muted.set!.call(this, true); } });
        el.play = function () {
          volume.set!.call(this, 0);
          muted.set!.call(this, true);
          return play.call(this);
        };
      });
      const errors: string[] = [];
      p.on('pageerror', (e) => errors.push(String(e)));

      // Before boot, because the store reads storage at module evaluation and
      // a hash-only navigation would not re-run it.
      if (raw !== null) {
        await p.addInitScript(
          ([key, value]) => {
            try {
              localStorage.setItem(key, value);
            } catch {
              /* private mode */
            }
          },
          [LADDER_KEY, raw] as [string, string],
        );
      }

      await p.goto('/');
      await waitForReady(p);
      await p.evaluate(() => window.__gittimeline.loadFixture('12-merge-storm'));
      await waitForReady(p);

      const info = await p.evaluate(() => {
        const c = document.querySelector('[data-testid="stage-canvas"]') as HTMLCanvasElement;
        return { w: c.width, h: c.height, cssW: c.getBoundingClientRect().width };
      });
      const label = JSON.stringify(raw);

      expect(errors, `${label} threw during boot: ${errors.join(' | ')}`).toEqual([]);
      // A rejected value must leave a drawable canvas, not a zero-sized one:
      // `dpr: 0` and `dpr: -5` are the two that would.
      expect(Number.isFinite(info.w) && info.w > 0, `canvas width sane for ${label}: ${info.w}`).toBe(true);
      expect(Number.isFinite(info.h) && info.h > 0, `canvas height sane for ${label}: ${info.h}`).toBe(true);
      expect(Number.isFinite(info.w / info.cssW), `scale is finite for ${label}`).toBe(true);

      await ctx.close();
    }
  });

  test('nothing is remembered unless a rung was actually earned', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
    await page.evaluate((key) => localStorage.removeItem(key), LADDER_KEY);
    await load(page);
    await page.waitForTimeout(3000);

    const r = await page.evaluate((key) => ({
      stored: localStorage.getItem(key),
      steps: window.__gittimeline.render.counts.dprSteppedDown + window.__gittimeline.render.counts.qualitySteppedDown,
    }), LADDER_KEY);

    /**
     * The implication, not the environment.
     *
     * The obvious form of this test asserts storage is empty after three
     * seconds, which assumes the machine never steps down -- true here, and
     * a coin flip on a loaded CI runner, where a genuine step-down would fail
     * a test about persistence for a reason that has nothing to do with it.
     *
     * So it asserts the rule instead: no step, no write. If the runner was
     * slow enough to earn a lower rung then a write is correct and the test
     * says so rather than going red.
     */
    if (r.steps === 0) {
      expect(r.stored, 'no rung earned, so nothing should be remembered').toBeNull();
    } else {
      expect(r.stored, `${r.steps} step(s) were earned, so the rung must be remembered`).not.toBeNull();
    }
  });
});
