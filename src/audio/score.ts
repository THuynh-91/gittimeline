import type { ChoreographyEvent, CompiledPerformance } from '@/model/types';
import { hash01 } from '@/model/prng';

/**
 * The musical decisions, kept pure and away from the Web Audio API.
 *
 * Two things live here. The first is *what piece this repository is*: every
 * project gets its own key, mode and progression, derived from the same hash
 * that makes the choreography deterministic — so a repository always sounds
 * like itself and never quite like another one.
 *
 * The second is *how densely that piece may be ornamented*, which cannot be a
 * constant. A quiet repository and one that merges a pull request every other
 * commit produce wildly different numbers of events per second, and a rule
 * tuned for either sounds wrong on the other. Everything here is derived from
 * the plan's own measured shape, so it applies to any repository without being
 * told anything about it.
 *
 * Being pure, all of it is testable over the whole fixture corpus without a
 * browser, which is what stops these rules from quietly becoming tuned to one
 * example.
 */

/** Below about an eighth of a second the ear stops hearing separate notes. */
export const MIN_NOTE_GAP = 0.13;
/** However dense a history is, accents never need more air than this. */
export const MAX_NOTE_GAP = 0.34;
/**
 * How close two merges may be performed at full force. In a repository built
 * on pull requests half of every commit is a merge, and merges are the loudest
 * thing in the score, so without this the drums simply never stop.
 */
export const MERGE_MIN_GAP = 1.15;
/**
 * The same for branch points. In a pull-request repository every contribution
 * begins with one, so a rising figure on each is not colour, it is the texture.
 */
export const DIVERGENCE_MIN_GAP = 2.4;

/** Event types that sound as a discrete accent and therefore compete for air. */
export const ACCENTED = new Set<ChoreographyEvent['type']>([
  'COMMIT_STEP',
  'COMMIT_CLUSTER',
  'THREAD_ACTIVATE',
  'CONTRIBUTOR_ENTER',
  'DIVERGENCE',
  'MERGE_IMPACT',
  'MAJOR_MERGE',
  'OCTOPUS_MERGE',
]);

const MERGE_TYPES = new Set<ChoreographyEvent['type']>(['MERGE_IMPACT', 'MAJOR_MERGE', 'OCTOPUS_MERGE']);

/**
 * Identifies one event within a plan.
 *
 * Both halves are load-bearing. The type is needed because a merge and the
 * divergence that opened its branch can name the same commit; the time is
 * needed because one commit can be the subject of two divergences at once,
 * when two branches leave it. Keying on the subject alone silently selects
 * every event that shares it, which is how a spacing rule ends up admitting
 * the very events it just rejected.
 */
export function eventKey(ev: ChoreographyEvent): string {
  return `${ev.type}:${ev.subjectIds[0] ?? ''}@${ev.performanceImpact.toFixed(4)}`;
}

