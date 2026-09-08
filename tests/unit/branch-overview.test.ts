import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { loadBranchOverview } from '@/export/branchOverview';
import { BranchActivityIndex, branchActivityOf, groupBranches } from '@/model/branchOverview';
import { crowdAlpha, depthOf, frameSpan, laneTint, lens } from '@/app/BranchOverview';
import { assembleWindow, emptyPlan } from '@/export/catalogPackage';
import type { BranchActivity, CompiledPerformance } from '@/model/types';

describe('complete branch activity overview', () => {
  afterEach(() => vi.unstubAllGlobals());
  const rows: BranchActivity[] = Array.from({ length: 601 }, (_, i) => ({ id: `branch-${i}`, label: `Branch ${i}`, start: i / 100, end: 20 + i / 100 }));
  it('represents every concurrent branch, including when grouped for a phone', () => {
    const active = new BranchActivityIndex(rows).at(10);
    expect(active).toHaveLength(601);
    expect(groupBranches(active, 800)).toHaveLength(601);
    const groups = groupBranches(active, 14);
    expect(groups.length).toBeLessThanOrEqual(14);
    expect(groups.flat().map(r => r.id)).toEqual(active.map(r => r.id));
    expect(new Set(groups.flat().map(r => r.id)).size).toBe(601);
  });
  it('handles backward seeks, nested lifetimes and boundary times', () => {
    const rows = [{ id: 'long', label: '', start: 0, end: 100 }, { id: 'short', label: '', start: 2, end: 3 }, { id: 'later', label: '', start: 8, end: 9 }];
    const index = new BranchActivityIndex(rows);
    for (const t of [0, 2, 3, 4, 8, 9, 99, 101, 2, -1]) expect(index.at(t)).toEqual(rows.filter(r => r.start <= t && r.end >= t));
  });
  it('preserves the global overview across empty or unrelated geometry windows', () => {
    const summary = { branchOverview: rows, waveform: [], timeMap: [], tempoMap: [] } as unknown as CompiledPerformance;
    const assembled = assembleWindow(summary, []);
    expect(assembled.threads).toEqual([]);
    expect(branchActivityOf(assembled)).toBe(rows);
    expect(emptyPlan(summary).branchOverview).toBeUndefined();
  });
  it('never presents resident geometry as a complete history', () => {
    const partial = { window: { key: 'partial' }, threads: [] } as unknown as CompiledPerformance;
    expect(branchActivityOf(partial)).toEqual([]);
  });
  it('verifies optional activity data before displaying counts', async () => {
    const bytes = Uint8Array.from(gzipSync(JSON.stringify(rows)));
    const resource = { file: 'overview.bin', hash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    expect(await loadBranchOverview('https://example.com/catalog/manifest.json', resource, new AbortController().signal)).toEqual(rows);
    await expect(loadBranchOverview('https://example.com/catalog/manifest.json', { ...resource, hash: 'wrong' }, new AbortController().signal)).rejects.toThrow('does not match');
    await expect(loadBranchOverview('https://example.com/catalog/manifest.json', { ...resource, bytes: 1 }, new AbortController().signal)).rejects.toThrow('declared size');
  });
});

/**
 * The drawing's arithmetic, without a canvas.
 *
 * These are the four functions that decide where a filament goes and how much
 * of it a viewer sees, and each one has an invariant behind it rather than a
 * taste: the lens must fit every lane, the falloff must not dim a small
 * history, and the framing must be driven by the tails actually on stage.
 */
describe('branch activity visual language', () => {
  it('maps every lane inside the height available, however strong the lens', () => {
    for (const a of [0, 0.4, 1.9, 3.6, 12]) {
      expect(lens(0, a)).toBeCloseTo(0, 10);
      expect(lens(1, a)).toBeCloseTo(1, 10);
      // Monotone, so lane order on screen is lane order in the data and two
      // lanes never swap places.
      let last = -1;
      for (let lane = 0; lane <= 300; lane++) {
        const v = lens(lane / 300, a);
        expect(v).toBeGreaterThanOrEqual(last);
        expect(v).toBeLessThanOrEqual(1);
        last = v;
      }
    }
    // The point of the lens: the first lanes out get more room than the last.
    const near = lens(1 / 300, 1.9), far = lens(1, 1.9) - lens(299 / 300, 1.9);
    expect(near).toBeGreaterThan(far * 3);
  });

  it('never dims a small history, and never fades a far lane to nothing', () => {
    for (let lane = 1; lane <= 4; lane++) expect(depthOf(lane, 4)).toBe(1);
    expect(depthOf(1, 300)).toBe(1);
    expect(depthOf(300, 300)).toBeCloseTo(0, 6);
    let last = 2;
    for (let lane = 1; lane <= 300; lane++) {
      const d = depthOf(lane, 300);
      expect(d).toBeLessThanOrEqual(last);
      expect(d).toBeGreaterThanOrEqual(0);
      last = d;
    }
  });

  it('thins the ink as the crowd grows but keeps every count visible', () => {
    expect(crowdAlpha(1)).toBe(0.8);
    expect(crowdAlpha(284)).toBeGreaterThan(crowdAlpha(600));
    expect(crowdAlpha(600)).toBeGreaterThan(crowdAlpha(1024));
    for (const n of [0, 1, 14, 284, 350, 600, 1024, 5000]) {
      expect(crowdAlpha(n)).toBeGreaterThanOrEqual(0.2);
      expect(crowdAlpha(n)).toBeLessThanOrEqual(0.8);
    }
  });

  it('mirrors the renderer: cool above the spine, warm below, neutral far out', () => {
    const [, , coolB] = laneTint(-1, 1);
    const [, , warmB] = laneTint(1, 1);
    expect(coolB).toBeGreaterThan(warmB);
    for (const side of [-1, 1]) {
      const near = laneTint(side, 1), far = laneTint(side, 0);
      expect(far).not.toEqual(near);
      // Out of range values must not produce a colour outside the byte range.
      for (const v of [...laneTint(side, -3), ...laneTint(side, 9)]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it('frames the history from the tails on stage, not from the duration', () => {
    // Linux's peak, measured: 600 tails with an 85th percentile of 301 s inside
    // a 43,200 s performance. Framing the duration would put all six hundred
    // inside six pixels.
    const linux = Float64Array.from({ length: 600 }, (_, i) => (i / 599) * 354);
    linux.sort();
    const span = frameSpan(linux, 600);
    expect(span).toBeGreaterThan(300);
    expect(span).toBeLessThan(500);
    // Degenerate inputs still produce a usable window rather than a divide.
    expect(frameSpan([], 0)).toBeGreaterThan(0);
    expect(frameSpan(Float64Array.from([0, 0, 0]), 3)).toBeGreaterThan(0);
    // A quieter moment frames tighter, which is what makes the camera breathe.
    const quiet = Float64Array.from({ length: 40 }, (_, i) => i);
    expect(frameSpan(quiet, 40)).toBeLessThan(span);
  });
});
