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
 * seen. It has appeared three times. The thresholds below are half what they
 * were, because the pace itself was halved: what used to need 2x on the speed
 * control is now what 1x plays.
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
 *
 * Merge bubbles changed which histories are dense. A run of routine pull
 * requests collapses like a linear run now, so `21-pull-request-treadmill`
 * plays in 82 s instead of 150 s and `22-merge-dense-decade` in 97 s instead of
 * 10.5 minutes. What still cannot collapse is a branch with a story of its own:
 * `23-back-merge-decade` integrates two long-lived lines into each other, so
 * every one of its junctions stays on stage and it runs past eight minutes.
 * That fixture is what keeps the long path exercised now, because without a
 * history that dense the suite would be back to only testing the comfortable
 * one.
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
      expect(m.median, 'the typical arrival holds the stage').toBeGreaterThanOrEqual(0.125);
      expect(m.p10, 'even the fastest tenth stays above the flicker threshold').toBeGreaterThanOrEqual(0.06);
      expect(m.rate, 'arrivals per second stay countable').toBeLessThanOrEqual(9);

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

  it('the histories built on merges are slower per commit than they used to be', () => {
    for (const id of ['21-pull-request-treadmill', '22-merge-dense-decade', '23-back-merge-decade']) {
      const m = measure(FIXTURES.find((f) => f.id === id)!.build());
      expect(m.duration / m.nodes, id).toBeGreaterThanOrEqual(0.11);
    }
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
   *
   * `visible` is what survived aggregation when the predictor was fitted.
   * `now` is the same history re-measured after merge bubbles collapsed, by
   * fetching it anonymously and compiling it: mdBook 2,581 → 1,207 and
   * public-apis 1,587 → 1,171 (its 3,293rd and 3,296th commits differ because
   * the repository moved on between the two measurements). Both of them now
   * come in under the ceiling, so the shorter span they are still offered is a
   * precaution rather than a necessity.
   *
   * The junction floor is left alone anyway. Telling a bubble from a branch
   * with real history behind it needs side-branch lengths that the two probe
   * requests do not carry, and over-offering is the cheap failure: the
   * expensive one is a history that runs eleven minutes with no warning, which
   * is exactly what a decade of back-merges still does.
   */
  const REAL = [
    // Re-measured after the pace halved: a doubled per-commit budget means
    // aggregation collapses less, so every one of these keeps more than it did.
    { name: 'ripgrep', commits: 2299, mergeRatio: 0.027, years: [2016, 2026], visible: 532, now: 532, outruns: false },
    { name: 'svelte 2023', commits: 860, mergeRatio: 0.031, years: [2023, 2023], visible: 343, now: 343, outruns: false },
    { name: 'public-apis 2021', commits: 1796, mergeRatio: 0.435, years: [2021, 2021], visible: 1171, now: 1171, outruns: false },
    { name: 'mdBook', commits: 3296, mergeRatio: 0.316, years: [2015, 2026], visible: 1210, now: 1210, outruns: false },
  ];

  it('never lets a history that outruns the ceiling go unannounced', () => {
    for (const r of REAL) {
      // The promise is one-directional, and that is the whole of it. The
      // decision is made from two probe requests before a single commit has
      // been fetched, so it cannot know how much of the history will collapse
      // into merge bubbles; it is deliberately pessimistic and may offer a
      // shorter span to a history that would in fact have fitted. Offering a
      // span nobody needed costs a dismissed prompt. Not offering one costs
      // eleven minutes of unreadable performance with no warning.
      if (r.outruns) {
        expect(willOutrunTheCeiling(r.commits, r.mergeRatio), `${r.name} must be announced`).toBe(true);
      }
      // Ground truth, both as the predictor was fitted and as re-measured.
      expect(r.visible > MAX_LEGIBLE_NODES, `${r.name} ground truth as fitted`).toBe(r.outruns);
      // Every one of them fits now, which is what the collapsing bought.
      expect(r.now, `${r.name} after bubbles`).toBeLessThan(MAX_LEGIBLE_NODES);
    }
  });

  it('is not pessimistic about everything, which would make it useless', () => {
    // A predictor that always says yes would pass the test above and tell
    // nobody anything. A calm history has to come back clean.
    expect(willOutrunTheCeiling(400, 0.05)).toBe(false);
    expect(willOutrunTheCeiling(2299, 0.027), 'ripgrep, a decade of linear work').toBe(false);
  });

  it('predicts within a factor that keeps the decision safe', () => {
    for (const r of REAL) {
      const predicted = predictVisible(r.commits, r.mergeRatio);
      expect(predicted, `${r.name} not wildly low`).toBeGreaterThan(r.visible * 0.6);
      expect(predicted, `${r.name} not wildly high`).toBeLessThan(r.visible * 2.2);
      // Pessimistic in the one direction that matters: never below what survives.
      expect(predicted, `${r.name} covers what survives`).toBeGreaterThan(r.now);
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
