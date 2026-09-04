import { describe, expect, it } from 'vitest';
import { FIXTURES } from '@/fixtures/corpus';
import { buildDemoDataset } from '@/fixtures/demo';
import { compile } from './shared';
import {
  ACCENTED,
  DIVERGENCE_MIN_GAP,
  MAX_NOTE_GAP,
  MIN_NOTE_GAP,
  accentGapFor,
  chordAt,
  characterOf,
  derivePiece,
  eventKey,
  melodyStep,
  planScore,
  sectionAt,
  selectFeatured,
} from '@/audio/score';
import { hash01 } from '@/model/prng';
import type { CompiledPerformance, Dataset } from '@/model/types';

/**
 * These rules exist because one real repository sounded like an unbroken
 * barrage — public-apis, which merges a pull request roughly every other
 * commit. The risk in fixing that is fixing it *for that repository*: tuning
 * a constant until one example sounds right and quietly breaking everything
 * else. So none of the rules take a name, a size or a shape as input, and all
 * of them are asserted here against every history in the corpus at once.
 */
const CASES: Array<[string, Dataset]> = [
  ['demo', buildDemoDataset()],
  ...FIXTURES.filter((f) => f.build().commits.length > 0).map((f) => [f.id, f.build()] as [string, Dataset]),
];

const PLANS: Array<[string, CompiledPerformance]> = CASES.map(([id, ds]) => [id, compile(ds, 'score')]);

describe('every repository gets a piece of its own', () => {
  it('the same plan always produces the same piece', () => {
    for (const [id, p] of PLANS) {
      const a = derivePiece(p.planHash);
      const b = derivePiece(p.planHash);
      expect(a, `${id} is stable`).toEqual(b);
    }
  });

  it('different histories rarely land on the same piece', () => {
    const signatures = PLANS.map(([, p]) => {
      const piece = derivePiece(p.planHash);
      return `${piece.mode}|${piece.tonic}|${piece.chordSeconds}|${piece.chords.map((c) => c.join(',')).join(';')}`;
    });
    const distinct = new Set(signatures).size;
    // Not a guarantee of uniqueness — a hash space can collide — but a corpus
    // that mostly collided would mean the derivation was not really varying.
    expect(distinct).toBeGreaterThanOrEqual(Math.ceil(signatures.length * 0.7));
  });

  it('is always a playable piece, whatever it lands on', () => {
    for (const [id, p] of PLANS) {
      const piece = derivePiece(p.planHash);
      expect(piece.chords.length, `${id} turns around`).toBe(4);
      for (const chord of piece.chords) {
        expect(chord.length).toBeGreaterThanOrEqual(6);
        // Ascending voicing, and inside a range a piano can actually play.
        for (let i = 1; i < chord.length; i++) expect(chord[i]!).toBeGreaterThan(chord[i - 1]!);
        expect(Math.min(...chord)).toBeGreaterThanOrEqual(-12);
        expect(Math.max(...chord)).toBeLessThanOrEqual(48);
      }
      expect(piece.chordSeconds).toBeGreaterThanOrEqual(6);
      expect(piece.chordSeconds).toBeLessThanOrEqual(9.5);
    }
  });
});

describe('the score adapts itself to any history', () => {
  it('accent spacing stays inside its bounds and rises with density', () => {
    for (const [id, p] of PLANS) {
      const gap = accentGapFor(p.events, p.duration);
      expect(gap, `${id} above the audibility floor`).toBeGreaterThanOrEqual(MIN_NOTE_GAP);
      expect(gap, `${id} below the ceiling`).toBeLessThanOrEqual(MAX_NOTE_GAP);
    }
    const rate = (p: CompiledPerformance) => p.events.filter((e) => ACCENTED.has(e.type)).length / p.duration;
    const sorted = [...PLANS].sort((a, b) => rate(a[1]) - rate(b[1]));
    const sparse = sorted[0]![1];
    const densest = sorted[sorted.length - 1]![1];
    expect(accentGapFor(densest.events, densest.duration)).toBeGreaterThan(accentGapFor(sparse.events, sparse.duration));
  });

  it('featured merges and divergences respect their minimum spacing everywhere', () => {
    for (const [id, p] of PLANS) {
      const featured = selectFeatured(p.events);
      const at = (type: (t: string) => boolean, min: number) => {
        const times = p.events
          .filter((e) => type(e.type) && featured.has(eventKey(e)))
          .map((e) => e.performanceImpact)
          .sort((a, b) => a - b);
        for (let i = 1; i < times.length; i++) {
          // The merge bound varies with importance; assert the floor of it.
          expect(times[i]! - times[i - 1]!, `${id} spacing`).toBeGreaterThanOrEqual(min - 1e-6);
        }
        return times.length;
      };
      at((t) => t.includes('MERGE') && t !== 'MERGE_APPROACH' && t !== 'MERGE_STORM', 0.55);
      at((t) => t === 'DIVERGENCE', DIVERGENCE_MIN_GAP);
    }
  });

  it('featured events never sound faster than the score can carry them', () => {
    for (const [id, p] of PLANS) {
      const { featured } = planScore(p);
      const times = p.events
        .filter((e) => featured.has(eventKey(e)))
        .map((e) => e.performanceImpact)
        .sort((a, b) => a - b);
      const perSecond = times.length / p.duration;
      expect(perSecond, `${id} featured events per second`).toBeLessThanOrEqual(2.2);
    }
  });

  it('nothing is silenced: every merge still has a voice', () => {
    // Unfeatured merges fall through to a soft chord tone rather than being
    // dropped, so the count of merges the engine will consider is unchanged.
    for (const [id, p] of PLANS) {
      const merges = p.events.filter((e) => ['MERGE_IMPACT', 'MAJOR_MERGE', 'OCTOPUS_MERGE'].includes(e.type));
      const featured = selectFeatured(p.events);
      const shown = merges.filter((e) => featured.has(eventKey(e))).length;
      expect(shown, `${id} keeps at least one merge audible`).toBe(merges.length === 0 ? 0 : Math.max(1, shown));
      expect(shown).toBeLessThanOrEqual(merges.length);
    }
  });

  it('a merge and the divergence on the same commit are told apart', () => {
    const a = { type: 'MERGE_IMPACT', subjectIds: ['abc'], performanceImpact: 1 } as never;
    const b = { type: 'DIVERGENCE', subjectIds: ['abc'], performanceImpact: 1 } as never;
    expect(eventKey(a)).not.toBe(eventKey(b));
  });
});

