import type {
  AggregateSpan,
  CompiledPerformance,
  CompileOptions,
  ContributorIdentity,
  Dataset,
  EdgeGeom,
  Era,
  NodeGeom,
  NodeKind,
  ThreadGeom,
} from '@/model/types';
import { ENGINE } from '@/model/types';
import { contentHashOf } from '@/model/hash';
import { buildGraph, uniqueAncestry } from '@/dag/graph';
import { correctTimestamps } from '@/dag/time';
import { selectSpine } from '@/dag/spine';
import { assignThreads } from '@/dag/threads';
import { aggregateLinearRuns } from '@/analysis/aggregate';
import { analyzeActivity } from '@/analysis/activity';
import { buildClock, mapMonotone, CLOCK_HEAD, CLOCK_TAIL, type ClockItem } from './clock';
import { layoutGraph, routeAlongLane, routeCurve, X_PER_SECOND, type ThreadLayoutInput } from '@/layout/layout';
import { buildEvents } from './events';
import { planCamera } from './camera';

export type ProgressStage = 'graph' | 'threads' | 'activity' | 'clock' | 'layout' | 'events' | 'camera' | 'done';
export type ProgressFn = (stage: ProgressStage, detail?: string) => void;

const HEAD = CLOCK_HEAD;
const TAIL = CLOCK_TAIL;

/**
 * Deterministic compilation: dataset + preset + seed → performance plan.
 * No Math.random, no wall-clock, no DOM. Runs identically in a Worker,
 * in Node tests, and on the main thread.
 */
