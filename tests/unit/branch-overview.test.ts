import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { loadBranchOverview } from '@/export/branchOverview';
import { BranchActivityIndex, branchActivityOf, groupBranches } from '@/model/branchOverview';
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