describe('the piece matches the repository, not a coin flip', () => {
  it('a calmer history holds its chords longer than a driven one', () => {
    const rate = (p: CompiledPerformance) => p.nodes.length / p.duration;
    const sorted = [...PLANS].sort((a, b) => rate(a[1]) - rate(b[1]));
    const calm = sorted[0]![1];
    const driven = sorted[sorted.length - 1]![1];
    const a = derivePiece(calm.planHash, characterOf(calm));
    const b = derivePiece(driven.planHash, characterOf(driven));
    expect(a.chordSeconds).toBeGreaterThan(b.chordSeconds);
    // And it reaches its rolling figure later, so it stays sparse.
    expect(a.articulation.figureAt).toBeGreaterThan(b.articulation.figureAt);
  });

  it('the heavy left hand is earned, never assumed', () => {
    const pieces = PLANS.map(([id, p]) => [id, derivePiece(p.planHash, characterOf(p))] as const);
    const doubled = pieces.filter(([, pc]) => pc.articulation.doubleOctave);
    // Some histories get the weight and some do not — a setting that is always
    // on is the bug this guards against.
    expect(doubled.length).toBeGreaterThan(0);
    expect(doubled.length).toBeLessThan(pieces.length);
    for (const [id, pc] of pieces) {
      expect(pc.articulation.leftDecay, `${id} decay is playable`).toBeGreaterThan(0.8);
      expect(pc.articulation.leftDecay, `${id} decay is not a drone`).toBeLessThan(6);
    }
  });

  it('character is measured, and stays inside its range for every history', () => {
    for (const [id, p] of PLANS) {
      const c = characterOf(p);
      for (const [k, v] of Object.entries(c)) {
        expect(v, `${id} ${k}`).toBeGreaterThanOrEqual(0);
        expect(v, `${id} ${k}`).toBeLessThanOrEqual(1);
      }
    }
    // The corpus genuinely spans the range rather than clustering.
    const drives = PLANS.map(([, p]) => characterOf(p).drive);
    expect(Math.max(...drives) - Math.min(...drives)).toBeGreaterThan(0.35);
  });

  it('a turbulent history and a settled one do not draw from the same modes', () => {
    const byTurb = [...PLANS].sort((a, b) => characterOf(a[1]).turbulence - characterOf(b[1]).turbulence);
    const settled = derivePiece(byTurb[0]![1].planHash, characterOf(byTurb[0]![1]));
    const restless = derivePiece(byTurb[byTurb.length - 1]![1].planHash, characterOf(byTurb[byTurb.length - 1]![1]));
    expect(['ionian', 'dorian', 'mixolydian']).toContain(settled.mode);
    expect(['aeolian', 'phrygian', 'harmonic minor', 'dorian', 'mixolydian']).toContain(restless.mode);
  });
});

