import { describe, expect, it } from 'vitest';
import { planCamera, sampleCamera, CAMERA_STEP } from '@/choreography/camera';
import type { EdgeGeom, NodeGeom } from '@/model/types';

/**
 * The camera is smoothed by an explicit-Euler spring, which is stable only
 * while the step is under about a third of the spring's period. That was safe
 * while the step was pinned at CAMERA_STEP, and stopped being safe when the
 * keyframe grid was allowed to stretch so a long performance would still fit
 * in MAX_CUES: the step then grows with duration while the periods do not.
 *
 * It does not degrade, it explodes — and `applyCamera` divides the viewport by
 * `cue.w`, so a non-finite frame is a scale of zero and a blank stage. Rust
 * went non-finite 3.2 seconds into a nine-hour plan.
 */
function stage(duration: number) {
  const nodes: NodeGeom[] = [];
  const edges: EdgeGeom[] = [];
  const n = 400;
  for (let i = 0; i < n; i++) {
    const t = (duration * i) / n;
    // A spine that marches right, with threads stepping off it — enough
    // structure that the director changes its mind and the springs are asked
    // to move rather than sit still.
    const y = i % 7 === 0 ? 320 : i % 5 === 0 ? -270 : 0;
    nodes.push({ sha: String(i).padStart(40, '0'), x: i * 96, y, r: 3, t, threadIdx: i % 7 === 0 ? 1 : 0, contributorIdx: 0, kind: 'commit', mergeParents: 0, aggregate: 0, laneSide: 0 } as unknown as NodeGeom);
    if (i > 0) {
      edges.push({ idx: edges.length, parent: i - 1, child: i, kind: 'exact', body: 'spark', threadIdx: 0, contributorIdx: 0,
        start: t, end: t + duration / n, pts: new Float32Array([(i - 1) * 96, 0, i * 96, y]) } as unknown as EdgeGeom);
    }
  }
  return {
    nodes, edges, events: [], duration, tail: duration * 0.04,
    bounds: { minX: 0, minY: -400, maxX: n * 96, maxY: 400 },
    reducedMotion: false,
  };
}

const check = (duration: number) => {
  const cues = planCamera(stage(duration));
  expect(cues.length).toBeGreaterThan(1);
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!;
    const where = `cue ${i} of ${cues.length} at t=${c.time.toFixed(2)}s of a ${duration}s plan`;
    expect(Number.isFinite(c.x), `${where}: x is ${String(c.x)}`).toBe(true);
    expect(Number.isFinite(c.y), `${where}: y is ${String(c.y)}`).toBe(true);
    expect(Number.isFinite(c.w), `${where}: w is ${String(c.w)}`).toBe(true);
    expect(Number.isFinite(c.h), `${where}: h is ${String(c.h)}`).toBe(true);
    // A frame the renderer would divide by must be a real size. The planner's
    // own targets never exceed 2600x1500; anything larger is overshoot, and
    // the renderer has no clamp of its own.
    expect(c.w, `${where}: w is ${c.w}`).toBeGreaterThan(0);
    expect(c.h, `${where}: h is ${c.h}`).toBeGreaterThan(0);
    expect(c.w, `${where}: w is ${c.w}, past the documented maximum`).toBeLessThanOrEqual(2600);
    expect(c.h, `${where}: h is ${c.h}, past the documented maximum`).toBeLessThanOrEqual(1500);
  }
  return cues;
};

describe('camera planning', () => {
  it('stays finite on a short performance', () => {
    const cues = check(400);
    expect(cues[1]!.time - cues[0]!.time).toBeCloseTo(CAMERA_STEP, 6);
  });

  // The three lengths on the shelf that were shipping a divergent camera, and
  // one longer than anything yet built.
  it.each([
    ['VS Code', 5_776],
    ['Kubernetes', 16_381],
    ['Rust', 32_283],
    ['Linux', 43_200],
    ['longer than anything built', 200_000],
  ])(
    'stays finite when the grid is stretched for %s',
    (_name, duration) => {
      const cues = check(duration);
      // The grid really is stretched — otherwise this proves nothing.
      expect(cues[1]!.time - cues[0]!.time).toBeGreaterThan(CAMERA_STEP);
    },
    // Each case plans, smooths and then asserts over 60,001 cues, which is the
    // point — the bug being guarded against only appears once the grid has been
    // stretched to that ceiling. It costs about five seconds a case on an idle
    // machine and rather more on a busy one, so the default five-second limit
    // makes this fail whenever anything else is running rather than whenever
    // the camera is wrong.
    30_000,
  );
});

/**
 * A streamed history hands the sampler only the cues around the playhead, so
 * the array it is given routinely starts thousands of seconds into the show.
 */
describe('sampling a cue track that does not start at zero', () => {
  const cue = (time: number, x: number) => ({ time, x, y: 0, w: 900, h: 480, rotation: 0, punch: 1, reasonEventId: null, state: 'overview' as const });
  // One page of a long plan: forty seconds of cues a quarter-second apart,
  // beginning at t=90, with x sweeping the way a dolly does.
  const page = Array.from({ length: 160 }, (_, i) => cue(90 + i * 0.25, 100_000 + i * 160));

  it('reads the cue for the time asked for, not the last one in the array', () => {
    // Dead centre of the page. Indexed from zero this lands past the end and
    // clamps, which is what froze the camera for a whole page at a time.
    const mid = sampleCamera(page, 110);
    expect(mid.x).toBeCloseTo(100_000 + 80 * 160, 0);
    const early = sampleCamera(page, 92);
    expect(early.x).toBeCloseTo(100_000 + 8 * 160, 0);
    expect(mid.x).toBeGreaterThan(early.x);
  });

  it('keeps moving across the page instead of stepping once at its edge', () => {
    const xs = [95, 100, 105, 110, 115, 120, 125].map((t) => sampleCamera(page, t).x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    // Distinct at every sample — the failure mode was one constant per page.
    expect(new Set(xs).size).toBe(xs.length);
  });

  it('still clamps outside its own range rather than extrapolating', () => {
    expect(sampleCamera(page, 0).x).toBeCloseTo(page[0]!.x, 0);
    expect(sampleCamera(page, 10_000).x).toBeCloseTo(page[page.length - 1]!.x, 0);
  });

  it('is unchanged for a whole plan, whose cues do start at zero', () => {
    const whole = Array.from({ length: 200 }, (_, i) => cue(i * CAMERA_STEP, i * 37));
    expect(sampleCamera(whole, 0).x).toBeCloseTo(0, 0);
    expect(sampleCamera(whole, 10 * CAMERA_STEP).x).toBeCloseTo(370, 0);
  });
});