export function compilePerformance(ds: Dataset, opts: CompileOptions, onProgress: ProgressFn = () => {}): CompiledPerformance {
  const commits = ds.commits;
  const n = commits.length;
  const reducedMotion = opts.preset.reducedMotion;
  if (n === 0) return emptyPerformance(ds, opts);

  onProgress('graph', `${n} commits`);
  const g = buildGraph(commits);
  const tc = correctTimestamps(g, commits);
  const presentation = tc.presentation;
  const spine = selectSpine(g, ds, presentation);

  onProgress('threads');
  const th = assignThreads(g, ds, spine, presentation);

  // Contributors: index by id, with a neutral fallback so nothing is ever unlabeled as "everyone".
  const contributors: ContributorIdentity[] = [...ds.contributors];
  const contributorIndex = new Map(contributors.map((c, i) => [c.id, i] as const));
  const contributorOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let idx = contributorIndex.get(commits[i]!.authorIdentityId);
    if (idx === undefined) {
      idx = contributors.length;
      contributors.push({
        id: commits[i]!.authorIdentityId,
        githubLogin: null,
        displayName: 'Anonymous author',
        githubNumericId: null,
        avatarUrl: null,
        color: '#9aa4b2',
        glyph: 'orb',
        isBot: false,
        aliases: [],
        provenance: 'derived',
        commitCount: 0,
      });
      contributorIndex.set(commits[i]!.authorIdentityId, idx);
    }
    contributorOf[i] = idx;
  }

  // Refs and tags per commit.
  const tagsOf = new Map<number, string[]>();
  const refsOf = new Map<number, string[]>();
  const refTargets = new Uint8Array(n);
  for (const r of ds.refs) {
    const id = g.index.get(r.targetSha);
    if (id === undefined) continue;
    refTargets[id] = 1;
    const map = r.kind === 'branch' ? refsOf : tagsOf;
    const list = map.get(id) ?? [];
    list.push(r.name);
    map.set(id, list);
  }
  for (const list of tagsOf.values()) list.sort();
  for (const list of refsOf.values()) list.sort();

  // Merge salience (spec §18.4).
  const mergeRaw = new Float32Array(n);
  const mergeVolume = new Int32Array(n);
  let maxMergeRaw = 0;
  for (let i = 0; i < n; i++) {
    const ps = g.parents[i]!;
    if (commits[i]!.parentShas.length < 2) continue;
    let unique = 0;
    const contribs = new Set<number>();
    let oldest = presentation[i]!;
    for (let k = 1; k < ps.length; k++) {
      const side = uniqueAncestry(g, ps[k]!, ps[0]!, 2000);
      unique += side.length;
      for (const s of side) {
        contribs.add(contributorOf[s]!);
        oldest = Math.min(oldest, presentation[s]!);
      }
    }
    mergeVolume[i] = unique;
    const ageDays = (presentation[i]! - oldest) / 86_400_000;
    let raw = 0.25 + 0.22 * Math.log2(1 + unique) + 0.12 * Math.log2(1 + contribs.size) + 0.08 * Math.log2(1 + ageDays);
    if (commits[i]!.parentShas.length > 2) raw += 0.6;
    if (tagsOf.has(i)) raw += 0.4;
    if (commits[i]!.stats) raw += 0.05 * Math.log2(1 + commits[i]!.stats!.additions + commits[i]!.stats!.deletions);
    mergeRaw[i] = raw;
    maxMergeRaw = Math.max(maxMergeRaw, raw);
  }
  const mergeSalienceC = new Float32Array(n);
  for (let i = 0; i < n; i++) if (mergeRaw[i]! > 0) mergeSalienceC[i] = Math.min(1, 0.3 + (0.7 * mergeRaw[i]!) / Math.max(1e-6, maxMergeRaw));

  // Protected landmarks never aggregate.
  const protectedIds = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = commits[i]!;
    if (c.parentShas.length !== 1 || c.flags.isBoundary || refTargets[i] || g.children[i]!.length !== 1) protectedIds[i] = 1;
  }
  th.members.forEach((ids) => {
    if (ids.length) {
      protectedIds[ids[0]!] = 1;
      protectedIds[ids[ids.length - 1]!] = 1;
    }
  });
  for (let i = 0; i < n; i++) for (let k = 1; k < g.parents[i]!.length; k++) protectedIds[g.parents[i]![k]!] = 1;

  // How many nodes can land inside the target duration and still each get a
  // legible beat? That, not a fixed commit count, is what decides aggregation.
  // Nine commits should not be stretched to a minute, and sixty thousand should
  // not be crammed into one. The show grows with the logarithm of the history,
  // bounded to a watchable window, and the viewer can nudge it brief or extended.
  const autoSeconds = Math.max(24, Math.min(165, 16 + 24 * Math.log10(1 + n))) * (opts.preset.lengthBias ?? 1);
  const targetSeconds = opts.preset.targetDuration > 0 ? opts.preset.targetDuration : autoSeconds;
  // Seconds of stage time each visible commit needs to read as its own beat.
  // This is what stops a large repository turning into a blur: the history is
  // collapsed into ribbons until what remains can actually be watched.
  const perNode = reducedMotion ? 0.4 : 0.26;
  const visibleBudget = Math.max(40, Math.min(opts.preset.aggregateAbove, Math.round((targetSeconds - HEAD - TAIL) / perNode)));
  const agg = aggregateLinearRuns(
    g,
    commits,
    th.members,
    protectedIds,
    presentation,
    contributorOf,
    contributors.map((c) => c.id),
    visibleBudget,
  );

  onProgress('activity');
  const threadSpans: Array<[number, number]> = th.members.map((ids, t) => {
    const start = presentation[ids[0]!]!;
    const mergeSha = th.threads[t]!.mergeSha;
    const mergeId = mergeSha ? g.index.get(mergeSha) : undefined;
    const end = mergeId !== undefined ? presentation[mergeId]! : presentation[ids[ids.length - 1]!]!;
    return [start, end];
  });
  const isDivergenceStart = new Uint8Array(n);
  th.members.forEach((ids, t) => {
    if (th.threads[t]!.baseSha && ids.length) isDivergenceStart[ids[0]!] = 1;
  });
  const tagCount = new Int32Array(n);
  for (const [id, list] of tagsOf) tagCount[id] = list.length;
  const activity = analyzeActivity({
    g,
    commits,
    presentation,
    threadOf: th.threadOf,
    threadSpans,
    contributorOf,
    mergeSignificance: mergeSalienceC,
    tagCount,
    isDivergenceStart,
    coverage: ds.coverage.completeness,
  });

  // Visible commits (aggregate interiors are carried by their span) in causal presentation order.
  const visible: number[] = [];
  for (let i = 0; i < n; i++) if (agg.aggregateOf[i] === -1) visible.push(i);
  visible.sort((a, b) => presentation[a]! - presentation[b]! || (g.shas[a]! < g.shas[b]! ? -1 : 1));
  const nodeOfCommit = new Int32Array(n).fill(-1);
  visible.forEach((cid, nid) => (nodeOfCommit[cid] = nid));

  // Aggregate exit lookup: exit commit id → aggregate idx.
  const aggByExit = new Map<number, number>();
  const aggByEntry = new Map<number, number>();
  agg.spans.forEach((s, i) => {
    aggByEntry.set(g.index.get(s.boundaryShas[0]!)!, i);
    aggByExit.set(g.index.get(s.boundaryShas[1]!)!, i);
  });

  onProgress('clock');
  const items: ClockItem[] = visible.map((cid) => {
    const c = commits[cid]!;
    const after: number[] = [];
    for (const p of g.parents[cid]!) {
      const pn = nodeOfCommit[p]!;
      if (pn >= 0) after.push(pn);
    }
    const aggIdx = aggByExit.get(cid);
    let weight = 1;
    if (aggIdx !== undefined) {
      const span = agg.spans[aggIdx]!;
      weight = Math.max(1.5, Math.min(3.2, Math.log2(span.memberCount + 1) * 0.55));
      const entry = nodeOfCommit[g.index.get(span.boundaryShas[0]!)!]!;
      if (entry >= 0) after.push(entry);
    }
    return {
      h: presentation[cid]!,
      intensity: activity.nodeIntensity[cid]!,
      volume: mergeVolume[cid]!,
      thread: th.threadOf[cid]!,
      after,
      weight,
      isMerge: c.parentShas.length > 1,
      isDivergence: isDivergenceStart[cid] === 1,
      salience: mergeSalienceC[cid]!,
    };
  });
  // Second pass on the length. Aggregation collapses linear runs, but a
  // merge-heavy project (a PR-per-change workflow) has thousands of junctions
  // that cannot be collapsed without hiding topology. Rather than blur them
  // past legibility, the show lengthens until each visible commit gets a
  // readable moment, up to a firm ceiling.
  const paced = Math.max(targetSeconds, Math.min(180, visible.length * (reducedMotion ? 0.18 : 0.12)));
  const clock = buildClock(items, paced, reducedMotion);

  onProgress('layout');
  // Layout runs in natural time so geometry is identical for every target duration.
  const naturalTime = Float64Array.from(clock.impact, (v) => (v - HEAD) / clock.scale);
  const threadInputs: ThreadLayoutInput[] = th.members.map((ids, t) => {
    const meta = th.threads[t]!;
    const nodeIds = ids.map((cid) => nodeOfCommit[cid]!).filter((nid) => nid >= 0);
    const baseCid = meta.baseSha ? g.index.get(meta.baseSha) : undefined;
    const mergeCid = meta.mergeSha ? g.index.get(meta.mergeSha) : undefined;
    return {
      idx: t,
      id: meta.id,
      nodeIds,
      baseId: baseCid !== undefined ? nodeOfCommit[baseCid]! : -1,
      mergeId: mergeCid !== undefined ? nodeOfCommit[mergeCid]! : -1,
      isSpine: meta.role === 'primary' && t === 0,
    };
  });
  const layout = layoutGraph(threadInputs, naturalTime, X_PER_SECOND, opts.seed);

  const spineSet = new Set(spine.ids);
  const nodes: NodeGeom[] = visible.map((cid, nid) => {
    const c = commits[cid]!;
    const kind: NodeKind = c.parentShas.length === 0 ? 'root' : c.flags.isBoundary ? 'boundary' : c.parentShas.length > 1 ? 'merge' : 'commit';
    const tags = tagsOf.get(cid) ?? [];
    const sal = Math.min(1, (c.parentShas.length > 1 ? mergeSalienceC[cid]! : 0.1 + 0.25 * activity.nodeIntensity[cid]!) + (tags.length ? 0.3 : 0));
    return {
      idx: nid,
      sha: c.sha,
      x: round(layout.x[nid]!),
      y: round(layout.y[nid]!),
      threadIdx: th.threadOf[cid]!,
      impact: round(clock.impact[nid]!, 4),
      beat: clock.beat[nid]!,
      salience: round(sal, 3),
      kind,
      contributorIdx: contributorOf[cid]!,
      isSpine: spineSet.has(cid),
      isMerge: c.parentShas.length > 1,
      parentCount: c.parentShas.length,
      mergeVolume: mergeVolume[cid]!,
      tagLabels: tags,
      refLabels: refsOf.get(cid) ?? [],
      aggregateIdx: aggByEntry.get(cid) ?? null,
      provenance: c.provenance,
    };
  });
  const commitOfNode = Int32Array.from(visible);

  // Threads geometry.
  const threads: ThreadGeom[] = threadInputs.map((ti) => {
    const meta = th.threads[ti.idx]!;
    const lay = layout.threads[ti.idx]!;
    const lastNid = ti.nodeIds[ti.nodeIds.length - 1];
    const refNames = meta.knownRefIds
      .map((id) => ds.refs.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .sort((a, b) => (a.kind === 'branch' ? 0 : 1) - (b.kind === 'branch' ? 0 : 1) || (a.name < b.name ? -1 : 1));
    const label = ti.isSpine ? ds.source.defaultBranch : refNames[0]?.name ?? null;
    const ending: ThreadGeom['ending'] = ti.mergeId >= 0 ? 'merged' : refNames.some((r) => r.kind === 'branch') || ti.isSpine ? 'tip' : 'dormant';
    return {
      idx: ti.idx,
      id: meta.id,
      role: meta.role,
      lane: lay.lane,
      side: lay.side,
      nodeIdxs: ti.nodeIds,
      label,
      start: ti.nodeIds.length ? nodes[ti.nodeIds[0]!]!.impact : 0,
      end: ti.mergeId >= 0 ? nodes[ti.mergeId]!.impact : lastNid !== undefined ? nodes[lastNid]!.impact : 0,
      ending,
      mergeNodeIdx: ti.mergeId >= 0 ? ti.mergeId : null,
      baseNodeIdx: ti.baseId >= 0 ? ti.baseId : null,
      provenance: meta.provenance,
    };
  });

  // Edges with travel windows. Every known parent relation becomes exactly one edge.
  const edges: EdgeGeom[] = [];
  const covered = new Set<string>();
  const unknownDrawn = new Set<string>();
  const aggregateEdge = new Int32Array(agg.spans.length).fill(-1);
  const beatLenN = clock.beatLen;
  const dwellFor = (a: NodeGeom, b: NodeGeom) => Math.min(0.28, (b.impact - a.impact) * 0.32);
  const addEdge = (
    parent: number,
    child: number,
    parentIndex: number,
    kind: EdgeGeom['kind'],
    body: EdgeGeom['body'],
    start: number,
    end: number,
    threadIdx: number,
    geometry: { pts: Float32Array; length: number },
    fromContributor: number,
  ) => {
    const c = nodes[child]!;
    const e: EdgeGeom = {
      idx: edges.length,
      parent,
      child,
      parentIndex,
      kind,
      pts: geometry.pts,
      length: round(geometry.length),
      threadIdx,
      start: round(Math.min(start, end - 0.02), 4),
      end: round(end, 4),
      contributorIdx: c.contributorIdx,
      fromContributorIdx: fromContributor,
      body,
      salience: c.salience,
      provenance: kind === 'unknown' ? 'unknown' : kind === 'aggregate' ? 'aggregate' : 'exact',
    };
    edges.push(e);
    if (parent >= 0) covered.add(`${parent}>${child}`);
    return e;
  };

  for (const t of threads) {
    const laneFn = (px: number) => layout.laneY(t.idx, px);
    const ids = t.nodeIdxs;
    for (let i = 0; i < ids.length; i++) {
      const nid = ids[i]!;
      const nd = nodes[nid]!;
      const bl = beatLenN[nid]!;
      if (i === 0) {
        if (t.baseNodeIdx != null) {
          const base = nodes[t.baseNodeIdx]!;
          const approach = Math.min(nd.impact - base.impact - 0.02, bl * 1.6);
          addEdge(base.idx, nid, 0, 'divergence', 'performer', nd.impact - approach, nd.impact, t.idx, routeCurve(base, nd, 'divergence'), base.contributorIdx);
        } else if (nd.kind === 'boundary') {
          const from = { x: nd.x - 70, y: nd.y };
          addEdge(-1, nid, 0, 'unknown', 'performer', nd.impact - bl * 1.5, nd.impact, t.idx, routeAlongLane(() => nd.y, from.x, nd.x), -1);
          unknownDrawn.add(`${nid}:0`);
        }
      } else {
        const prev = nodes[ids[i - 1]!]!;
        const aggIdx = aggByExit.get(commitOfNode[nid]!);
        const start = prev.impact + dwellFor(prev, nd);
        if (aggIdx !== undefined && aggByEntry.get(commitOfNode[prev.idx]!) === aggIdx) {
          const e = addEdge(prev.idx, nid, 0, 'aggregate', 'performer', start, nd.impact, t.idx, routeAlongLane(laneFn, prev.x, nd.x), prev.contributorIdx);
          aggregateEdge[aggIdx] = e.idx;
        } else {
          addEdge(prev.idx, nid, 0, 'thread', 'performer', start, nd.impact, t.idx, routeAlongLane(laneFn, prev.x, nd.x), prev.contributorIdx);
        }
      }
    }
    if (t.mergeNodeIdx != null && ids.length) {
      const last = nodes[ids[ids.length - 1]!]!;
      const m = nodes[t.mergeNodeIdx]!;
      const mc = commits[commitOfNode[m.idx]!]!;
      const slot = Math.max(1, mc.parentShas.indexOf(last.sha));
      addEdge(last.idx, m.idx, slot, 'merge', 'performer', last.impact + dwellFor(last, m), m.impact, t.idx, routeCurve(last, m, 'merge'), last.contributorIdx);
    }
  }
  // Remaining parent relations: secondary edges carried by transient pulses.
  for (const nd of nodes) {
    const cid = commitOfNode[nd.idx]!;
    const ps = g.parents[cid]!;
    const slots = g.parentSlots[cid]!;
    for (let k = 0; k < ps.length; k++) {
      const pn = nodeOfCommit[ps[k]!]!;
      if (pn < 0) continue; // aggregated interior (only ever the first parent of an exit node — covered by the span)
      if (covered.has(`${pn}>${nd.idx}`)) continue;
      const p = nodes[pn]!;
      const bl = beatLenN[nd.idx]!;
      const approach = Math.min(nd.impact - p.impact - 0.02, bl * 1.6);
      addEdge(pn, nd.idx, slots[k]!, 'secondary', 'pulse', nd.impact - approach, nd.impact, nd.threadIdx, routeCurve(p, nd, 'secondary'), p.contributorIdx);
    }
    if (nd.kind === 'boundary') {
      // Every parent that was not loaded gets its own honest "history not loaded" edge.
      const c = commits[cid]!;
      c.parentShas.forEach((psha, slot) => {
        if (g.index.has(psha) || unknownDrawn.has(`${nd.idx}:${slot}`)) return;
        unknownDrawn.add(`${nd.idx}:${slot}`);
        const bl = beatLenN[nd.idx]!;
        const dy = slot === 0 ? 0 : (slot % 2 ? -1 : 1) * (28 + 14 * Math.floor(slot / 2));
        const geometry = slot === 0 ? routeAlongLane(() => nd.y, nd.x - 70, nd.x) : routeCurve({ x: nd.x - 70, y: nd.y + dy }, nd, 'secondary');
        addEdge(-1, nd.idx, slot, 'unknown', slot === 0 ? 'performer' : 'pulse', nd.impact - bl * 1.5, nd.impact, nd.threadIdx, geometry, -1);
      });
    }
  }
  edges.sort((a, b) => a.start - b.start || a.idx - b.idx);
  edges.forEach((e, i) => {
    e.idx = i;
    if (e.kind === 'aggregate') {
      const aggIdx = aggByExit.get(commitOfNode[e.child]!);
      if (aggIdx !== undefined) aggregateEdge[aggIdx] = i;
    }
  });

  // Historical → performance map (monotone).
  const timeMap: Array<[number, number]> = [];
  let lastH = -Infinity;
  for (const nd of nodes) {
    const h = presentation[commitOfNode[nd.idx]!]!;
    if (h > lastH) {
      timeMap.push([h, nd.impact]);
      lastH = h;
    }
  }
  if (timeMap.length === 1) timeMap.push([timeMap[0]![0] + 1, timeMap[0]![1] + 0.001]);

  const eras: Era[] = activity.eras.map((e) => ({
    ...e,
    performanceStart: round(mapMonotone(timeMap, e.historicalStart), 3),
    performanceEnd: round(mapMonotone(timeMap, e.historicalEnd), 3),
  }));

  onProgress('events');
  const mergeVolumeN = new Int32Array(nodes.length);
  const mergeSalienceN = new Float32Array(nodes.length);
  const gapsN = new Map<number, number>();
  nodes.forEach((nd, nid) => {
    mergeSalienceN[nid] = mergeSalienceC[commitOfNode[nid]!]!;
    mergeVolumeN[nid] = mergeVolume[commitOfNode[nid]!]!;
    const gap = clock.gaps.get(nid);
    if (gap !== undefined) gapsN.set(nid, gap);
  });
  const boundaryCount = g.boundaries.length;
  const plan = buildEvents({
    nodes,
    edges,
    threads,
    commits,
    commitOfNode,
    contributors,
    aggregates: agg.spans,
    aggregateEdge,
    eras,
    mergeSalience: mergeSalienceN,
    mergeVolume: mergeVolumeN,
    beatLen: beatLenN,
    gaps: gapsN,
    presentation,
    duration: clock.duration,
    tail: TAIL,
    head: HEAD,
    reducedMotion,
    defaultBranch: ds.source.defaultBranch,
    boundaryCount,
  });

  // Bounds.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of edges) {
    for (let i = 0; i < e.pts.length; i += 2) {
      minX = Math.min(minX, e.pts[i]!);
      maxX = Math.max(maxX, e.pts[i]!);
      minY = Math.min(minY, e.pts[i + 1]!);
      maxY = Math.max(maxY, e.pts[i + 1]!);
    }
  }
  for (const nd of nodes) {
    minX = Math.min(minX, nd.x);
    maxX = Math.max(maxX, nd.x);
    minY = Math.min(minY, nd.y);
    maxY = Math.max(maxY, nd.y);
  }
  const bounds = { minX: round(minX - 40), minY: round(minY - 40), maxX: round(maxX + 40), maxY: round(maxY + 40) };

  onProgress('camera');
  const camera = planCamera({ nodes, edges, events: plan.events, duration: clock.duration, tail: TAIL, bounds, reducedMotion });

  // Waveform in performance time.
  const waveform = new Float32Array(720);
  const buckets = activity.buckets;
  if (buckets.length) {
    const h0 = buckets[0]!.historicalStart;
    const width = buckets[0]!.historicalEnd - h0;
    for (let i = 0; i < waveform.length; i++) {
      const p = (clock.duration * i) / (waveform.length - 1);
      const h = mapMonotone(timeMap, p, true);
      const f = (h - h0) / width - 0.5;
      const b0 = Math.min(buckets.length - 1, Math.max(0, Math.floor(f)));
      const b1 = Math.min(buckets.length - 1, b0 + 1);
      const k = Math.min(1, Math.max(0, f - b0));
      const v = buckets[b0]!.phraseIntensity * (1 - k) + buckets[b1]!.phraseIntensity * k;
      waveform[i] = p < HEAD * 0.8 || p > clock.duration - TAIL ? v * 0.35 : v;
    }
  }

  const refs = ds.refs.filter((r) => g.index.has(r.targetSha));
  const maxConcurrentThreads = plan.events.filter((e) => e.type === 'PARALLEL_PHRASE').reduce((m, e) => Math.max(m, e.subjectIds.length), threads.length ? 1 : 0);

  const warnings = [...ds.coverage.warnings];
  if (tc.largeCorrections.length) warnings.push(`${tc.largeCorrections.length} commit timestamp${tc.largeCorrections.length === 1 ? '' : 's'} corrected by more than a day to respect parent-before-child order.`);
  if (tc.missingTimestamps.length) warnings.push(`${tc.missingTimestamps.length} commit${tc.missingTimestamps.length === 1 ? '' : 's'} had no timestamp and were placed causally.`);
  if (spine.provenance === 'derived') warnings.push(`Primary spine policy: ${spine.policy} (default branch tip was not available).`);

  const result: CompiledPerformance = {
    engine: ENGINE,
    seed: opts.seed,
    preset: opts.preset,
    duration: round(clock.duration, 3),
    source: ds.source,
    coverage: { ...ds.coverage, warnings },
    nodes,
    edges,
    threads,
    events: plan.events,
    camera,
    timeMap,
    tempoMap: clock.tempoMap,
    activity: buckets,
    waveform,
    eras,
    contributors,
    aggregates: agg.spans,
    refs,
    landmarks: plan.landmarks,
    transcript: plan.transcript,
    bounds,
    planHash: '',
    stats: {
      commits: n,
      merges: commits.filter((c) => c.parentShas.length > 1).length,
      roots: g.roots.length,
      boundaries: boundaryCount,
      threads: threads.length,
      contributors: contributors.length,
      maxConcurrentThreads,
      aggregatedCommits: agg.spans.reduce((s, a) => s + a.memberCount, 0),
    },
  };
  result.planHash = contentHashOf({
    nodes: nodes.map((nd) => [nd.sha, nd.x, nd.y, nd.impact, nd.threadIdx]),
    edges: edges.map((e) => [e.parent, e.child, e.kind, e.start, e.end]),
    events: plan.events.map((e) => [e.type, e.performanceImpact, e.subjectIds]),
    camera: camera.filter((_, i) => i % 10 === 0).map((c) => [c.x, c.y, c.w, c.h, c.state]),
    seed: opts.seed,
    engine: ENGINE,
  });
  onProgress('done');
  return result;
}

