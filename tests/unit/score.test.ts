import { describe, expect, it } from 'vitest';
import { FIXTURES } from '@/fixtures/corpus';
import { buildDemoDataset } from '@/fixtures/demo';
import { compile } from './shared';
import { characterOf, registerFor } from '@/audio/score';
import type { CompiledPerformance, Dataset } from '@/model/types';

/**
 * The soundtrack is real recorded music, so the only musical decision left is
 * which of the shipped tracks a repository gets. It is worth asserting: a slow
 * track over a project that merges a pull request every other commit makes no
 * sense, and the risk in fixing that is tuning a threshold until one example
 * fits. Nothing here takes a name, a size or a shape as input, and every
 * history in the corpus is checked at once.
 */
const CASES: Array<[string, Dataset]> = [
  ['demo', buildDemoDataset()],
  ...FIXTURES.filter((f) => f.build().commits.length > 0).map((f) => [f.id, f.build()] as [string, Dataset]),
];
const PLANS: Array<[string, CompiledPerformance]> = CASES.map(([id, ds]) => [id, compile(ds, 'score')]);

describe('the music matches the history', () => {
  it('measures character inside its range for every history', () => {
    for (const [id, p] of PLANS) {
      const c = characterOf(p);
      for (const [k, v] of Object.entries(c)) {
        expect(v, `${id} ${k}`).toBeGreaterThanOrEqual(0);
        expect(v, `${id} ${k}`).toBeLessThanOrEqual(1);
      }
    }
    // The corpus genuinely spans the range rather than clustering, or the
    // selection below would be measuring nothing.
    const drives = PLANS.map(([, p]) => characterOf(p).drive);
    expect(Math.max(...drives) - Math.min(...drives)).toBeGreaterThan(0.35);
  });

  it('gives a pull-request treadmill the hardest register', () => {
    const treadmill = PLANS.find(([id]) => id === '21-pull-request-treadmill')![1];
    expect(registerFor(characterOf(treadmill))).toBe('frantic');
  });

  it('gives a sparse, long-running history the calmest', () => {
    const quiet = PLANS.find(([id]) => id === '05-long-running-side-thread')![1];
    expect(registerFor(characterOf(quiet))).toBe('calm');
  });

  it('uses more than one register across the corpus', () => {
    const used = new Set(PLANS.map(([, p]) => registerFor(characterOf(p))));
    expect(used.size, 'a selector that always answers the same thing is not selecting').toBeGreaterThan(1);
  });

  it('always answers with a register a track is tagged with', () => {
    for (const [id, p] of PLANS) {
      expect(['calm', 'driving', 'frantic'], `${id}`).toContain(registerFor(characterOf(p)));
    }
  });
});
