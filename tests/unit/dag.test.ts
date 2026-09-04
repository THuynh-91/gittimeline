import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildDataset, type RawCommitRecord } from '@/model/dataset';
import { buildGraph } from '@/dag/graph';
import { correctTimestamps } from '@/dag/time';
import { selectSpine } from '@/dag/spine';
import { assignThreads } from '@/dag/threads';
import { compilePerformance } from '@/choreography/compile';
import type { Dataset, RepositorySource } from '@/model/types';
import { assertInvariants, PRESET } from './shared';

/**
 * Random DAG generator: commits are created in order, each picking 0..3
 * parents among earlier commits (so the graph is acyclic by construction);
 * some parents may be "missing" to simulate partial history; timestamps may
 * be skewed or absent.
 */
const source: RepositorySource = {
  provider: 'synthetic',
  owner: 'prop',
  name: 'repo',
  canonicalUrl: 'synthetic://prop/repo',
  apiUrl: '',
  defaultBranch: 'main',
  selectedRef: 'main',
  selectedTipSha: null,
  fetchedAt: '1970-01-01T00:00:00.000Z',
};

const shaOf = (i: number) => (i + 1).toString(16).padStart(40, '0');

const arbRepo = fc
  .record({
    n: fc.integer({ min: 1, max: 60 }),
    seed: fc.integer({ min: 0, max: 1_000_000 }),
    missing: fc.double({ min: 0, max: 0.15, noNaN: true }),
    skew: fc.double({ min: 0, max: 0.3, noNaN: true }),
  })
  .chain(({ n, seed, missing, skew }) =>
    fc
      .tuple(
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: n, maxLength: n }),
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: n, maxLength: n }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: n, maxLength: n }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: n, maxLength: n }),
      )
      .map(([parentCounts, picks, missRoll, skewRoll]) => {
        const records: RawCommitRecord[] = [];
        const omitted = new Set<number>();
        for (let i = 0; i < n; i++) {
          const count = i === 0 ? 0 : Math.min(i, parentCounts[i]!);
          const parents: string[] = [];
          const used = new Set<number>();
          for (let k = 0; k < count; k++) {
            const p = (picks[i]! * 31 + k * 17 + seed) % i;
            if (used.has(p)) continue;
            used.add(p);
            parents.push(shaOf(p));
          }
          if (i > 0 && parents.length === 0) parents.push(shaOf(i - 1));
          let day = i;
          if (skewRoll[i]! < skew) day = Math.max(0, i - 5);
          const date = skewRoll[i]! > 0.97 ? null : new Date(Date.UTC(2021, 0, 1 + day)).toISOString();
          records.push({ sha: shaOf(i), parents, message: `c${i}`, author: { name: `p${(i * 7 + seed) % 4}`, login: `p${(i * 7 + seed) % 4}`, date } });
          if (i > 0 && i < n - 1 && missRoll[i]! < missing) omitted.add(i);
        }
        const kept = records.filter((_, i) => !omitted.has(i));
        return { kept, tip: shaOf(n - 1), omitted: omitted.size };
      }),
  );

function datasetOf(kept: RawCommitRecord[], tip: string): Dataset {
  return buildDataset({ ...source, selectedTipSha: tip }, kept, [{ kind: 'branch', name: 'main', targetSha: tip }], { truncated: false });
}