/** Scale-step patterns, all usable under the same voicing rules. */
const MODES: Array<{ name: string; steps: number[] }> = [
  { name: 'aeolian', steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { name: 'phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { name: 'ionian', steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
];

/**
 * Four-bar turnarounds by scale degree. Each begins on the tonic so the loop
 * always resolves, and each is a shape that works in any of the modes above.
 */
const TURNAROUNDS: number[][] = [
  [0, 5, 3, 6],
  [0, 3, 5, 4],
  [0, 6, 3, 4],
  [0, 4, 5, 3],
  [0, 2, 5, 4],
  [0, 5, 1, 4],
  [0, 3, 6, 4],
];

export interface Piece {
  /** Semitone offset of the tonic from the engine's root. */
  tonic: number;
  mode: string;
  /** Seconds each chord is held. */
  chordSeconds: number;
  /** Voiced chords, in semitones relative to the engine root. */
  chords: number[][];
}

/**
 * Build this repository's piece from its plan hash.
 *
 * Deterministic in both directions that matter: the same repository is always
 * the same piece, and two different repositories are very rarely the same one.
 * The space is 6 modes x 7 turnarounds x 10 keys x 5 chord lengths, and every
 * choice in it is a musical one, so being different never means being worse.
 */
export function derivePiece(hash: string): Piece {
  const mode = MODES[Math.floor(hash01(`mode:${hash}`) * MODES.length) % MODES.length]!;
  const turn = TURNAROUNDS[Math.floor(hash01(`turn:${hash}`) * TURNAROUNDS.length) % TURNAROUNDS.length]!;
  // Keep the key within a comfortable range of the root rather than anywhere
  // in the octave: too high loses the weight, too low loses the pitch.
  const tonic = Math.round(hash01(`key:${hash}`) * 9) - 4;
  const chordSeconds = 6.5 + Math.round(hash01(`hold:${hash}`) * 4) * 0.6;

  const scale = (degree: number): number => {
    const octave = Math.floor(degree / 7);
    return mode.steps[((degree % 7) + 7) % 7]! + octave * 12;
  };
  // Voice each chord as a spread triad over two octaves: the left hand, the
  // rolling figure and the melody each draw their notes from this one list.
  const chords = turn.map((d) => [0, 2, 4, 7, 9, 11].map((i) => tonic + scale(d + i)));
  return { tonic, mode: mode.name, chordSeconds, chords };
}

export function chordAt(piece: Piece, t: number): number[] {
  return piece.chords[Math.floor(Math.max(0, t) / piece.chordSeconds) % piece.chords.length]!;
}

/**
 * How much air one accent needs in this particular performance.
 *
 * Scales with the plan's own accent rate, so a sparse history keeps the
 * minimum and a dense one spaces things out until they can be heard as
 * separate events rather than as a wash.
 */
export function accentGapFor(events: ChoreographyEvent[], duration: number): number {
  const seconds = Math.max(1, duration);
  const accents = events.reduce((n, e) => (ACCENTED.has(e.type) ? n + 1 : n), 0);
  return Math.min(MAX_NOTE_GAP, Math.max(MIN_NOTE_GAP, (MIN_NOTE_GAP * accents) / seconds / 2));
}

/** 0 for a repository that merges rarely, 1 for a pull-request treadmill. */
export function mergePressureFor(events: ChoreographyEvent[], duration: number): number {
  const merges = events.reduce((n, e) => (MERGE_TYPES.has(e.type) ? n + 1 : n), 0);
  return Math.min(1, merges / Math.max(1, duration) / 1.6);
}

/**
 * Decide, once, which merges and branch points are performed as events.
 *
 * A merge is the biggest gesture the score has: timpani, brass and both hands
 * of the piano. That is right where merging means something and ruinous where
 * every contribution arrives as a pull request, which at speed is several
 * downbeats a second and reads as an unbroken barrage.
 *
 * So they compete instead of each taking a downbeat. Walking them in time
 * order, one is featured only if enough time has passed since the last; an
 * important merge earns the right to interrupt sooner than a routine one, so
 * what survives is the shape of the history rather than an arbitrary sample.
 * Nothing disappears — an unfeatured merge still sounds, as a soft chord tone
 * under the accent gate — it simply stops being an event.
 */
export function selectFeatured(events: ChoreographyEvent[]): Set<string> {
  const featured = new Set<string>();

  const merges = events.filter((e) => MERGE_TYPES.has(e.type)).sort((a, b) => a.performanceImpact - b.performanceImpact);
  let last = -Infinity;
  for (const ev of merges) {
    const importance = ev.salience + (ev.type === 'MERGE_IMPACT' ? 0 : 0.35);
    const gap = MERGE_MIN_GAP / (0.7 + 0.5 * Math.min(1.3, importance));
    if (ev.performanceImpact - last < gap) continue;
    last = ev.performanceImpact;
    featured.add(eventKey(ev));
  }

  const splits = events.filter((e) => e.type === 'DIVERGENCE').sort((a, b) => a.performanceImpact - b.performanceImpact);
  let lastSplit = -Infinity;
  for (const ev of splits) {
    if (ev.performanceImpact - lastSplit < DIVERGENCE_MIN_GAP) continue;
    lastSplit = ev.performanceImpact;
    featured.add(eventKey(ev));
  }
  return featured;
}

/** Everything the engine needs in order to decide how to play a given plan. */
export interface ScorePlan {
  piece: Piece;
  featured: Set<string>;
  accentGap: number;
  mergePressure: number;
}

export function planScore(p: CompiledPerformance | null): ScorePlan {
  if (!p) {
    return { piece: derivePiece(''), featured: new Set(), accentGap: MIN_NOTE_GAP, mergePressure: 0 };
  }
  return {
    piece: derivePiece(p.planHash),
    featured: selectFeatured(p.events),
    accentGap: accentGapFor(p.events, p.duration),
    mergePressure: mergePressureFor(p.events, p.duration),
  };
}
