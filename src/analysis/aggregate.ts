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

  // 2. Pick one uniform threshold: collapse every run at least `L` long, with
  //    `L` as large as possible while still fitting the budget. Treating all
  //    similar runs identically keeps the picture consistent and deterministic.
  const lengths = [...new Set(candidates.map((c) => c.inner.length))].sort((a, b) => a - b);
  const visibleIf = (L: number) => n - candidates.reduce((s, c) => s + (c.inner.length >= L ? c.inner.length : 0), 0);
  let threshold = lengths[0]!;
  for (let i = lengths.length - 1; i >= 0; i--) {
    if (visibleIf(lengths[i]!) <= visibleBudget) {
      threshold = lengths[i]!;
      break;
    }
  }

  // 3. Materialize the spans, in a stable order.
  const chosen = candidates.filter((c) => c.inner.length >= threshold).sort((a, b) => presentation[a.entry]! - presentation[b.entry]! || (g.shas[a.entry]! < g.shas[b.entry]! ? -1 : 1));
  for (const c of chosen) {
    const contributors = new Set<string>();
    for (const id of c.inner) contributors.add(contributorIds[contributorOf[id]!]!);
    const idx = spans.length;
    for (const id of c.inner) aggregateOf[id] = idx;
    spans.push({
      id: `agg-${c.threadIdx}-${idx}`,
      memberShas: c.inner.map((id) => g.shas[id]!),
      memberCount: c.inner.length,
      boundaryShas: [g.shas[c.entry]!, g.shas[c.exit]!],
      historicalStart: presentation[c.inner[0]!]!,
      historicalEnd: presentation[c.inner[c.inner.length - 1]!]!,
      level: 1,
      expandable: true,
      contributorIds: [...contributors].sort(),
      provenance: 'aggregate',
    });
  }
  return { spans, aggregateOf, collapsedFrom: chosen.length ? threshold : Infinity };
}