function emptyPerformance(ds: Dataset, opts: CompileOptions): CompiledPerformance {
  const duration = 6;
  return {
    engine: ENGINE,
    seed: opts.seed,
    preset: opts.preset,
    duration,
    source: ds.source,
    coverage: ds.coverage,
    nodes: [],
    edges: [],
    threads: [],
    events: [
      {
        id: 'repo_present-0',
        type: 'REPO_PRESENT',
        historicalTime: null,
        performanceStart: 0,
        performanceImpact: 1,
        performanceEnd: duration,
        subjectIds: [],
        salience: 0.3,
        beat: 0,
        variant: 'empty',
        effectBudget: 1,
        provenance: 'exact',
        caption: 'No commits yet — a dormant seed',
      },
    ],
    camera: [
      { time: 0, x: 0, y: 0, w: 480, h: 300, rotation: 0, punch: 1, reasonEventId: null, state: 'tableau' },
      { time: duration, x: 0, y: 0, w: 480, h: 300, rotation: 0, punch: 1, reasonEventId: null, state: 'tableau' },
    ],
    timeMap: [[0, 0]],
    tempoMap: [[0, 72]],
    activity: [],
    waveform: new Float32Array(720),
    eras: [],
    contributors: [],
    aggregates: [],
    refs: [],
    landmarks: [],
    transcript: ['This repository has no commits yet.'],
    bounds: { minX: -240, minY: -150, maxX: 240, maxY: 150 },
    planHash: contentHashOf({ empty: true, seed: opts.seed }),
    stats: { commits: 0, merges: 0, roots: 0, boundaries: 0, threads: 0, contributors: 0, maxConcurrentThreads: 0, aggregatedCommits: 0 },
  };
}

function round(v: number, p = 2): number {
  const m = Math.pow(10, p);
  return Math.round(v * m) / m;
}

export type { AggregateSpan };
