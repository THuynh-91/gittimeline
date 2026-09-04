import type { ChoreographyEvent, CompiledPerformance, Era } from '@/model/types';
import { hash01 } from '@/model/prng';
import { beatLengthAt } from '@/choreography/clock';

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
const MODES: Record<string, number[]> = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

/**
 * Modes grouped by how settled they sound, so the choice can follow the
 * repository instead of a coin flip. A steady, well-tended library and a
 * project where every day is a scramble should not open on the same chord.
 */
const MODE_BANDS = {
  settled: ['ionian', 'dorian', 'mixolydian'],
  mixed: ['dorian', 'aeolian', 'mixolydian'],
  restless: ['aeolian', 'phrygian', 'harmonic minor'],
} as const;

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

/**
 * What a repository is *like*, measured from its own compiled plan.
 *
 * Three numbers, each in 0..1, and none of them a proxy for size alone:
 *
 *  - `drive` — how much lands per second. A library that takes a considered
 *    commit a week is not the same piece as one absorbing twenty a day.
 *  - `turbulence` — how uneven and contested it is: bursty arrivals, many
 *    threads at once, constant merging. This is the difference between busy
 *    and chaotic, which sound nothing alike.
 *  - `weight` — how much each landing carries. A history of large merges earns
 *    a heavy left hand; one of small steady commits is buried by it.
 */
export interface Character {
  drive: number;
  turbulence: number;
  weight: number;
}

/** How the piano is written for a given character. */
export interface Articulation {
  /** Seconds the left hand is allowed to ring. */
  leftDecay: number;
  /** Whether the left hand is doubled at the octave — weighty, and slow. */
  doubleOctave: boolean;
  /** Activity at which the rolling figure joins in. */
  figureAt: number;
  /** Activity at which the melody fills in the weak beats. */
  melodyAt: number;
  /** Gain applied to the whole piano layer. */
  gain: number;
}

export interface Piece {
  /** Semitone offset of the tonic from the engine's root. */
  tonic: number;
  mode: string;
  /**
   * Roughly how long a chord is held.
   *
   * The actual turnover is quantised to whole bars of the plan's own tempo by
   * `buildChordTimes`, so the harmony speeds up when the history does; this is
   * the target it rounds to.
   */
  chordSeconds: number;
  /** Voiced chords, in semitones relative to the engine root. */
  chords: number[][];
  /**
   * Two octaves of the mode, ascending, for melodic motion.
   *
   * Kept separate from `chords` because they answer different questions. The
   * chord says what the harmony is; the scale says what the next note may be.
   * Walking the *chord* one place at a time moves in thirds and fourths, which
   * is an arpeggio, not a tune — the melody has to walk the scale and land on
   * chord tones, which is what makes a line sound written rather than picked.
   */
  scale: number[];
  /**
   * A short figure, in scale steps, restated at the head of every phrase.
   *
   * Without one the melody is a well-behaved random walk: every note is
   * defensible and nothing is memorable, which is what makes a generated line
   * sound generated. Stating the same shape again — from wherever the harmony
   * has moved to — is the cheapest thing that makes a tune sound written.
   */
  motif: number[];
  character: Character;
  articulation: Articulation;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Measure the character of a compiled performance.
 *
 * Everything here comes from the plan itself, so it works for any repository
 * without being told anything about it — the same reason the spacing rules
 * live in this file.
 */
export function characterOf(p: CompiledPerformance): Character {
  const seconds = Math.max(1, p.duration);
  const arrivals = p.nodes.length;

  const drive = clamp01((arrivals / seconds - 0.4) / 2.8);

  // Burstiness: how much the intervals between arrivals vary. A steady cadence
  // and a series of scrambles can have identical averages.
  const times = p.nodes.map((n) => n.impact).sort((a, b) => a - b);
  let mean = 0;
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i]! - times[i - 1]!);
  for (const g of gaps) mean += g;
  mean /= Math.max(1, gaps.length);
  let variance = 0;
  for (const g of gaps) variance += (g - mean) * (g - mean);
  variance /= Math.max(1, gaps.length);
  const cv = mean > 1e-6 ? Math.sqrt(variance) / mean : 0;

  const parallel = clamp01((p.stats.maxConcurrentThreads - 1) / 7);
  const merging = clamp01(p.stats.merges / Math.max(1, p.stats.commits) / 0.35);
  const turbulence = clamp01(clamp01(cv / 1.1) * 0.4 + parallel * 0.3 + merging * 0.3);

  // Weight follows what the merges actually absorb, not how many there are.
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
 * Build this repository's piece from its plan hash.
 *
 * Deterministic in both directions that matter: the same repository is always
 * the same piece, and two different repositories are very rarely the same one.
 * The space is 6 modes x 7 turnarounds x 10 keys x 5 chord lengths, and every
 * choice in it is a musical one, so being different never means being worse.
 */
