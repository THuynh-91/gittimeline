import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '@/fixtures/demo';
import { FIXTURES } from '@/fixtures/corpus';
import { assertInvariants, compile, PRESET } from './shared';

describe('compilePerformance', () => {
  it('compiles the built-in demo with the full motion vocabulary', () => {
    const ds = buildDemoDataset();
    const p = compile(ds, 'demo');
    assertInvariants(ds, p);
    const types = new Set(p.events.map((e) => e.type));
    for (const t of ['REPO_BIRTH', 'COMMIT_STEP', 'DIVERGENCE', 'PARALLEL_PHRASE', 'CONTRIBUTOR_ENTER', 'CONTRIBUTOR_HANDOFF', 'MERGE_APPROACH', 'MERGE_IMPACT', 'MAJOR_MERGE', 'QUIET_GAP', 'TAG_LANDMARK', 'UNMERGED_TIP', 'REPO_PRESENT', 'ERA_TRANSITION']) {
      expect(types.has(t as never), `demo emits ${t}`).toBe(true);
    }
    expect(p.stats.maxConcurrentThreads).toBeGreaterThanOrEqual(3);
    expect(p.contributors.length).toBeGreaterThanOrEqual(5);
    expect(p.duration).toBeGreaterThan(15);
    expect(p.duration).toBeLessThanOrEqual(45);
    // the camera pushes in around the major merge and pulls back at divergences
    const states = new Set(p.camera.map((c) => c.state));
    expect(states.has('impact')).toBe(true);
    expect(states.has('split')).toBe(true);
    expect(states.has('ensemble')).toBe(true);
    expect(Math.max(...p.camera.map((c) => c.punch))).toBeGreaterThan(1.05);
    expect(Math.min(...p.camera.map((c) => c.punch))).toBeLessThan(0.97);
    // tempo changes with intensity
    expect(new Set(p.tempoMap.map((t) => t[1])).size).toBeGreaterThan(1);
  });

  it('is deterministic for the same dataset, seed and preset', () => {
    const ds = buildDemoDataset();
    const a = compile(ds, 'seed-a');
    const b = compile(ds, 'seed-a');
    expect(a.planHash).toBe(b.planHash);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(JSON.stringify(a.camera)).toBe(JSON.stringify(b.camera));
    const c = compile(ds, 'seed-b');
    expect(c.nodes.length).toBe(a.nodes.length);
  });

  it('keeps geometry identical across target durations', () => {
    const ds = buildDemoDataset();
    const a = compile(ds, 's', { ...PRESET, targetDuration: 20 });
    const b = compile(ds, 's', { ...PRESET, targetDuration: 90 });
    expect(b.duration).toBeGreaterThan(a.duration);
    expect(a.nodes.map((n) => [n.x, n.y]).join()).toBe(b.nodes.map((n) => [n.x, n.y]).join());
  });

  it('reduced motion keeps the same structure', () => {
    const ds = buildDemoDataset();
    const p = compile(ds, 's', { ...PRESET, reducedMotion: true });
    assertInvariants(ds, p);
    expect(p.camera.every((c) => c.punch === 1 && c.rotation === 0)).toBe(true);
  });

  for (const fx of FIXTURES) {
    it(`fixture ${fx.id} satisfies the truth invariants`, () => {
      const ds = fx.build();
      const p = compile(ds, fx.id);
      assertInvariants(ds, p);
      if (ds.commits.length) {
        expect(p.nodes.length).toBeGreaterThan(0);
        expect(p.events.some((e) => e.type === 'REPO_BIRTH')).toBe(true);
        expect(p.events.some((e) => e.type === 'REPO_PRESENT')).toBe(true);
      }
    });
  }

  it('octopus fixture keeps three parents and emits OCTOPUS_MERGE', () => {
    const ds = FIXTURES.find((f) => f.id === '07-octopus-merge')!.build();
    const p = compile(ds);
    expect(p.events.some((e) => e.type === 'OCTOPUS_MERGE')).toBe(true);
    const octo = p.nodes.find((n) => n.parentCount >= 3)!;
    expect(octo).toBeTruthy();
    expect(p.edges.filter((e) => e.child === octo.idx).length).toBe(octo.parentCount);
  });

  it('multiple roots emit MULTI_ROOT_REVEAL', () => {
    const ds = FIXTURES.find((f) => f.id === '09-multiple-roots')!.build();
    const p = compile(ds);
    expect(p.stats.roots).toBe(2);
    expect(p.events.some((e) => e.type === 'MULTI_ROOT_REVEAL')).toBe(true);
  });

  it('partial history keeps boundaries and reports coverage honestly', () => {
    const ds = FIXTURES.find((f) => f.id === '15-partial-boundaries')!.build();
    expect(ds.coverage.completeness).toBe('unknown');
    expect(ds.coverage.boundaryCount).toBeGreaterThan(0);
    const p = compile(ds);
    expect(p.nodes.some((n) => n.kind === 'boundary')).toBe(true);
    expect(p.edges.some((e) => e.kind === 'unknown')).toBe(true);
    expect(p.events.some((e) => e.type === 'UNKNOWN_SPAN')).toBe(true);
    expect(p.coverage.summary).toMatch(/earlier topology is not yet available/);
  });

  it('unknown side history becomes a boundary merge, never an invented edge', () => {
    const ds = FIXTURES.find((f) => f.id === '17-unknown-span')!.build();
    const p = compile(ds);
    const merge = p.nodes.find((n) => n.parentCount === 2)!;
    expect(merge.kind).toBe('boundary');
    const incoming = p.edges.filter((e) => e.child === merge.idx);
    expect(incoming.some((e) => e.kind === 'unknown')).toBe(true);
    expect(incoming.filter((e) => e.kind !== 'unknown').length).toBe(1);
  });

  it('aggregates long known runs while preserving boundary edges', () => {
    const ds = FIXTURES.find((f) => f.id === '16-known-aggregate')!.build();
    const p = compile(ds, 'agg', { ...PRESET, targetDuration: 20, aggregateAbove: 40 });
    assertInvariants(ds, p);
    expect(p.aggregates.length).toBeGreaterThan(0);
    const agg = p.aggregates[0]!;
    expect(agg.memberCount).toBe(agg.memberShas.length);
    expect(p.events.some((e) => e.type === 'AGGREGATE_SPAN')).toBe(true);
    // expanding recovers the members: they form a chain between the boundaries
    const bySha = new Map(ds.commits.map((c) => [c.sha, c]));
    let cur = agg.boundaryShas[1]!;
    const walked: string[] = [];
    while (cur !== agg.boundaryShas[0]) {
      cur = bySha.get(cur)!.parentShas[0]!;
      if (cur !== agg.boundaryShas[0]) walked.push(cur);
    }
    expect(walked.reverse()).toEqual(agg.memberShas);
  });

  it('merge storm collapses into one composed phrase', () => {
    const ds = FIXTURES.find((f) => f.id === '12-merge-storm')!.build();
    const p = compile(ds);
    expect(p.events.some((e) => e.type === 'MERGE_STORM')).toBe(true);
  });

  it('empty repository compiles to a dormant seed', () => {
    const ds = FIXTURES.find((f) => f.id === '20-empty-repository')!.build();
    const p = compile(ds);
    expect(p.nodes.length).toBe(0);
    expect(p.events[0]!.caption).toMatch(/No commits yet/);
  });

  it('hostile metadata is sanitized', () => {
    const ds = FIXTURES.find((f) => f.id === '18-hostile-metadata')!.build();
    for (const c of ds.commits) {
      expect(c.messageSubject.length).toBeLessThanOrEqual(160);
      expect(c.messageSubject).not.toMatch(new RegExp('[\u202E\u200B]'));
    }
    for (const r of ds.refs) expect(r.name.length).toBeLessThanOrEqual(120);
    for (const c of ds.contributors) expect(c.displayName.length).toBeLessThanOrEqual(80);
    const p = compile(ds);
    assertInvariants(ds, p);
  });

  it('clock skew is corrected causally with a warning', () => {
    const ds = FIXTURES.find((f) => f.id === '10-clock-skew')!.build();
    const p = compile(ds);
    assertInvariants(ds, p);
    expect(p.coverage.warnings.some((w) => /corrected/.test(w))).toBe(true);
    expect(p.coverage.warnings.some((w) => /no timestamp/.test(w))).toBe(true);
  });

  it('large synthetic history compiles within budget and aggregates', () => {
    const ds = FIXTURES.find((f) => f.id === '19-million-node-synthetic-lod')!.build();
    const t0 = performance.now();
    const p = compile(ds, 'big', { ...PRESET, targetDuration: 45 });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(15000);
    expect(p.duration).toBeLessThanOrEqual(45.01); // a huge history still fits the target
    expect(p.stats.aggregatedCommits).toBeGreaterThan(0);
    expect(p.nodes.length).toBeLessThan(ds.commits.length);
    assertInvariants(ds, p);
  });
});
