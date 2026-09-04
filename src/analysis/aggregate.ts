import type { AggregateSpan, CommitNode } from '@/model/types';
import type { GraphIndex } from '@/dag/graph';

/**
 * Topology-preserving aggregation (spec §15.1). Only maximal runs of plain,
 * fully-known linear commits inside one thread are collapsed, and the run's
 * entry and exit commits stay exact so every external edge is preserved.
 * Junctions, merges, roots, boundaries, tagged/ref'd commits are protected.
 */
export interface AggregationResult {
  spans: AggregateSpan[];
  /** Aggregate index per node id, or -1. Boundary (entry/exit) nodes stay -1. */
  aggregateOf: Int32Array;
}

export function aggregateLinearRuns(
  g: GraphIndex,
  commits: CommitNode[],
  members: number[][],
  protectedIds: Uint8Array,
  presentation: Float64Array,
  contributorOf: Int32Array,
  contributorIds: string[],
  threshold: number,
  minRun = 6,
): AggregationResult {
  const n = commits.length;
  const aggregateOf = new Int32Array(n).fill(-1);
  const spans: AggregateSpan[] = [];
  if (n <= threshold) return { spans, aggregateOf };

  // Target: shrink visible node count toward the threshold, most aggressively where runs are longest.
  const plain = (id: number) =>
    !protectedIds[id] &&
    g.parents[id]!.length === 1 &&
    commits[id]!.parentShas.length === 1 &&
    g.children[id]!.length === 1;

  members.forEach((ids, threadIdx) => {
    let runStart = -1;
    const flush = (end: number) => {
      // run is ids[runStart..end) of plain commits; keep first and last as exact boundaries
      const len = end - runStart;
      if (runStart >= 0 && len >= minRun) {
        const entry = ids[runStart]!;
        const exit = ids[end - 1]!;
        const inner = ids.slice(runStart + 1, end - 1);
        const contributors = new Set<string>();
        for (const id of inner) contributors.add(contributorIds[contributorOf[id]!]!);
        const idx = spans.length;
        for (const id of inner) aggregateOf[id] = idx;
        spans.push({
          id: `agg-${threadIdx}-${idx}`,
          memberShas: inner.map((id) => g.shas[id]!),
          memberCount: inner.length,
          boundaryShas: [g.shas[entry]!, g.shas[exit]!],
          historicalStart: presentation[inner[0]!]!,
          historicalEnd: presentation[inner[inner.length - 1]!]!,
          level: 1,
          expandable: true,
          contributorIds: [...contributors].sort(),
          provenance: 'aggregate',
        });
      }
      runStart = -1;
    };
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const prev = i > 0 ? ids[i - 1]! : -1;
      const contiguous = prev >= 0 && g.firstParent[id] === prev;
      if (plain(id) && (runStart === -1 || contiguous)) {
        if (runStart === -1) runStart = i;
      } else {
        flush(i);
        if (plain(id)) runStart = i;
      }
    }
    flush(ids.length);
  });

  return { spans, aggregateOf };
}
