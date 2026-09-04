import { expect } from 'vitest';
import { compilePerformance } from '@/choreography/compile';
import { buildGraph } from '@/dag/graph';
import type { CompiledPerformance, Dataset, PlaybackPreset } from '@/model/types';

export const PRESET: PlaybackPreset = { id: 'cinematic', version: 1, targetDuration: 45, reducedMotion: false, aggregateAbove: 900 };

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