describe('DAG invariants (property-based)', () => {
  it('graph index reflects exactly the input parent relations and marks boundaries', () => {
    fc.assert(
      fc.property(arbRepo, ({ kept, tip }) => {
        const ds = datasetOf(kept, tip);
        const g = buildGraph(ds.commits);
        const known = new Set(ds.commits.map((c) => c.sha));
        ds.commits.forEach((c, i) => {
          const knownParents = c.parentShas.filter((p) => known.has(p));
          expect(g.parents[i]!.length).toBe(new Set(knownParents).size);
          expect(c.flags.isBoundary).toBe(c.parentShas.some((p) => !known.has(p)));
          if (c.parentShas.length === 0) expect(g.roots).toContain(i);
        });
        // topological order never violates ancestry
        const pos = new Map<number, number>();
        g.topo.forEach((id, k) => pos.set(id, k));
        for (let i = 0; i < ds.commits.length; i++) for (const p of g.parents[i]!) expect(pos.get(p)!).toBeLessThan(pos.get(i)!);
      }),
      { numRuns: 60 },
    );
  });

  it('timestamps are corrected causally and threads cover every commit exactly once', () => {
    fc.assert(
      fc.property(arbRepo, ({ kept, tip }) => {
        const ds = datasetOf(kept, tip);
        const g = buildGraph(ds.commits);
        const tc = correctTimestamps(g, ds.commits);
        for (let i = 0; i < ds.commits.length; i++) for (const p of g.parents[i]!) expect(tc.presentation[i]!).toBeGreaterThan(tc.presentation[p]!);
        const spine = selectSpine(g, ds, tc.presentation);
        expect(spine.ids.length).toBeGreaterThan(0);
        for (let k = 1; k < spine.ids.length; k++) expect(g.firstParent[spine.ids[k]!]).toBe(spine.ids[k - 1]);
        const th = assignThreads(g, ds, spine, tc.presentation);
        const seen = new Set<number>();
        for (const ids of th.members) for (const id of ids) {
          expect(seen.has(id)).toBe(false);
          seen.add(id);
        }
        expect(seen.size).toBe(ds.commits.length);
        // each thread is a first-parent chain
        for (const ids of th.members) for (let k = 1; k < ids.length; k++) expect(g.firstParent[ids[k]!]).toBe(ids[k - 1]);
      }),
      { numRuns: 60 },
    );
  });

  it('compiled performances satisfy the truth invariants and are deterministic', () => {
    fc.assert(
      fc.property(arbRepo, ({ kept, tip }) => {
        const ds = datasetOf(kept, tip);
        const p = compilePerformance(ds, { preset: { ...PRESET, targetDuration: 30 }, seed: 'prop' });
        assertInvariants(ds, p);
        const q = compilePerformance(ds, { preset: { ...PRESET, targetDuration: 30 }, seed: 'prop' });
        expect(q.planHash).toBe(p.planHash);
      }),
      { numRuns: 40 },
    );
  });

  it('aggregation preserves members and boundary edges for random linear-heavy histories', () => {
    fc.assert(
      fc.property(fc.integer({ min: 30, max: 120 }), fc.integer({ min: 0, max: 5 }), (n, branches) => {
        const records: RawCommitRecord[] = [];
        for (let i = 0; i < n; i++) records.push({ sha: shaOf(i), parents: i ? [shaOf(i - 1)] : [], message: `c${i}`, author: { name: 'a', login: 'a', date: new Date(Date.UTC(2021, 0, 1 + i)).toISOString() } });
        for (let b = 0; b < branches; b++) {
          const base = Math.floor((n * (b + 1)) / (branches + 2));
          const sha = `b${b}`.padEnd(40, 'e');
          records.push({ sha, parents: [shaOf(base)], message: `side ${b}`, author: { name: 'b', login: 'b', date: new Date(Date.UTC(2021, 0, 2 + base)).toISOString() } });
          records.push({ sha: `m${b}`.padEnd(40, 'e'), parents: [shaOf(base + 2), sha], message: `merge ${b}`, author: { name: 'a', login: 'a', date: new Date(Date.UTC(2021, 0, 4 + base)).toISOString() } });
        }
        const ds = buildDataset({ ...source, selectedTipSha: shaOf(n - 1) }, records, [{ kind: 'branch', name: 'main', targetSha: shaOf(n - 1) }]);
        const p = compilePerformance(ds, { preset: { ...PRESET, targetDuration: 20, aggregateAbove: 30 }, seed: 'agg' });
        assertInvariants(ds, p);
        for (const agg of p.aggregates) {
          expect(agg.memberCount).toBe(agg.memberShas.length);
          expect(agg.memberCount).toBeGreaterThan(0);
          const entry = p.nodes.find((nd) => nd.sha === agg.boundaryShas[0]);
          const exit = p.nodes.find((nd) => nd.sha === agg.boundaryShas[1]);
          expect(entry && exit).toBeTruthy();
          expect(p.edges.some((e) => e.kind === 'aggregate' && e.parent === entry!.idx && e.child === exit!.idx)).toBe(true);
        }
      }),
      { numRuns: 25 },
    );
  });
});
