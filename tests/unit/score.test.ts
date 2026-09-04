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
  derivePiece,
  eventKey,
  planScore,
  selectFeatured,
} from '@/audio/score';
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
