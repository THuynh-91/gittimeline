/**
 * How many commits a merge is allowed to claim converged, and when that number
 * stops being a count.
 *
 * A merge's volume is the size of the side branch it absorbed, found by walking
 * ancestry. The walk needs a budget or a large repository never finishes, and
 * the budget has to be per-repository rather than per-merge — so **any side
 * branch at least that big returns exactly the budget**. The number is then a
 * property of the repository, not of the merge.
 *
 * Measured: Kubernetes' budget works out to 3,000,000 / 57,863 = 51, so every
 * substantial merge on it reported "51 commits converge", and a single frame
 * at 40% of its show carried that same sentence ten times along main. Linux
 * comes out at 32, VS Code 170, React 1,151.
 *
 * "At least 51" is true and useful. "51" is the kind of false precision
 * `docs/data-truth.md` exists to forbid, and it was forbidden in one of the two
 * places the number is written — the chrome caption in `choreography/events.ts`
 * — while the label drawn on the stage beside the merge, which is the one that
 * appears ten times at once, went on stating it as exact.
 *
 * Hence this module. The budget is derived rather than stored so that the
 * twelve already-published catalog packages get the correction without being
 * rebuilt: `stats.merges` is the same `mergeCount` the compiler used, so the
 * renderer can recover the budget from a plan compiled before any of this
 * existed. And it lives here, in a module both the compiler and the renderer
 * can import cheaply, rather than as a second copy of the formula in each —
 * two copies of a threshold is two things to keep in step.
 */

/** Total ancestry visits the merge-volume walk may spend on a whole history. */
export const MERGE_ANCESTRY_VISITS = 3_000_000;

/**
 * The per-merge ancestry budget for a history with `mergeCount` merges.
 *
 * Floored at 32 so a repository of nothing but merges still reports something,
 * and capped at 2,000 so a small one does not pay for a walk whose answer
 * nobody reads.
 */
export function ancestryBudget(mergeCount: number): number {
  return Math.max(32, Math.min(2000, Math.floor(MERGE_ANCESTRY_VISITS / Math.max(1, mergeCount))));
}

/**
 * Whether a merge volume is a count or a floor.
 *
 * True when the walk returned the whole budget, which is the only way it can
 * reach it — so the honest reading is "at least this many".
 */
export function volumeIsCapped(volume: number, mergeCount: number): boolean {
  return volume > 0 && volume >= ancestryBudget(mergeCount);
}

/**
 * How a merge's volume should be written, in either place that writes it.
 *
 * Takes `capped` rather than deriving it, because the two callers know it by
 * different routes and each should use the better one it has. `events.ts` runs
 * beside the compiler's own `mergeVolumeCapped` flag, which is exact and free.
 * The renderer has only the geometry, which does not carry the flag, so it
 * recovers it with `volumeIsCapped` — that is what keeps the twelve published
 * packages from needing a rebuild.
 *
 * Singular only when it really is one commit and really is a count: "at least
 * 1 commit converges" would be a strange thing to say, and cannot arise anyway
 * because the budget floor is 32.
 */
export function volumePhrase(volume: number, capped: boolean): string {
  const noun = volume === 1 && !capped ? 'commit converges' : 'commits converge';
  return `${capped ? 'at least ' : ''}${volume} ${noun}`;
}