describe('the melody is a line, not an arpeggio', () => {
  /**
   * The bug this replaces: the melody moved one place at a time through the
   * *voiced chord*, whose adjacent entries are a third apart, so every note
   * leapt and the result sounded picked rather than written.
   */
  const walk = (p: CompiledPerformance) => {
    const piece = derivePiece(p.planHash, characterOf(p));
    let idx = 7;
    const pitches: number[] = [];
    for (let bar = 0; bar < 64; bar++) {
      const chord = chordAt(piece, bar * piece.chordSeconds * 0.25);
      for (const beat of [0, 2]) {
        idx = melodyStep(piece.scale, chord, idx, hash01(`bar:${bar}:${beat}`), beat === 0);
        pitches.push(piece.scale[idx]!);
      }
    }
    return { piece, pitches };
  };

  it('moves mostly by step and never leaps further than a fourth', () => {
    for (const [id, p] of PLANS) {
      const { pitches } = walk(p);
      const intervals = pitches.slice(1).map((x, i) => Math.abs(x - pitches[i]!));
      const moving = intervals.filter((d) => d > 0);
      const steps = moving.filter((d) => d <= 2).length;
      expect(moving.length, `${id} actually moves`).toBeGreaterThan(pitches.length * 0.4);
      expect(steps / moving.length, `${id} stepwise share`).toBeGreaterThan(0.5);
      // A resolution onto the harmony may be a leap; nothing else may be.
      expect(Math.max(...intervals), `${id} largest leap`).toBeLessThanOrEqual(7);
    }
  });

  it('stays inside the mode and inside a singable range', () => {
    for (const [id, p] of PLANS) {
      const { piece, pitches } = walk(p);
      const inScale = new Set(piece.scale.map((n) => ((n % 12) + 12) % 12));
      for (const n of pitches) expect(inScale.has(((n % 12) + 12) % 12), `${id} in mode`).toBe(true);
      expect(Math.max(...pitches) - Math.min(...pitches), `${id} range`).toBeLessThanOrEqual(14);
    }
  });

  it('resolves onto the harmony on the downbeat', () => {
    for (const [id, p] of PLANS) {
      const piece = derivePiece(p.planHash, characterOf(p));
      let idx = 7;
      for (let bar = 0; bar < 32; bar++) {
        const chord = chordAt(piece, bar * piece.chordSeconds);
        idx = melodyStep(piece.scale, chord, idx, hash01(`r:${bar}`), true);
        const tones = new Set(chord.map((c) => ((c % 12) + 12) % 12));
        expect(tones.has(((piece.scale[idx]! % 12) + 12) % 12), `${id} bar ${bar}`).toBe(true);
      }
    }
  });
});

describe('the piece has movements, not one loop', () => {
  it('every history is divided into sections that follow its eras', () => {
    for (const [id, p] of PLANS) {
      const { sections } = planScore(p);
      expect(sections.length, `${id} has sections`).toBeGreaterThanOrEqual(1);
      // Chapters where the history has them, and never one key for too long.
      if (p.eras.length > 1) expect(sections.length, `${id} follows its eras`).toBeGreaterThanOrEqual(p.eras.length);
      for (const s of sections) expect(s.end - s.start, `${id} no section outstays its welcome`).toBeLessThanOrEqual(53);
      // sectionAt must agree with the spans it was built from.
      for (const s of sections) expect(sectionAt(planScore(p), (s.start + s.end) / 2).start).toBe(s.start);
      for (let i = 1; i < sections.length; i++) {
        expect(sections[i]!.start, `${id} sections are ordered`).toBeGreaterThanOrEqual(sections[i - 1]!.start);
      }
      for (const s of sections) {
        expect(Math.abs(s.transpose), `${id} stays on the instrument`).toBeLessThanOrEqual(7);
        // The scale must move with the chords or the melody sings in the key
        // the piece has just left.
        expect(s.scale.length).toBe(15);
        const chordClasses = new Set(s.chords.flat().map((n) => ((n % 12) + 12) % 12));
        const scaleClasses = new Set(s.scale.map((n) => ((n % 12) + 12) % 12));
        for (const c of chordClasses) expect(scaleClasses.has(c), `${id} chord tones are in the section scale`).toBe(true);
      }
    }
  });

  it('a history with changing eras actually changes key somewhere', () => {
    const withEras = PLANS.filter(([, p]) => p.eras.length > 2);
    expect(withEras.length, 'the corpus has multi-era histories to test').toBeGreaterThan(0);
    const moved = withEras.filter(([, p]) => new Set(planScore(p).sections.map((s) => s.transpose)).size > 1);
    expect(moved.length, 'at least some multi-era histories modulate').toBeGreaterThan(0);
    // And no long performance sits in one key, however uniform its history.
    for (const [id, p] of PLANS) {
      if (p.duration < 90) continue;
      expect(new Set(planScore(p).sections.map((s) => s.transpose)).size, `${id} moves`).toBeGreaterThan(1);
    }
  });

  it('the motif is short, conjunct and restated identically', () => {
    for (const [id, p] of PLANS) {
      const piece = derivePiece(p.planHash, characterOf(p));
      expect(piece.motif.length, `${id} motif length`).toBe(3);
      for (const d of piece.motif) {
        expect(Math.abs(d), `${id} motif is singable`).toBeLessThanOrEqual(2);
        expect(d).not.toBe(0);
      }
      // Same piece, same figure, every time it comes round.
      expect(derivePiece(p.planHash, characterOf(p)).motif).toEqual(piece.motif);
    }
  });
});
