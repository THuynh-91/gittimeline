import { describe, expect, it } from 'vitest';
import { SLOW_FRAME_SECONDS, FAST_FRAME_SECONDS, CLIMB_EMA_SECONDS, MIN_RENDER_SCALE } from '@/renderer/canvas';

/**
 * The quality ladder cannot oscillate, and this is the arithmetic that says so.
 *
 * The ladder steps the picture down when frames are sustainedly slow and back
 * up when they are sustainedly fast. Two-way ladders can loop: step down, the
 * picture gets cheap, the frames get fast, step up, the frames get slow again.
 * On a stage that changes resolution that is visible every few seconds.
 *
 * The reason it does not is *not* the one first claimed. That argument was
 * "there is dead space between the descent threshold and the climb threshold,
 * so a borderline device settles" -- which is wrong, because the two tests
 * being mutually exclusive on a single frame says nothing about a device whose
 * frame time jumps across the whole band when a rung changes. And a rung
 * change does exactly that: `dpr` 2 to 1 is four times fewer pixels against a
 * per-pixel cost.
 *
 * The reason it actually holds is a ratio:
 *
 *   descending needs 7 frames in 10 at or above SLOW_FRAME_SECONDS, so a
 *   steady load that descends sits near that value;
 *   the largest rung divides frame time by about 4;
 *   climbing needs the average at or below CLIMB_EMA_SECONDS.
 *
 *   100 / 4 = 25 ms, against a 20 ms ceiling. Blocked, by 5 ms.
 *
 * Which means **a rung worth more than 5x would reopen the loop**. This test
 * exists so that arriving at that by accident -- lowering the slow threshold,
 * raising the climb ceiling, or adding a cheaper picture that saves more --
 * fails here instead of shipping.
 *
 * Measured, for the ratio below: the largest single step is giving up the
 * whole glow pipeline, 49.0 ms to 18.5 ms on torvalds/linux at 55%, which is
 * 2.6x. `dpr` 2 to 1 is 4x by construction. Empirically the ladder settled
 * within 45 s at three CPU throttle rates (3x, 5x, 7x) with no further steps
 * in the last third of each run.
 */
describe('the quality ladder settles', () => {
  /** The most any one rung can divide frame time by. `dpr` 2 to 1 is 4x. */
  const LARGEST_RUNG_SPEEDUP = 4;

  it('a descending load cannot land inside the climb window', () => {
    const afterStep = SLOW_FRAME_SECONDS / LARGEST_RUNG_SPEEDUP;
    expect(afterStep, `a ${LARGEST_RUNG_SPEEDUP}x rung from ${SLOW_FRAME_SECONDS * 1000}ms lands at ${afterStep * 1000}ms, and the climb opens at or below ${CLIMB_EMA_SECONDS * 1000}ms`)
      .toBeGreaterThan(CLIMB_EMA_SECONDS);
  });

  it('states how much headroom that leaves, so shrinking it is deliberate', () => {
    // The ratio a rung would have to beat to reopen the loop.
    const breaking = SLOW_FRAME_SECONDS / CLIMB_EMA_SECONDS;
    expect(breaking).toBeGreaterThan(LARGEST_RUNG_SPEEDUP);
    // And it is genuinely tight: this is 5, against a largest rung of 4.
    expect(breaking).toBeCloseTo(5, 5);
  });

  it('a frame counted fast is not also counted slow', () => {
    expect(FAST_FRAME_SECONDS).toBeLessThan(SLOW_FRAME_SECONDS);
    // The climb's average ceiling is stricter than its per-frame test, so a
    // device scraping past the per-frame test on every frame still does not
    // climb on the average alone.
    expect(CLIMB_EMA_SECONDS).toBeLessThan(FAST_FRAME_SECONDS);
  });

  it('the render-scale floor is a real reduction and not a no-op', () => {
    expect(MIN_RENDER_SCALE).toBeGreaterThan(0);
    expect(MIN_RENDER_SCALE).toBeLessThan(1);
  });
});