export function derivePiece(hash: string, character: Character = { drive: 0.4, turbulence: 0.3, weight: 0.3 }): Piece {
  const { drive, turbulence, weight } = character;

  // The repository chooses the band; the hash chooses within it. Character
  // decides what the piece is like, identity decides which one it is.
  const band = turbulence > 0.55 ? MODE_BANDS.restless : turbulence < 0.3 ? MODE_BANDS.settled : MODE_BANDS.mixed;
  const modeName = band[Math.floor(hash01(`mode:${hash}`) * band.length) % band.length]!;
  const steps = MODES[modeName]!;
  const turn = TURNAROUNDS[Math.floor(hash01(`turn:${hash}`) * TURNAROUNDS.length) % TURNAROUNDS.length]!;
  // Keep the key within a comfortable range of the root rather than anywhere
  // in the octave: too high loses the weight, too low loses the pitch.
  const tonic = Math.round(hash01(`key:${hash}`) * 9) - 4;

  // Harmonic rhythm follows the pace of the work: a settled history lets a
  // chord stand, a restless one keeps moving underneath.
  const chordSeconds = Math.max(3.6, Math.min(8.5, 8.4 - 4.2 * drive - 1.2 * turbulence + hash01(`hold:${hash}`) * 0.6));

  const scale = (degree: number): number => {
    const octave = Math.floor(degree / 7);
    return steps[((degree % 7) + 7) % 7]! + octave * 12;
  };
  // Voice each chord as a spread triad over two octaves: the left hand, the
  // rolling figure and the melody each draw their notes from this one list.
  const chords = turn.map((d) => [0, 2, 4, 7, 9, 11].map((i) => tonic + scale(d + i)));
  const scaleNotes = Array.from({ length: 15 }, (_, i) => tonic + scale(i));
  // Three intervals, conjunct enough to be singable and shaped enough to be
  // recognised when it comes back a key away.
  const STEPS = [-2, -1, 1, 2];
  const motif = [0, 1, 2].map((i) => STEPS[Math.floor(hash01(`motif:${i}:${hash}`) * STEPS.length) % STEPS.length]!);

  // How it is played. A deep doubled left hand ringing for five seconds is a
  // wonderful sound and completely wrong for a project that never stops for
  // long enough to hear it, so the weight of the writing is earned rather than
  // assumed: a history of big merges gets it, a steady stream of small commits
  // gets a lighter hand and more motion above it.
  const articulation: Articulation = {
    leftDecay: 2.2 + 3.2 * weight - 1.0 * drive,
    doubleOctave: weight > 0.42,
    figureAt: 0.5 - 0.34 * drive,
    melodyAt: 0.62 - 0.3 * drive,
    gain: 0.88 + 0.16 * weight,
  };

  return { tonic, mode: modeName, chordSeconds, chords, scale: scaleNotes, motif, character, articulation };
}

/**
 * The performance times at which the harmony turns over, walked from the same
 * tempo map the choreography uses. Built once per plan.
 *
 * The bar count is derived rather than fixed, because a fixed one does not
 * survive contact with a real tempo. Eight bars is four seconds at 180bpm and
 * half a minute at 62 — so a constant "eight bars per chord" gave dense
 * histories a chord every three seconds and quiet ones a single chord for the
 * entire performance, which is the opposite of following anything. Instead the
 * piece asks for a chord roughly every `chordSeconds` and that is rounded to a
 * whole number of this plan's own bars: still locked to the beat grid, so it
 * still accelerates when the history does, but landing where it was meant to.
 *
 * A floor guarantees the harmony turns over at least a few times however short
 * or slow the performance is. A piece that never leaves its first chord is not
 * a piece.
 */
const MIN_CHORD_CHANGES = 5;

