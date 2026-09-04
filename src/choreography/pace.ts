/**
 * How long a performance runs, and when a history is too dense to run at all.
 *
 * One rule governs the length: every visible commit gets `SECONDS_PER_NODE` of
 * stage time, because below roughly a quarter of a second an arrival stops
 * reading as its own beat. Duration is a consequence of that, not a target.
 *
 * There is deliberately **no hard cap on length**, because a cap can only be
 * met by breaking the rule above. Measured on real repositories that is not
 * hypothetical: mdBook keeps 2,584 of its 3,296 commits after aggregation,
 * because a third of them are merge junctions and collapsing those would hide
 * the topology. At 0.26s each that is eleven minutes — and a four-minute cap
 * bought those four minutes by playing at a tenth of a second per commit,
 * which is a blur. A show nobody can follow is not a shorter show; it is a
 * broken one.
 *
 * So `LONG_PERFORMANCE_SECONDS` is not a limit, it is the length at which the
 * viewer is *asked first*. `willOutrunTheCeiling` predicts, from two cheap
 * probe requests, whether a repository's whole history would run past it, and
 * the scope chooser offers a shorter span before anything is fetched — saying
 * how long the full version would be. Whatever is then chosen plays at the
 * legible pace, however long that takes, because it was chosen.
 */

/** Stage time one visible commit needs to read as its own beat. */
export const SECONDS_PER_NODE = 0.26;
export const SECONDS_PER_NODE_REDUCED = 0.4;
/** Head and tail reserved by the clock, excluded from the per-commit budget. */
export const FRAME_SECONDS = 4.2;
/**
 * The length past which a performance is long enough to ask about first.
 *
 * Not a cap. Nothing truncates a show to this; it is the threshold that turns
 * "here is your repository" into "this one is six minutes, do you want all of
 * it?".
 */
export const LONG_PERFORMANCE_SECONDS = 360;

/** Visible commits that fit inside that length at the legible pace. */
export const MAX_LEGIBLE_NODES = Math.floor((LONG_PERFORMANCE_SECONDS - FRAME_SECONDS) / SECONDS_PER_NODE);

/** The automatic target length for a history of `n` commits, before pacing. */
export function targetSecondsFor(n: number, lengthBias = 1): number {
  return Math.max(24, Math.min(165, 16 + 24 * Math.log10(1 + n))) * lengthBias;
}

/**
 * How many commits survive aggregation.
 *
 * Two things bound it, and whichever is larger wins:
 *
 *  - the *budget*, which is how many arrivals fit in the target length. A
 *    quiet linear history collapses down to this and no further.
 *  - the *junctions*, which cannot be collapsed at all. Every merge is a
 *    branch point too, so each one pins roughly a pair of commits in place.
 *    A repository built on pull requests is almost entirely junctions.
 *
 * Fitted against four real histories (ripgrep, Svelte 2023, public-apis 2021,
 * mdBook) it predicts 335→355, 235→316, 1587→1718 and 2584→2290 — loose, but
 * it only has to decide whether to ask a question, and it gets all four of
 * those decisions right. It is deliberately a little pessimistic on the dense
 * side: offering a choice that turns out to be unnecessary is a much smaller
 * failure than not offering one that was.
 */
export function predictVisible(commits: number, mergeRatio: number, lengthBias = 1): number {
  if (commits <= 0) return 0;
  const budget = Math.max(40, (targetSecondsFor(commits, lengthBias) - FRAME_SECONDS) / SECONDS_PER_NODE);
  const junctions = commits * Math.max(0, Math.min(1, mergeRatio)) * 2.2;
  return Math.min(commits, Math.max(Math.min(budget, commits), junctions));
}

/** Seconds that many commits would take at the legible pace, uncapped. */
export function legibleSecondsFor(visible: number): number {
  return FRAME_SECONDS + visible * SECONDS_PER_NODE;
}

/**
 * Whether this history cannot be shown in full without going faster than the
 * eye follows — the question the scope chooser exists to ask.
 *
 * `mergeRatio` comes from a sample of recent commits, so it is an estimate of
 * a repository's *current* habits. A project that adopted pull requests three
 * years into its life will read denser than its whole history really is. That
 * bias points the safe way: towards offering a choice.
 */
export function willOutrunTheCeiling(commits: number | null, mergeRatio: number | null, lengthBias = 1): boolean {
  if (!commits || mergeRatio == null) return false;
  return predictVisible(commits, mergeRatio, lengthBias) > MAX_LEGIBLE_NODES;
}
