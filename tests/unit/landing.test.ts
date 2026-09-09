import { describe, expect, it } from 'vitest';
import { buildLandingDataset } from '@/fixtures/landing';
import type { Dataset } from '@/model/types';

/**
 * The landing history has a shape a chart of bars cannot draw.
 *
 * A review of the landing backdrop: "it reads as a Gantt chart". It did, and
 * the cause was topological rather than cosmetic. Every branch was cut from
 * `main` and merged back into `main`, which is a star; laid out on lanes, a
 * star is parallel horizontal bars with nothing crossing between them, which
 * is what a Gantt chart is.
 *
 * The generator now cuts some branches from other open branches and lands some
 * of them in another branch rather than in `main`. Both are structures a Gantt
 * chart has no way to represent.
 *
 * Measured off the DAG rather than off branch labels, because there are none:
 * `CommitNode` carries `parentShas` and no branch. So the main line is the
 * first-parent chain from the `main` ref, which is what Git itself means by
 * it, and the two claims become label-free statements about where things sit
 * relative to that chain:
 *
 *   a star has every branch point on main, and every merge on main.
 *
 * Both fail the moment either is untrue, which is the point.
 *
 * Not asserted from pixels, and that was tried. Changing the generator changes
 * the history, so two builds at the same clock are two different moments; and
 * the vertical-adjacency statistic that looked like it measured "lines that
 * cross" turned out to scale with how much ink was on the stage. The topology
 * is what changed, so the topology is what is checked.
 */

function mainChain(ds: Dataset): Set<string> {
  const byId = new Map(ds.commits.map((c) => [c.sha, c]));
  const ref = ds.refs.find((r) => r.kind === 'branch' && /(^|\/)main$/.test(r.name))
    ?? ds.refs.find((r) => r.kind === 'branch');
  const chain = new Set<string>();
  let at = ref?.targetSha;
  // First parent only: that is the integration side, and following it is the
  // definition of "on the main line".
  while (at && !chain.has(at)) {
    chain.add(at);
    at = byId.get(at)?.parentShas[0];
  }
  return chain;
}

function childCounts(ds: Dataset): Map<string, number> {
  const kids = new Map<string, number>();
  for (const c of ds.commits) for (const p of c.parentShas) kids.set(p, (kids.get(p) ?? 0) + 1);
  return kids;
}

describe('the landing backdrop is a graph, not a chart of bars', () => {
  // Several seeds, because this is generated and one seed says nothing about
  // the next. The landing advances its seed every time the path restarts.
  for (const seed of ['gitdance', 'gitdance:1', 'gitdance:2', 'landing-7']) {
    it(`seed ${seed}: some branches are cut off the main line`, () => {
      const ds = buildLandingDataset(seed);
      const main = mainChain(ds);
      const kids = childCounts(ds);
      const branchPoints = [...kids].filter(([, n]) => n >= 2).map(([sha]) => sha);
      expect(branchPoints.length, 'the history branches at all').toBeGreaterThan(10);
      const offMain = branchPoints.filter((sha) => !main.has(sha));
      expect(offMain.length, `branch points away from main (of ${branchPoints.length})`).toBeGreaterThan(0);
    });

    it(`seed ${seed}: some merges land somewhere other than main`, () => {
      const ds = buildLandingDataset(seed);
      const main = mainChain(ds);
      const merges = ds.commits.filter((c) => c.parentShas.length > 1);
      expect(merges.length, 'the history merges at all').toBeGreaterThan(4);
      const offMain = merges.filter((m) => !main.has(m.sha));
      expect(offMain.length, `merges away from main (of ${merges.length})`).toBeGreaterThan(0);
    });

    it(`seed ${seed}: the stage still carries enough work to be worth watching`, () => {
      /**
       * The guard against the fix that was tried and reverted.
       *
       * Making each branch's work bursty rather than uniform was the obvious
       * answer to "it reads as bars", and it did break the bars up -- by
       * emptying the stage. Lit pixels on the landing at 32 s fell from 2.54%
       * to 0.74% and the share of rows carrying any ink from 22% to 11%. A
       * starved picture is more chart-like, not less, because what survives is
       * the few longest lines, and it undoes the deliberate widening to
       * fourteen lanes that gave the camera any vertical extent.
       */
      const ds = buildLandingDataset(seed);
      expect(ds.commits.length, 'commits generated').toBeGreaterThan(2000);
      const branches = ds.refs.filter((r) => r.kind === 'branch');
      expect(branches.length, 'branches left on the path').toBeGreaterThan(1);
    });
  }
});