export function buildChordTimes(piece: Piece, tempoMap: Array<[number, number]>, duration: number): number[] {
  // Walk the whole grid once; every later decision is a slice of this.
  const beats: number[] = [0];
  let t = 0;
  let guard = 0;
  while (t < duration && guard++ < 200000) {
    t += beatLengthAt(tempoMap, t);
    beats.push(t);
  }
  const bars = Math.max(1, Math.floor(beats.length / 4));
  const wanted = Math.max(1, Math.round((piece.chordSeconds * (beats.length - 1)) / Math.max(1e-6, duration) / 4));
  const affordable = Math.max(1, Math.floor(bars / MIN_CHORD_CHANGES));
  const barsPerChord = Math.max(1, Math.min(wanted, affordable));

  const times: number[] = [];
  for (let i = 0; i < beats.length; i += barsPerChord * 4) times.push(beats[i]!);
  return times.length ? times : [0];
}

/** The chord sounding at a moment, against the plan's own bar lines. */
export function chordAtTime(plan: ScorePlan, t: number): number[] {
  const times = plan.chordTimes;
  const chords = sectionAt(plan, t).chords;
  if (times.length < 2) return chords[0]!;
  const x = Math.max(0, t);
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid]! <= x) lo = mid;
    else hi = mid - 1;
  }
  return chords[lo % chords.length]!;
}

/** Nominal, seconds-based lookup. Used where there is no tempo map to follow. */
export function chordAt(piece: Piece, t: number): number[] {
  return piece.chords[Math.floor(Math.max(0, t) / piece.chordSeconds) % piece.chords.length]!;
}

/**
 * Move a melodic voice one scale step, and resolve it onto a chord tone where
 * the phrase wants resolution.
 *
 * `from` and the return value are indices into `piece.scale`, so a move of one
 * really is a second and not a third. On a strong beat the note is pulled to
 * the nearest tone of the sounding chord, which is what stops a stepwise line
 * from wandering out of the harmony.
 */
