import type { AggregateSpan, CommitNode } from '@/model/types';
import type { GraphIndex } from '@/dag/graph';

/**
 * Topology-preserving aggregation (spec §15.1).
 *
 * Only maximal runs of plain, fully-known linear commits inside one thread are
 * collapsed, and each run's entry and exit commits stay exact so every external
 * edge survives. Junctions, merges, roots, boundaries and ref targets are
 * protected and never disappear.
 *
 * The amount of aggregation is driven by a *visible budget*: the number of
 * nodes the performance can land inside its target duration while still giving
 * each one a legible beat. A ten-thousand-commit repository therefore becomes a
 * show of the same length as a small one, told through ribbons instead of a
 * five-minute queue of identical dots.
 */
export interface AggregationResult {
  spans: AggregateSpan[];
  /** Aggregate index per node id, or -1. Boundary (entry/exit) nodes stay -1. */
  aggregateOf: Int32Array;
  /** Shortest run length that was collapsed (diagnostics). */
  collapsedFrom: number;
}

interface Candidate {
  threadIdx: number;
  entry: number;
  exit: number;
  inner: number[];
}

export function aggregateLinearRuns(
  g: GraphIndex,
  commits: CommitNode[],
  members: number[][],
  protectedIds: Uint8Array,
  presentation: Float64Array,
  contributorOf: Int32Array,
  contributorIds: string[],
  visibleBudget: number,
  minRun = 3,
): AggregationResult {
  const n = commits.length;
  const aggregateOf = new Int32Array(n).fill(-1);
  const spans: AggregateSpan[] = [];
  if (n <= visibleBudget) return { spans, aggregateOf, collapsedFrom: Infinity };

  const plain = (id: number) =>
    !protectedIds[id] &&
    g.parents[id]!.length === 1 &&
    commits[id]!.parentShas.length === 1 &&
    g.children[id]!.length === 1;

  // 1. Every collapsible run, keeping its exact boundaries.
  //
  // A run's boundaries are the *protected* commits on either side of it — the
  // junction it came from and the one it leads to — rather than the first and
  // last plain commit. That lets every plain commit in the middle collapse
  // while both junctions stay exact, which matters enormously in a repository
  // that merges a pull request for every change: there, almost nothing is a
  // long linear stretch, and boundaries drawn any tighter collapse nothing.
  const candidates: Candidate[] = [];
  members.forEach((ids, threadIdx) => {
    let i = 0;
    while (i < ids.length) {
      if (!plain(ids[i]!)) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < ids.length && plain(ids[j + 1]!) && g.firstParent[ids[j + 1]!] === ids[j]!) j++;
      const hasEntry = i > 0;
      const hasExit = j + 1 < ids.length;
      const entry = hasEntry ? ids[i - 1]! : ids[i]!;
      const exit = hasExit ? ids[j + 1]! : ids[j]!;
      const inner = ids.slice(hasEntry ? i : i + 1, hasExit ? j + 1 : j);
      if (inner.length >= minRun - 2 && inner.length > 0) candidates.push({ threadIdx, entry, exit, inner });
      i = j + 1;
    }
  });
  if (!candidates.length) return { spans, aggregateOf, collapsedFrom: Infinity };

  // 2. Aim *at* the budget rather than merely under it.
  //
  // Collapsing a run whole satisfies any budget, which is how a scoped fetch of
  // a nearly linear year turned two thousand commits into two ribbons and a
  // nine-second show. Instead, long runs are cut into chunks with a real commit
  // kept between each, so the visible count lands near the budget and the
  // ribbons each stand for a comparable amount of work.
  const collapsible = candidates.reduce((sum, c) => sum + c.inner.length, 0);
  const fixed = n - collapsible; // commits that can never be collapsed
  const ribbonsAffordable = Math.max(1, visibleBudget - fixed);
  const chunk = Math.max(2, Math.ceil(collapsible / ribbonsAffordable));

  // 3. Materialize, in a stable order.
  const ordered = [...candidates].sort((a, b) => presentation[a.entry]! - presentation[b.entry]! || (g.shas[a.entry]! < g.shas[b.entry]! ? -1 : 1));
  for (const c of ordered) {
    const seq = [c.entry, ...c.inner, c.exit];
    let kept = 0;
    while (kept < seq.length - 1) {
      const remaining = seq.length - 1 - kept;
      const take = Math.min(chunk, remaining - 1);
      if (take < 2) break; // a ribbon standing for one commit is worse than the commit
      const segment = seq.slice(kept + 1, kept + 1 + take);
      const nextKept = kept + 1 + take;
      const contributors = new Set<string>();
      for (const id of segment) contributors.add(contributorIds[contributorOf[id]!]!);
      const idx = spans.length;
      for (const id of segment) aggregateOf[id] = idx;
      spans.push({
        id: `agg-${c.threadIdx}-${idx}`,
        memberShas: segment.map((id) => g.shas[id]!),
        memberCount: segment.length,
        boundaryShas: [g.shas[seq[kept]!]!, g.shas[seq[nextKept]!]!],
        historicalStart: presentation[segment[0]!]!,
        historicalEnd: presentation[segment[segment.length - 1]!]!,
        level: 1,
        expandable: true,
        contributorIds: [...contributors].sort(),
        provenance: 'aggregate',
      });
      kept = nextKept;
    }
  }
  return { spans, aggregateOf, collapsedFrom: spans.length ? chunk : Infinity };
}
