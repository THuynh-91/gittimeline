import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '@/fixtures/demo';
import { FIXTURES } from '@/fixtures/corpus';
import { PEOPLE, Script, shaFor } from '@/fixtures/synthetic';
import { SIDE_MAX, describeAggregate } from '@/analysis/aggregate';
import type { AggregateSpan, CompiledPerformance, Dataset } from '@/model/types';
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

/**
 * Merge bubbles: the shape GitHub's merge button repeats thousands of times.
 *
 * A pull-request repository is almost entirely junctions, and aggregation used
 * to refuse to touch a junction — so public-apis kept 1,587 of its 1,796
 * commits and ran seven minutes, which is the failure these tests hold shut. A
 * bubble collapses only when the branch genuinely left the spine, carried at
 * most SIDE_MAX plain commits and came straight back. Every other shape here
 * has to stay on stage, because collapsing it would hide topology.
 */
describe('merge bubbles', () => {
  const AGG = { ...PRESET, targetDuration: 20, aggregateAbove: 40 };
  const { mara, devi, kofi } = PEOPLE;

  /** `prs` pull requests merged one after another, each carrying `side` commits. */
  function treadmill(name: string, prs: number, side: number, tagEvery = 0): Dataset {
    const s = new Script(name, '2021-01-01T00:00:00Z');
    s.commit('main', 'seed', mara);
    for (let i = 0; i < prs; i++) {
      s.branch(`pr${i}`, 'main');
      for (let k = 0; k < side; k++) s.commit(`pr${i}`, `pr${i}-${k}`, devi, { days: 0.1 });
      s.merge('main', `pr${i}`, `m${i}`, mara, { days: 0.1 });
      if (tagEvery && i % tagEvery === 0) s.tag(`v0.${i}`, `m${i}`);
    }
    return s.build();
  }

  /** No edge may be lost: members touch nothing but each other and the two boundaries. */
  function assertEnclosed(ds: Dataset, agg: AggregateSpan) {
    const inside = new Set(agg.memberShas);
    const entry = agg.boundaryShas[0]!;
    const exit = agg.boundaryShas[1]!;
    expect(inside.has(entry) || inside.has(exit)).toBe(false);
    const bySha = new Map(ds.commits.map((c) => [c.sha, c]));
    const childrenOf = new Map<string, string[]>();
    for (const c of ds.commits) for (const parent of c.parentShas) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), c.sha]);
    for (const sha of agg.memberShas) {
      const c = bySha.get(sha)!;
      for (const parent of c.parentShas) expect(inside.has(parent) || parent === entry, `parent of ${sha.slice(0, 7)} is inside or the entry`).toBe(true);
      for (const child of childrenOf.get(sha) ?? []) expect(inside.has(child) || child === exit, `child of ${sha.slice(0, 7)} is inside or the exit`).toBe(true);
    }
    // Expansion recovers the exact chain: walking every parent back from the
    // exit without leaving the span visits precisely the members it claims.
    const seen = new Set<string>();
    const stack = [...bySha.get(exit)!.parentShas];
    while (stack.length) {
      const sha = stack.pop()!;
      if (!inside.has(sha) || seen.has(sha)) continue;
      seen.add(sha);
      for (const parent of bySha.get(sha)!.parentShas) stack.push(parent);
    }
    expect([...seen].sort()).toEqual([...agg.memberShas].sort());
  }

  /** Every commit is either a visible node or a member of exactly one ribbon. */
  function assertNothingDropped(ds: Dataset, p: CompiledPerformance) {
    const counted = new Map<string, number>();
    for (const nd of p.nodes) counted.set(nd.sha, (counted.get(nd.sha) ?? 0) + 1);
    for (const agg of p.aggregates) for (const sha of agg.memberShas) counted.set(sha, (counted.get(sha) ?? 0) + 1);
    for (const c of ds.commits) expect(counted.get(c.sha), `${c.sha.slice(0, 7)} accounted for exactly once`).toBe(1);
  }

  it('collapses one bubble into a ribbon between the branch point and the merge', () => {
    const s = new Script('one-bubble', '2021-01-01T00:00:00Z');
    s.commit('main', 'seed', mara);
    for (let i = 0; i < 45; i++) s.commit('main', `c${i}`, mara, { days: 0.5 });
    s.branch('pr', 'main');
    s.commit('pr', 'pr-1', devi, { days: 0.1 });
    s.commit('pr', 'pr-2', devi, { days: 0.1 });
    s.merge('main', 'pr', 'm', mara, { days: 0.1 });
    s.commit('main', 'after', mara, { days: 0.5 });
    const ds = s.build();
    const p = compile(ds, 'bubble', AGG);
    assertInvariants(ds, p);
    assertNothingDropped(ds, p);

    const shaOf = (label: string) => shaFor('one-bubble', label);
    const merge = p.nodes.find((nd) => nd.sha === shaOf('m'))!;
    expect(merge, 'the merge itself stays exact and visible').toBeTruthy();
    expect(merge.parentCount).toBe(2);
    const ribbon = p.aggregates.find((a) => a.boundaryShas[1] === merge.sha)!;
    expect(ribbon, 'the side branch became a ribbon').toBeTruthy();
    expect(ribbon.boundaryShas[0]).toBe(shaOf('c44'));
    expect(ribbon.memberShas).toEqual([shaOf('pr-1'), shaOf('pr-2')]);
    expect(ribbon.memberCount).toBe(2);
    expect(ribbon.mergeCount, 'the merge is the exit, so no merge is inside').toBe(0);
    assertEnclosed(ds, ribbon);
    for (const sha of ribbon.memberShas) expect(p.nodes.some((nd) => nd.sha === sha)).toBe(false);
    const entry = p.nodes.find((nd) => nd.sha === ribbon.boundaryShas[0])!;
    expect(p.edges.some((e) => e.kind === 'aggregate' && e.parent === entry.idx && e.child === merge.idx)).toBe(true);
  });

  it('collapses a run of bubbles into ribbons that count their merges', () => {
    const ds = treadmill('bubble-run', 40, 1);
    const p = compile(ds, 'bubble-run', AGG);
    assertInvariants(ds, p);
    assertNothingDropped(ds, p);

    const ribbons = p.aggregates.filter((a) => a.mergeCount > 0);
    expect(ribbons.length, 'consecutive bubbles collapse together').toBeGreaterThan(4);
    for (const agg of ribbons) {
      assertEnclosed(ds, agg);
      expect(agg.memberCount).toBe(agg.memberShas.length);
      expect(agg.memberCount).toBeGreaterThan(agg.mergeCount);
      // Both boundaries stay exact, individually rendered nodes.
      for (const sha of agg.boundaryShas) expect(p.nodes.some((nd) => nd.sha === sha)).toBe(true);
      expect(describeAggregate(agg)).toMatch(/^\d+ merged branch(es)? · \d+ commits$/);
    }
    expect(p.nodes.length, 'the treadmill fits the budget it was collapsed for').toBeLessThan(ds.commits.length / 2);
    expect(p.events.some((e) => e.type === 'AGGREGATE_SPAN' && /merged branch/.test(e.caption))).toBe(true);
  });

  it('leaves a bubble alone once its branch is longer than a bubble', () => {
    const short = treadmill('bubble-max', 40, SIDE_MAX);
    const ps = compile(short, 'bubble-max', AGG);
    assertInvariants(short, ps);
    expect(ps.aggregates.some((a) => a.mergeCount > 0), `${SIDE_MAX} commits is still a bubble`).toBe(true);

    const long = treadmill('bubble-over', 40, SIDE_MAX + 1);
    const pl = compile(long, 'bubble-over', AGG);
    assertInvariants(long, pl);
    assertNothingDropped(long, pl);
    expect(pl.aggregates.every((a) => a.mergeCount === 0), 'a branch with a story of its own is never collapsed').toBe(true);
    for (const c of long.commits) {
      if (c.parentShas.length > 1) expect(pl.nodes.some((nd) => nd.sha === c.sha), 'every merge stays visible').toBe(true);
    }
  });

  it('never collapses a merge a tag points at', () => {
    const ds = treadmill('bubble-tagged', 40, 1, 4);
    const p = compile(ds, 'bubble-tagged', AGG);
    assertInvariants(ds, p);
    assertNothingDropped(ds, p);
    const tagged = new Set(ds.refs.filter((r) => r.kind === 'tag').map((r) => r.targetSha));
    expect(tagged.size).toBe(10);
    for (const sha of tagged) expect(p.nodes.some((nd) => nd.sha === sha), 'a tagged merge is a landmark').toBe(true);
    // The tags break the runs up; the bubbles between them still collapse.
    expect(p.aggregates.some((a) => a.mergeCount > 0)).toBe(true);
    for (const agg of p.aggregates) for (const sha of agg.memberShas) expect(tagged.has(sha)).toBe(false);
  });

  it('never collapses an octopus merge', () => {
    const s = new Script('bubble-octopus', '2021-01-01T00:00:00Z');
    s.commit('main', 'seed', mara);
    for (let i = 0; i < 40; i++) {
      s.branch(`a${i}`, 'main');
      s.branch(`b${i}`, 'main');
      s.commit(`a${i}`, `a${i}-1`, devi, { days: 0.1 });
      s.commit(`b${i}`, `b${i}-1`, kofi, { days: 0.1 });
      s.merge('main', [`a${i}`, `b${i}`], `o${i}`, mara, { days: 0.1 });
    }
    const ds = s.build();
    const p = compile(ds, 'bubble-octopus', AGG);
    assertInvariants(ds, p);
    assertNothingDropped(ds, p);
    expect(p.aggregates.every((a) => a.mergeCount === 0)).toBe(true);
    for (const c of ds.commits) {
      if (c.parentShas.length < 3) continue;
      const nd = p.nodes.find((x) => x.sha === c.sha)!;
      expect(nd, 'an octopus merge always stays exact').toBeTruthy();
      expect(p.edges.filter((e) => e.child === nd.idx).length).toBe(c.parentShas.length);
    }
  });

  it('never collapses a criss-cross merge', () => {
    const s = new Script('bubble-crisscross', '2021-01-01T00:00:00Z');
    s.commit('main', 'seed', mara);
    s.branch('release', 'main');
    for (let i = 0; i < 14; i++) {
      s.commit('main', `m${i}`, devi, { days: 0.3 });
      s.commit('release', `r${i}`, kofi, { days: 0.2 });
      s.merge('release', 'main', `fwd${i}`, mara, { days: 0.1 });
      s.merge('main', 'release', `back${i}`, mara, { days: 0.1 });
    }
    const ds = s.build();
    const p = compile(ds, 'bubble-crisscross', AGG);
    assertInvariants(ds, p);
    assertNothingDropped(ds, p);
    expect(p.aggregates.every((a) => a.mergeCount === 0), 'a branch that merges both ways is not a bubble').toBe(true);
    for (const c of ds.commits) {
      if (c.parentShas.length > 1) expect(p.nodes.some((nd) => nd.sha === c.sha), 'every criss-cross merge stays visible').toBe(true);
    }
  });
});
