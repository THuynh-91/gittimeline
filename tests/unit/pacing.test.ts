import { describe, expect, it } from 'vitest';
import { FIXTURES } from '@/fixtures/corpus';
import { buildDemoDataset } from '@/fixtures/demo';
import { compile } from './shared';
import {
  LONG_PERFORMANCE_SECONDS,
  MAX_LEGIBLE_NODES,
  SECONDS_PER_NODE,
  predictVisible,
  willOutrunTheCeiling,
} from '@/choreography/pace';
import type { Dataset, PlaybackPreset } from '@/model/types';

/**
 * Legibility of the pace itself.
 *
 * The failure these guard against is not a crash: it is a large repository
 * whose arrivals are individually correct but land faster than they can be
 * seen. It has appeared three times.
 *
 * Once because aggregation sized the show for 0.26s per commit while the clock
 * then played it at 0.12s. Once because the roller-coaster's dynamic range
 * stayed at full width no matter how dense the history got, so the busiest
 * span of all went past fastest. And once because the *ceiling* silently
 * overrode the per-commit budget: measured on real repositories, mdBook landed
 * at 0.10s a commit and public-apis at 0.16s, both below the flicker
 * threshold, and the corpus never caught it because no fixture was dense
 * enough to reach the cap. `22-merge-dense-decade` exists so that path is
 * exercised. The cap is gone now: length is never bought by making arrivals
 * invisible. A history that needs eleven minutes gets eleven minutes, and the
 * viewer is asked before it is fetched.
 */
const AUTO: PlaybackPreset = { id: 'cinematic', version: 1, targetDuration: 0, reducedMotion: false, aggregateAbove: 900 };

function measure(ds: Dataset) {
  const p = compile(ds, 'pacing', AUTO);
  const t = [...p.nodes].map((n) => n.impact).sort((a, b) => a - b);
  const g = t.slice(1).map((x, i) => x - t[i]!).sort((a, b) => a - b);
  const at = (q: number) => g[Math.floor(g.length * q)] ?? Infinity;
  const merges = ds.commits.filter((c) => c.parentShas.length > 1).length;
  return {
    duration: p.duration,
    nodes: p.nodes.length,
    commits: ds.commits.length,
    mergeRatio: ds.commits.length ? merges / ds.commits.length : 0,
    rate: p.nodes.length / p.duration,
    p10: at(0.1),
    median: at(0.5),
    long: p.duration > LONG_PERFORMANCE_SECONDS,
  };
}

const CASES: Array<[string, Dataset]> = [
  ['demo', buildDemoDataset()],
  ...FIXTURES.filter((f) => f.id !== '20-empty-repository').map((f) => [f.id, f.build()] as [string, Dataset]),
];

describe('pace is watchable at every size', () => {
  for (const [id, ds] of CASES) {
    it(`${id} lands its arrivals slowly enough to be seen`, () => {
      const m = measure(ds);

      // No exceptions and no degraded path. Length is never bought by making
      // arrivals invisible; a history that needs longer simply gets longer.
      expect(m.median, 'the typical arrival holds the stage').toBeGreaterThanOrEqual(0.25);
      expect(m.p10, 'even the fastest tenth stays above the flicker threshold').toBeGreaterThanOrEqual(0.12);
      expect(m.rate, 'arrivals per second stay countable').toBeLessThanOrEqual(4.5);

      // What a long show must guarantee instead is that nobody arrives at one
      // by accident: it is predicted from two probe requests and the viewer is
      // offered a shorter span, with the real length on the button.
      if (m.long) {
        expect(
          willOutrunTheCeiling(m.commits, m.mergeRatio),
          `${id} runs long, so the viewer must have been offered a shorter span`,
        ).toBe(true);
      }
    });
  }

  it('the densest history is slower per commit than it used to be', () => {
    const m = measure(FIXTURES.find((f) => f.id === '21-pull-request-treadmill')!.build());
    expect(m.duration / m.nodes).toBeGreaterThanOrEqual(0.22);
  });

  it('at least one fixture actually runs long, or this suite proves nothing', () => {
    expect(CASES.some(([, ds]) => measure(ds).long)).toBe(true);
  });
});

describe('a history too dense to show whole is predicted before it is fetched', () => {
  /**
   * Measured by compiling the four real histories in the shipped catalog. The
   * numbers are recorded here rather than re-derived because CI has no token
   * and no artifacts; they are what the predictor was fitted against and what
   * it must keep getting right.
   */
  const REAL = [
    { name: 'ripgrep', commits: 2299, mergeRatio: 0.027, visible: 335, outruns: false },
    { name: 'svelte 2023', commits: 860, mergeRatio: 0.031, visible: 235, outruns: false },
    { name: 'public-apis 2021', commits: 1796, mergeRatio: 0.435, visible: 1587, outruns: true },
    { name: 'mdBook', commits: 3296, mergeRatio: 0.316, visible: 2584, outruns: true },
  ];

  it('decides correctly for every real history measured', () => {
    for (const r of REAL) {
      expect(willOutrunTheCeiling(r.commits, r.mergeRatio), `${r.name}`).toBe(r.outruns);
      // The true test of the decision: would the real visible count have fit?
      expect(r.visible > MAX_LEGIBLE_NODES, `${r.name} ground truth`).toBe(r.outruns);
    }
  });

  it('predicts within a factor that keeps the decision safe', () => {
    for (const r of REAL) {
      const predicted = predictVisible(r.commits, r.mergeRatio);
      expect(predicted, `${r.name} not wildly low`).toBeGreaterThan(r.visible * 0.6);
      expect(predicted, `${r.name} not wildly high`).toBeLessThan(r.visible * 2.2);
    }
  });

  it('says nothing when it has nothing to go on', () => {
    expect(willOutrunTheCeiling(null, 0.5)).toBe(false);
    expect(willOutrunTheCeiling(50_000, null)).toBe(false);
  });

  it('a linear history is never called dense, however large', () => {
    expect(willOutrunTheCeiling(100_000, 0)).toBe(false);
    expect(predictVisible(100_000, 0)).toBeLessThanOrEqual(MAX_LEGIBLE_NODES);
  });

  it('a fully merge-bound history is always called dense once it is big enough', () => {
    expect(willOutrunTheCeiling(MAX_LEGIBLE_NODES * 2, 1)).toBe(true);
    expect(willOutrunTheCeiling(100, 1)).toBe(false);
  });

  it('the ceiling and the per-commit budget agree on where the line is', () => {
    expect(MAX_LEGIBLE_NODES * SECONDS_PER_NODE).toBeLessThanOrEqual(LONG_PERFORMANCE_SECONDS);
    expect((MAX_LEGIBLE_NODES + 2) * SECONDS_PER_NODE).toBeGreaterThan(LONG_PERFORMANCE_SECONDS - 5);
  });
});
