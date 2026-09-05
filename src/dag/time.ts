import type { CommitNode } from '@/model/types';
import { rawTimeOf, type GraphIndex } from './graph';

export interface TimeCorrection {
  /** Presentation time per node id. */
  presentation: Float64Array;
  correctedCount: number;
  /** Ids whose correction exceeded one day — surfaced as data-quality warnings. */
  largeCorrections: number[];
  missingTimestamps: number[];
  /** Ids whose raw stamp was later than the repository was read, and so cannot be true. */
  impossibleTimestamps: number[];
}

const ONE_DAY = 86_400_000;
const MIN_STEP = 1000; // a child lands at least one second after its parents

/**
 * Presentation timestamps: raw author time, corrected only enough that a
 * child never precedes a known parent. Raw values are preserved on the
 * commit; only the derived field is rewritten.
 *
 * `readAt` is when the repository was read — every artifact records it. It is
 * a ceiling, because nothing can have been authored after it was downloaded,
 * and it is what stops one broken clock from rewriting a whole project.
 *
 * The failure it prevents was not hypothetical. Linux contains a handful of
 * commits stamped 2030, 2037 and 2085 by machines with bad clocks. The rule
 * below — a child lands at least a second after its parents — then applied
 * itself 1.4 million times in a row: everything descended from a 2085 commit
 * was dragged past 2085, so 41,839 of the performance's 43,200 seconds were
 * spent in years that have not happened. One bad stamp had invented
 * 1,475,072 dates, on a stage whose entire promise is that it does not invent
 * anything.
 *
 * So an impossible stamp is not trusted and not propagated. It is replaced by
 * "just after its parents", which is the only thing the graph actually
 * testifies to about it, and the substitution is counted and reported rather
 * than hidden. That corrupts one commit's date instead of a million, and it
 * is the direction of error that keeps the rest of the history honest.
 */
export function correctTimestamps(g: GraphIndex, commits: CommitNode[], readAt?: number): TimeCorrection {
  const n = commits.length;
  const presentation = new Float64Array(n);
  const largeCorrections: number[] = [];
  const missingTimestamps: number[] = [];
  const impossibleTimestamps: number[] = [];
  let correctedCount = 0;
  // Without a read time there is no defensible ceiling, so nothing is judged
  // impossible — the old behaviour, for callers that have no artifact.
  let ceiling = readAt != null && Number.isFinite(readAt) ? readAt : Infinity;

  // And a read time is only evidence while the history does not contradict it.
  // Two ways it can, both real:
  //
  //  - It predates the repository. The synthetic fixtures record
  //    `fetchedAt: '1970-01-01'`, which is before Git existed, let alone
  //    before anything in them was written. Nothing can be read before it is
  //    created, so such a stamp is metadata, not evidence.
  //  - It is merely stale. A cached artifact outlives its own read date, and
  //    every commit written since would then look impossible.
  //
  // In both cases believing the ceiling would condemn most of a history and
  // flatten it into one-second steps — the very damage this is here to
  // prevent, inflicted wholesale. A broken clock is rare by definition: Linux,
  // the worst case on the shelf, has five in 1,481,850. So the ceiling has to
  // survive the data before it is allowed to overrule it.
  if (Number.isFinite(ceiling)) {
    let past = 0;
    let oldest = Infinity;
    for (let i = 0; i < n; i++) {
      const t = rawTimeOf(commits[i]!);
      if (!Number.isFinite(t)) continue;
      if (t > ceiling) past++;
      if (t < oldest) oldest = t;
    }
    if (oldest < Infinity && ceiling < oldest) ceiling = Infinity;
    else if (past > Math.max(1, n * 0.01)) ceiling = Infinity;
  }

  for (const v of g.topo) {
    const c = commits[v]!;
    let raw = rawTimeOf(c);
    let parentMax = -Infinity;
    for (const p of g.parents[v]!) parentMax = Math.max(parentMax, presentation[p]!);
    let impossible = false;
    if (Number.isFinite(raw) && raw > ceiling) {
      impossibleTimestamps.push(v);
      impossible = true;
      raw = NaN;
    }
    if (!Number.isFinite(raw)) {
      // A flag, not `impossibleTimestamps.includes(v)`: that is a linear scan
      // inside a loop over every commit, which is 1.4 million scans of a
      // growing array on the one repository this code exists for.
      if (!impossible) missingTimestamps.push(v);
      // A root with no parent and no usable stamp has nothing to be placed
      // after, so it sits at the ceiling rather than at the epoch, where it
      // would stretch the timeline across fifty-five empty years.
      raw = Number.isFinite(parentMax) ? parentMax + MIN_STEP : Math.min(ceiling, Date.parse('1970-01-01T00:00:00Z'));
    }
    let t = raw;
    if (Number.isFinite(parentMax) && t < parentMax + MIN_STEP) {
      t = parentMax + MIN_STEP;
      correctedCount++;
      if (t - raw > ONE_DAY) largeCorrections.push(v);
    }
    presentation[v] = t;
  }
  return { presentation, correctedCount, largeCorrections, missingTimestamps, impossibleTimestamps };
}
