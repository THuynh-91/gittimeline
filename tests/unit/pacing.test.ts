import { describe, expect, it } from 'vitest';
import { FIXTURES } from '@/fixtures/corpus';
import { buildDemoDataset } from '@/fixtures/demo';
import { compile } from './shared';
import type { Dataset, PlaybackPreset } from '@/model/types';

/**
 * Legibility of the pace itself.
 *
 * The failure these guard against is not a crash: it is a large repository
 * whose arrivals are individually correct but land faster than they can be
 * seen. It appeared twice — once because aggregation sized the show for 0.26s
 * per commit while the clock then played it at 0.12s, and once because the
 * roller-coaster's dynamic range stayed at full width no matter how dense the
 * history got, so the busiest span of all went past fastest.
 */
const AUTO: PlaybackPreset = { id: 'cinematic', version: 1, targetDuration: 0, reducedMotion: false, aggregateAbove: 900 };

function gaps(ds: Dataset) {
  const p = compile(ds, 'pacing', AUTO);
  const t = [...p.nodes].map((n) => n.impact).sort((a, b) => a - b);
  const g = t.slice(1).map((x, i) => x - t[i]!).sort((a, b) => a - b);
  const at = (q: number) => g[Math.floor(g.length * q)] ?? Infinity;
  return { duration: p.duration, nodes: p.nodes.length, rate: p.nodes.length / p.duration, p10: at(0.1), median: at(0.5) };
}

describe('pace is watchable at every size', () => {
  const cases: Array<[string, Dataset]> = [
    ['demo', buildDemoDataset()],
    ...FIXTURES.filter((f) => f.id !== '20-empty-repository').map((f) => [f.id, f.build()] as [string, Dataset]),
  ];

  for (const [id, ds] of cases) {
    it(`${id} lands its arrivals slowly enough to be seen`, () => {
      const m = gaps(ds);
      expect(m.duration, 'never runs longer than four minutes').toBeLessThanOrEqual(260);
      expect(m.median, 'the typical arrival holds the stage').toBeGreaterThanOrEqual(0.25);
      expect(m.p10, 'even the fastest tenth stays above the flicker threshold').toBeGreaterThanOrEqual(0.12);
      expect(m.rate, 'arrivals per second stay countable').toBeLessThanOrEqual(4.5);
    });
  }

  it('the densest history is slower per commit than it used to be', () => {
    // A pull-request repository cannot aggregate its merges away, so its pace
    // is set entirely by the per-commit budget. Guard the budget directly.
    const m = gaps(FIXTURES.find((f) => f.id === '21-pull-request-treadmill')!.build());
    expect(m.duration / m.nodes).toBeGreaterThanOrEqual(0.22);
  });
});