export function melodyStep(scale: number[], chord: number[], from: number, r: number, resolve: boolean): number {
  const lo = 4;
  // A tune lives inside about an octave. A wider range stops sounding like one
  // voice and starts sounding like the instrument being swept.
  const hi = Math.min(scale.length - 2, lo + 7);
  // Mostly conjunct, occasionally still, rarely a third — the proportions of a
  // written line rather than a random walk.
  const delta = r < 0.34 ? -1 : r < 0.68 ? 1 : r < 0.84 ? 0 : r < 0.92 ? 2 : -2;
  let next = Math.max(lo, Math.min(hi, from + delta));
  if (resolve) {
    // Resolve to a chord tone, but only one that is nearby: a resolution you
    // have to leap a sixth to reach is not a resolution, it is a new phrase.
    const tones = new Set(chord.map((c) => ((c % 12) + 12) % 12));
    for (let radius = 0; radius <= 3; radius++) {
      const down = next - radius;
      const up = next + radius;
      if (down >= lo && tones.has(((scale[down]! % 12) + 12) % 12)) {
        next = down;
        break;
      }
      if (up <= hi && tones.has(((scale[up]! % 12) + 12) % 12)) {
        next = up;
        break;
      }
    }
    return next;
  }
  // Between resolutions the line stays conjunct. Whatever the mode's step
  // sizes — some have an augmented second in them — the sounding interval
  // never exceeds a major third.
  while (next !== from && Math.abs(scale[next]! - scale[from]!) > 4) {
    next += next > from ? -1 : 1;
  }
  return next;
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

/**
 * How the piece is played *right now*.
 *
 * The repository's character sets the baseline, but a repository is not one
 * thing for its whole life: a project has dormant years and months where
 * everything happens at once, and the piece has to move between them rather
 * than picking one mood and holding it. `energy` is the choreography's own
 * activity curve, so the writing thins and thickens exactly where the history
 * does — the heavy doubled left hand lifts when things get busy, the ring
 * shortens, and the figure fills in.
 */
export function articulationAt(piece: Piece, energy: number): Articulation {
  const e = clamp01(energy);
  const base = piece.articulation;
  return {
    leftDecay: Math.max(1.1, base.leftDecay * (1.3 - 0.62 * e)),
    doubleOctave: base.doubleOctave && e < 0.62,
    figureAt: base.figureAt,
    melodyAt: base.melodyAt,
    gain: base.gain * (0.92 + 0.12 * e),
  };
}

/**
 * One movement of the piece: the span of an era, in its own key.
 *
 * A four-chord loop held for four minutes is monotonous however well it is
 * voiced, and the repository already tells us where its chapters are — the
 * choreography's eras. So each era becomes a section and the piece *modulates*
 * into it, and the direction of that modulation says what happened: a busier
 * era than the last lifts the key, a quieter one drops it. The change of
 * colour is the history changing, not decoration on top of it.
 */
export interface Section {
  start: number;
  end: number;
  label: string;
  /** The piece's chords, transposed into this section's key. */
  chords: number[][];
  /** And its scale, so the melody modulates with the harmony rather than against it. */
  scale: number[];
  transpose: number;
}

/** Keys a section may move to, grouped by what the history just did. */
const LIFT = [2, 5, 7];
const FALL = [-3, -5, -2];

/**
 * The longest a piece may stay in one key.
 *
 * Eras are the repository's own chapters and are the right seams to modulate
 * on, but a project can work at one steady pitch for years — a pull-request
 * treadmill has no chapters at all — and four minutes in one key on one
 * four-chord loop is monotonous however truthfully it was arrived at. So a
 * long stretch is divided anyway, and the piece moves.
 */
const MAX_SECTION_SECONDS = 52;

export function buildSections(piece: Piece, eras: Era[], duration: number, hash: string): Section[] {
  // Spans first: the history's own chapters where it has them, the whole show
  // where it does not, and then anything too long to sit still is subdivided.
  const raw = eras.length
    ? eras.map((e) => ({ start: e.performanceStart, end: e.performanceEnd, label: e.label, intensity: e.intensity }))
    : [{ start: 0, end: Math.max(1, duration), label: '', intensity: 0.5 }];

  const spans: Array<{ start: number; end: number; label: string; intensity: number; seam: boolean }> = [];
  for (const r of raw) {
    const length = Math.max(0.001, r.end - r.start);
    const parts = Math.max(1, Math.ceil(length / MAX_SECTION_SECONDS));
    for (let i = 0; i < parts; i++) {
      spans.push({
        start: r.start + (length * i) / parts,
        end: r.start + (length * (i + 1)) / parts,
        label: r.label,
        intensity: r.intensity,
        seam: i === 0,
      });
    }
  }

  const sections: Section[] = [];
  let transpose = 0;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!;
    if (i > 0) {
      const prev = spans[i - 1]!;
      // A seam between chapters says what changed; a seam inside one just has
      // to keep the piece moving, so it takes a small step either way.
      const change = span.intensity - prev.intensity;
      const pool = span.seam ? (change > 0.1 ? LIFT : change < -0.1 ? FALL : [0]) : hash01(`dir:${i}:${hash}`) > 0.5 ? LIFT : FALL;
      const step = pool[Math.floor(hash01(`mod:${i}:${hash}`) * pool.length) % pool.length]!;
      // Wander, but never so far that the left hand leaves the instrument.
      transpose = Math.max(-7, Math.min(7, transpose + step));
    }
    sections.push({
      start: span.start,
      end: span.end,
      label: span.label,
      transpose,
      chords: piece.chords.map((c) => c.map((n) => n + transpose)),
      scale: piece.scale.map((n) => n + transpose),
    });
  }
  return sections;
}

export function sectionAt(plan: ScorePlan, t: number): Section {
  const ss = plan.sections;
  for (let i = ss.length - 1; i >= 0; i--) if (t >= ss[i]!.start) return ss[i]!;
  return ss[0]!;
}

/** Everything the engine needs in order to decide how to play a given plan. */
export interface ScorePlan {
  piece: Piece;
  featured: Set<string>;
  accentGap: number;
  mergePressure: number;
  /** Performance times at which the harmony turns over. */
  chordTimes: number[];
  /** One movement per era, each in its own key. */
  sections: Section[];
}

export function planScore(p: CompiledPerformance | null): ScorePlan {
  if (!p) {
    const piece = derivePiece('');
    return {
      piece,
      featured: new Set(),
      accentGap: MIN_NOTE_GAP,
      mergePressure: 0,
      chordTimes: [0],
      sections: buildSections(piece, [], 1, ''),
    };
  }
  const piece = derivePiece(p.planHash, characterOf(p));
  return {
    piece,
    featured: selectFeatured(p.events),
    accentGap: accentGapFor(p.events, p.duration),
    mergePressure: mergePressureFor(p.events, p.duration),
    chordTimes: buildChordTimes(piece, p.tempoMap, p.duration),
    sections: buildSections(piece, p.eras, p.duration, p.planHash),
  };
}
