import type { CompiledPerformance } from '@/model/types';

/**
 * Which soundtrack a repository gets.
 *
 * This file used to hold a whole generated score — key, mode, four-bar
 * turnarounds, a melody that walked the scale, spacing rules for an orchestra
 * of accents. All of it was derived from something true about the history, all
 * of it was asserted against the corpus, and it was still hard to listen to.
 * The soundtrack is real recorded music now, so the only musical decision left
 * is which of the shipped tracks suits this project — and that is worth making
 * carefully, because a slow track over a repository that merges a pull request
 * every other commit makes no sense at all.
 *
 * It stays pure and DOM-free so it can be asserted over every history in the
 * fixture corpus without a browser, which is what stops it being tuned to one
 * example.
 */

/** How hard the music should push. Tracks are tagged with the same three. */
export type Register = 'calm' | 'driving' | 'frantic';

/**
 * What a repository is like, measured from its own compiled plan.
 *
 *  - `drive` — how much lands per second.
 *  - `turbulence` — how uneven and contested it is: bursty arrivals, many
 *    threads at once, constant merging. Busy and chaotic sound nothing alike.
 *  - `weight` — how much each landing carries.
 */
export interface Character {
  drive: number;
  turbulence: number;
  weight: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function characterOf(p: CompiledPerformance): Character {
  const seconds = Math.max(1, p.duration);
  const arrivals = p.nodes.length;
  const drive = clamp01((arrivals / seconds - 0.4) / 2.8);

  // Burstiness: how much the intervals between arrivals vary. A steady cadence
  // and a series of scrambles can have identical averages.
  const times = p.nodes.map((n) => n.impact).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i]! - times[i - 1]!);
  const mean = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  const variance = gaps.reduce((a, g) => a + (g - mean) * (g - mean), 0) / Math.max(1, gaps.length);
  const cv = mean > 1e-6 ? Math.sqrt(variance) / mean : 0;

  const parallel = clamp01((p.stats.maxConcurrentThreads - 1) / 7);
  const merging = clamp01(p.stats.merges / Math.max(1, p.stats.commits) / 0.35);
  const turbulence = clamp01(clamp01(cv / 1.1) * 0.4 + parallel * 0.3 + merging * 0.3);

  // Weight follows what the merges absorb, not how many there are.
  let absorbed = 0;
  let merges = 0;
  for (const n of p.nodes) {
    if (!n.isMerge) continue;
    merges++;
    absorbed += n.mergeVolume;
  }
  const weight = merges === 0 ? 0 : clamp01(Math.log2(1 + absorbed / merges) / 4.5);

  return { drive, turbulence, weight };
}

/**
 * Pick the register.
 *
 * Motion and churn are what the music has to match, and they are different
 * things: a project can land a great deal steadily, or very little in violent
 * bursts. Adding them means either can reach the top on its own, which is
 * right — `public-apis`, at 1,796 commits in a year with 44% of them merges,
 * has to land on `frantic`, and a long dormant history has to land on `calm`
 * however many commits it eventually accumulated.
 */
export function registerFor(c: Character): Register {
  const push = c.drive + c.turbulence;
  if (push >= 0.95) return 'frantic';
  if (push >= 0.45) return 'driving';
  return 'calm';
}
