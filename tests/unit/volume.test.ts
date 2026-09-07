import { describe, expect, it } from 'vitest';
import { ancestryBudget, volumeIsCapped, volumePhrase, MERGE_ANCESTRY_VISITS } from '@/model/volume';

/**
 * A merge volume that hit its budget is a floor, not a count.
 *
 * The walk that finds how much a merge absorbed needs a per-repository budget
 * or a large history never finishes, so **any side branch at least that big
 * returns exactly the budget**. Kubernetes' works out to 51, and a single
 * frame at 40% of its show carried "51 commits converge" ten times along main,
 * every one the same number, because the number was a fact about the budget
 * and read as a fact about the merge.
 *
 * That was corrected in the chrome caption when it was found, and missed in
 * the label drawn on the stage beside the merge — which is the more visible of
 * the two. Both now go through `volumePhrase`, and the renderer recovers the
 * flag with `volumeIsCapped` from `stats.merges`, which is what lets the twelve
 * already-published catalog packages get the correction without a rebuild.
 * That recovery is the thing worth testing: it has to agree with the
 * compiler's own arithmetic exactly, or the two places disagree in words.
 */
describe('merge volume', () => {
  it('reproduces the budget the compiler used, for the histories on the shelf', () => {
    // Measured and written down in `model/volume.ts`; these are the numbers
    // the captions were observed to repeat.
    expect(ancestryBudget(57_863)).toBe(51); // kubernetes
    expect(ancestryBudget(1_100_000)).toBe(32); // linux, below the floor
    expect(ancestryBudget(17_600)).toBe(170); // vscode
    expect(ancestryBudget(2_605)).toBe(1151); // react
  });

  it('floors at 32 and caps at 2000, whatever the history', () => {
    expect(ancestryBudget(Number.MAX_SAFE_INTEGER)).toBe(32);
    expect(ancestryBudget(0)).toBe(2000);
    expect(ancestryBudget(1)).toBe(2000);
    expect(ancestryBudget(-5)).toBe(2000);
    for (const n of [1, 7, 100, 1e4, 1e6, 1e9]) {
      const b = ancestryBudget(n);
      expect(b).toBeGreaterThanOrEqual(32);
      expect(b).toBeLessThanOrEqual(2000);
      expect(Number.isInteger(b)).toBe(true);
    }
  });

  it('calls a volume capped exactly when it reached the budget', () => {
    const merges = 57_863;
    const b = ancestryBudget(merges); // 51
    expect(volumeIsCapped(b, merges)).toBe(true);
    expect(volumeIsCapped(b + 1, merges)).toBe(true);
    expect(volumeIsCapped(b - 1, merges)).toBe(false);
    // Zero is "no volume to report", not "a capped volume of nothing".
    expect(volumeIsCapped(0, merges)).toBe(false);
  });

  it('agrees with the compiler: budget in, capped out', () => {
    // The compiler sets its flag on `side.length >= ancestryBudget`. The
    // renderer has only the number, so the two must classify it identically
    // for every merge count the shelf could hold.
    for (const merges of [1, 32, 2_605, 17_600, 57_863, 250_000, 1_100_000]) {
      const b = ancestryBudget(merges);
      for (const v of [1, b - 1, b, b + 1, b * 3]) {
        if (v <= 0) continue;
        expect(volumeIsCapped(v, merges), `merges=${merges} v=${v}`).toBe(v >= b);
      }
    }
  });

  it('says "at least" for a floor and nothing extra for a count', () => {
    expect(volumePhrase(51, true)).toBe('at least 51 commits converge');
    expect(volumePhrase(50, false)).toBe('50 commits converge');
  });

  it('agrees with its own verb', () => {
    // "1 commit converge" was the old reading. And "at least one" is always
    // plural, because the bound is not the count — unreachable in practice,
    // since the budget floor is 32, but the sentence has to be right anyway.
    expect(volumePhrase(1, false)).toBe('1 commit converges');
    expect(volumePhrase(1, true)).toBe('at least 1 commits converge');
    expect(volumePhrase(2, false)).toBe('2 commits converge');
  });

  it('keeps the visit budget where both callers can see it', () => {
    // A second copy of this number in the renderer is the defect this module
    // exists to prevent, so it is asserted rather than assumed to be shared.
    expect(MERGE_ANCESTRY_VISITS).toBe(3_000_000);
    // 2,000 merges, so the raw share is 1,500 and lands inside the clamp —
    // at 1,000 merges it would be 3,000 and the 2,000 cap would hide the
    // arithmetic this is checking.
    expect(ancestryBudget(2000)).toBe(Math.floor(MERGE_ANCESTRY_VISITS / 2000));
  });
});
