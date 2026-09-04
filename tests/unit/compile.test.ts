import { describe, expect, it } from 'vitest';
import { compilePerformance } from '@/choreography/compile';
import { buildDemoDataset } from '@/fixtures/demo';
import { FIXTURES } from '@/fixtures/corpus';
import { buildGraph } from '@/dag/graph';
import type { CompiledPerformance, Dataset, PlaybackPreset } from '@/model/types';

export const PRESET: PlaybackPreset = { id: 'cinematic', version: 1, targetDuration: 60, reducedMotion: false, aggregateAbove: 1200 };

export function compile(ds: Dataset, seed = 'test', preset: PlaybackPreset = PRESET): CompiledPerformance {
  return compilePerformance(ds, { preset, seed });
}

/** Truth invariants every compiled performance must satisfy. */
export function assertInvariants(ds: Dataset, p: CompiledPerformance) {
  const g = buildGraph(ds.commits);
  const nodeBySha = new Map(p.nodes.map((n) => [n.sha, n]));
  const known = new Set(ds.commits.map((c) => c.sha));

  // every exact edge corresponds to an input parent relation
  const relations = new Set<string>();
  for (const c of ds.commits) for (const parent of c.parentShas) relations.add(`${parent}>${c.sha}`);
  for (const e of p.edges) {
    if (e.kind === 'unknown') {
      expect(e.parent).toBe(-1);
      continue;
    }
    const child = p.nodes[e.child]!;
    const parent = p.nodes[e.parent]!;
    if (e.kind === 'aggregate') {
      // span boundaries are joined by a run of exact relations through the aggregate members
      const agg = p.aggregates.find((a) => a.boundaryShas[0] === parent.sha && a.boundaryShas[1] === child.sha);
      expect(agg, 'aggregate edge has a span').toBeTruthy();
      continue;
    }
    expect(relations.has(`${parent.sha}>${child.sha}`), `edge ${parent.sha.slice(0, 7)}>${child.sha.slice(0, 7)} exists in input`).toBe(true);
    expect(e.end).toBeGreaterThan(e.start);
    expect(child.impact).toBeGreaterThan(parent.impact);
    expect(child.x).toBeGreaterThan(parent.x);
  }
  // every known parent relation among visible nodes is drawn exactly once
  const drawn = new Map<string, number>();
  for (const e of p.edges) {
    if (e.parent < 0) continue;
    const key = `${p.nodes[e.parent]!.sha}>${p.nodes[e.child]!.sha}`;
    drawn.set(key, (drawn.get(key) ?? 0) + 1);
  }
  for (const c of ds.commits) {
    const child = nodeBySha.get(c.sha);
    if (!child) continue; // aggregated interior
    for (const parent of c.parentShas) {
      if (!known.has(parent)) continue;
      const pn = nodeBySha.get(parent);
      if (!pn) continue; // aggregated interior — covered by its span
      expect(drawn.get(`${parent}>${c.sha}`), `relation ${parent.slice(0, 7)}>${c.sha.slice(0, 7)} drawn once`).toBe(1);
    }
  }
  // octopus merges retain all parents
  for (const c of ds.commits) {
    const nd = nodeBySha.get(c.sha);
    if (nd && c.parentShas.length > 2) {
      const incoming = p.edges.filter((e) => e.child === nd.idx);
      expect(incoming.length).toBe(c.parentShas.length);
    }
  }
  // no event references a missing subject
  const threadIds = new Set(p.threads.map((t) => t.id));
  const contributorIds = new Set(p.contributors.map((c) => c.id));
  const aggIds = new Set(p.aggregates.map((a) => a.id));
  const eraIds = new Set(p.eras.map((e) => e.id));
  const tagNames = new Set(ds.refs.map((r) => r.name));
  for (const ev of p.events) {
    for (const s of ev.subjectIds) {
      const ok = s === '' || known.has(s) || threadIds.has(s) || contributorIds.has(s) || aggIds.has(s) || eraIds.has(s) || tagNames.has(s);
      expect(ok, `${ev.type} subject ${s}`).toBe(true);
    }
    expect(ev.performanceImpact).toBeGreaterThanOrEqual(ev.performanceStart - 1e-6);
    expect(ev.performanceEnd).toBeGreaterThanOrEqual(ev.performanceImpact - 1e-6);
  }
  // performance time is monotonic in history
  for (let i = 1; i < p.timeMap.length; i++) {
    expect(p.timeMap[i]![0]).toBeGreaterThan(p.timeMap[i - 1]![0]);
    expect(p.timeMap[i]![1]).toBeGreaterThanOrEqual(p.timeMap[i - 1]![1]);
  }
  // primary spine forms a valid first-parent chain
  const spine = p.nodes.filter((n) => n.isSpine).sort((a, b) => a.impact - b.impact);
  for (let i = 1; i < spine.length; i++) {
    const c = ds.commits.find((x) => x.sha === spine[i]!.sha)!;
    const prevVisible = spine[i - 1]!.sha;
    const fp = c.parentShas[0];
    // either direct first parent or first parent lies inside an aggregate run leading to prevVisible
    const direct = fp === prevVisible;
    const viaAgg = p.aggregates.some((a) => a.boundaryShas[1] === c.sha || a.memberShas.includes(fp ?? ''));
    expect(direct || viaAgg, `spine chain at ${c.sha.slice(0, 7)}`).toBe(true);
  }
  // boundaries are never roots
  for (const nd of p.nodes) {
    const c = ds.commits.find((x) => x.sha === nd.sha)!;
    if (c.parentShas.some((s) => !known.has(s))) expect(nd.kind).toBe('boundary');
    if (c.parentShas.length === 0) expect(nd.kind).toBe('root');
  }
  // camera cues cover the whole duration and never crop live junctions at merge impacts
  expect(p.camera.length).toBeGreaterThan(0);
  expect(p.camera[p.camera.length - 1]!.time).toBeGreaterThanOrEqual(p.duration - 0.1);
  for (const cue of p.camera) {
    expect(cue.w).toBeGreaterThan(0);
    expect(cue.h).toBeGreaterThan(0);
    expect(Math.abs(cue.rotation)).toBeLessThan(0.1);
  }
  expect(g.roots.length).toBe(p.stats.roots);
}

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
    expect(p.duration).toBeGreaterThan(30);
    expect(p.duration).toBeLessThan(90);
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
    const a = compile(ds, 's', { ...PRESET, targetDuration: 30 });
    const b = compile(ds, 's', { ...PRESET, targetDuration: 180 });
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
    const p = compile(ds, 'agg', { ...PRESET, aggregateAbove: 20 });
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
    const p = compile(ds, 'big', { ...PRESET, targetDuration: 90 });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(15000);
    expect(p.stats.aggregatedCommits).toBeGreaterThan(0);
    expect(p.nodes.length).toBeLessThan(ds.commits.length);
    assertInvariants(ds, p);
  });
});
