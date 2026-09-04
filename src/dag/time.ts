import type { CommitNode } from '@/model/types';
import { rawTimeOf, type GraphIndex } from './graph';

export interface TimeCorrection {
  /** Presentation time per node id. */
  presentation: Float64Array;
  correctedCount: number;
  /** Ids whose correction exceeded one day — surfaced as data-quality warnings. */
  largeCorrections: number[];
  missingTimestamps: number[];
}

const ONE_DAY = 86_400_000;
const MIN_STEP = 1000; // a child lands at least one second after its parents

/**
 * Presentation timestamps: raw author time, corrected only enough that a
 * child never precedes a known parent. Raw values are preserved on the
 * commit; only the derived field is rewritten.
 */
export function correctTimestamps(g: GraphIndex, commits: CommitNode[]): TimeCorrection {
  const n = commits.length;
  const presentation = new Float64Array(n);
  const largeCorrections: number[] = [];
  const missingTimestamps: number[] = [];
  let correctedCount = 0;

  for (const v of g.topo) {
    const c = commits[v]!;
    let raw = rawTimeOf(c);
    let parentMax = -Infinity;
    for (const p of g.parents[v]!) parentMax = Math.max(parentMax, presentation[p]!);
    if (!Number.isFinite(raw)) {
      missingTimestamps.push(v);
      raw = Number.isFinite(parentMax) ? parentMax + MIN_STEP : 0;
    }
    let t = raw;
    if (Number.isFinite(parentMax) && t < parentMax + MIN_STEP) {
      t = parentMax + MIN_STEP;
      correctedCount++;
      if (t - raw > ONE_DAY) largeCorrections.push(v);
    }
    presentation[v] = t;
  }
  return { presentation, correctedCount, largeCorrections, missingTimestamps };
}
