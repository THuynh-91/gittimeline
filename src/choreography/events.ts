import type {
  AggregateSpan,
  ChoreographyEvent,
  ChoreographyEventType,
  CommitNode,
  ContributorIdentity,
  EdgeGeom,
  Era,
  Landmark,
  NodeGeom,
  Provenance,
  ThreadGeom,
} from '@/model/types';
import { describeAggregate } from '@/analysis/aggregate';

/**
 * Choreography event grammar (spec §11). Every event traces back to a
 * repository fact and a salience score; presentation (amplitude, staging)
 * varies with salience, meaning never does.
 */
export interface EventContext {
  nodes: NodeGeom[];
  edges: EdgeGeom[];
  threads: ThreadGeom[];
  commits: CommitNode[];
  commitOfNode: Int32Array;
  contributors: ContributorIdentity[];
  aggregates: AggregateSpan[];
  aggregateEdge: Int32Array; // aggregate idx → edge idx
  eras: Era[];
  mergeSalience: Float32Array; // per node
  mergeVolume: Int32Array; // per node
  beatLen: Float32Array; // per node
  gaps: Map<number, number>; // node idx → historical gap ms
  presentation: Float64Array; // per commit
  duration: number;
  tail: number;
  head: number;
  reducedMotion: boolean;
  defaultBranch: string | null;
  boundaryCount: number;
}

export interface EventPlan {
  events: ChoreographyEvent[];
  landmarks: Landmark[];
  transcript: string[];
}

export function fmtDate(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return 'unknown date';
  return new Date(ms).toISOString().slice(0, 10);
}

export function fmtMonth(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

export function buildEvents(ctx: EventContext): EventPlan {
  const { nodes, edges, threads, commits, commitOfNode, contributors } = ctx;
  const events: ChoreographyEvent[] = [];
  const landmarks: Landmark[] = [];
  let counter = 0;
  const push = (
    type: ChoreographyEventType,
    start: number,
    impact: number,
    end: number,
    subjects: string[],
    salience: number,
    caption: string,
    extra: Partial<ChoreographyEvent> = {},
  ): ChoreographyEvent => {
    const ev: ChoreographyEvent = {
      id: `${type.toLowerCase()}-${counter++}`,
      type,
      historicalTime: null,
      performanceStart: r(start),
      performanceImpact: r(impact),
      performanceEnd: r(Math.max(end, impact)),
      subjectIds: subjects,
      salience: r(Math.max(0, Math.min(1, salience)), 3),
      beat: 0,
      variant: 'default',
      effectBudget: 1,
      provenance: 'exact',
      caption,
      ...extra,
    };
    events.push(ev);
    return ev;
  };
  const who = (nd: NodeGeom) => contributors[nd.contributorIdx]?.displayName ?? 'Anonymous author';
  const commitOf = (nd: NodeGeom) => commits[commitOfNode[nd.idx]!]!;
  const hist = (nd: NodeGeom) => ctx.presentation[commitOfNode[nd.idx]!]!;
  const subjectOf = (nd: NodeGeom) => commitOf(nd).messageSubject || '(no message)';
  const short = (sha: string) => sha.slice(0, 7);

  // --- Roots ---
  const roots = nodes.filter((nd) => nd.kind === 'root').sort((a, b) => a.impact - b.impact);
  roots.forEach((nd, i) => {
    const bl = ctx.beatLen[nd.idx]!;
    if (i === 0) {
      const ev = push('REPO_BIRTH', nd.impact - ctx.head, nd.impact, nd.impact + bl * 2, [nd.sha], 0.8, `First known commit · ${who(nd)} · ${fmtDate(hist(nd))}`, {
        historicalTime: hist(nd),
        beat: nd.beat,
      });
      landmarks.push({ time: nd.impact, historicalTime: hist(nd), kind: 'birth', label: 'first commit', nodeIdx: nd.idx, eventId: ev.id });
    } else {
      push('MULTI_ROOT_REVEAL', nd.impact - bl, nd.impact, nd.impact + bl * 2, [nd.sha], 0.7, `Unrelated history begins · ${who(nd)} · ${fmtDate(hist(nd))}`, {
        historicalTime: hist(nd),
        beat: nd.beat,
      });
    }
  });

  if (roots.length === 0 && nodes.length) {
    const earliest = nodes.reduce((a, b) => (b.impact < a.impact ? b : a));
    const bl = ctx.beatLen[earliest.idx]!;
    const ev = push('REPO_BIRTH', earliest.impact - ctx.head, earliest.impact, earliest.impact + bl * 2, [earliest.sha], 0.7, `Earliest loaded commit · ${who(earliest)} · ${fmtDate(hist(earliest))} (earlier history not loaded)`, {
      historicalTime: hist(earliest),
      beat: earliest.beat,
      provenance: 'unknown',
      variant: 'partial',
    });
    landmarks.push({ time: earliest.impact, historicalTime: hist(earliest), kind: 'birth', label: 'earliest loaded', nodeIdx: earliest.idx, eventId: ev.id });
  }

  // --- Per-node events ---
  const seenContributor = new Set<number>();
  const mergeEvents: ChoreographyEvent[] = [];
  const incoming: Map<number, EdgeGeom[]> = new Map();
  for (const e of edges) {
    const list = incoming.get(e.child) ?? [];
    list.push(e);
    incoming.set(e.child, list);
  }

  for (const nd of nodes) {
    const c = commitOf(nd);
    const h = hist(nd);
    const bl = ctx.beatLen[nd.idx]!;
    const thread = threads[nd.threadIdx]!;
    const caption = `${who(nd)} · ${subjectOf(nd)} · ${fmtDate(h)}`;

    if (!seenContributor.has(nd.contributorIdx)) {
      seenContributor.add(nd.contributorIdx);
      const contributor = contributors[nd.contributorIdx];
      const inEdge = incoming.get(nd.idx)?.find((e) => e.body === 'performer');
      push('CONTRIBUTOR_ENTER', inEdge ? inEdge.start : nd.impact - bl * 0.5, nd.impact, nd.impact + bl, [contributor?.id ?? '', nd.sha], 0.35, `${who(nd)} joins${contributor?.isBot ? ' (bot)' : ''}`, {
        historicalTime: h,
        beat: nd.beat,
        variant: contributor?.isBot ? 'bot' : 'human',
      });
    }

    const gap = ctx.gaps.get(nd.idx);
    if (gap !== undefined) {
      const prevImpact = nd.impact - Math.min(nd.impact, bl * 2.5);
      const days = Math.round(gap / 86_400_000);
      const label = days >= 365 ? `${(days / 365).toFixed(1)} years` : days >= 60 ? `${Math.round(days / 30)} months` : `${days} days`;
      push('QUIET_GAP', prevImpact, nd.impact, nd.impact, [nd.sha], 0.3, `Quiet span of ${label} passes`, { historicalTime: h, beat: nd.beat });
    }

    if (nd.kind === 'boundary') {
      push('UNKNOWN_SPAN', nd.impact - bl * 1.5, nd.impact, nd.impact + bl, [nd.sha], 0.4, `History before ${short(nd.sha)} is not loaded`, {
        historicalTime: h,
        beat: nd.beat,
        provenance: 'unknown',
      });
      if (landmarks.filter((l) => l.kind === 'unknown').length < 6) {
        landmarks.push({ time: nd.impact, historicalTime: h, kind: 'unknown', label: 'history not loaded', nodeIdx: nd.idx, eventId: events[events.length - 1]!.id });
      }
    }

    const isThreadStart = thread.nodeIdxs[0] === nd.idx;
    if (isThreadStart && thread.baseNodeIdx != null && thread.baseNodeIdx >= 0) {
      const base = nodes[thread.baseNodeIdx]!;
      const inEdge = incoming.get(nd.idx)?.find((e) => e.kind === 'divergence');
      const sal = Math.min(1, 0.35 + 0.08 * Math.log2(1 + thread.nodeIdxs.length) + (thread.ending === 'merged' ? 0.15 : 0.25));
      const ev = push('DIVERGENCE', inEdge ? inEdge.start : nd.impact - bl, nd.impact, nd.impact + bl, [base.sha, nd.sha, thread.id], sal, `${thread.label ? `“${thread.label}” ` : `${thread.id} `}peels away from ${short(base.sha)} · ${who(nd)} · ${fmtDate(h)}`, {
        historicalTime: h,
        beat: nd.beat,
        provenance: 'derived',
      });
      if (sal >= 0.6 || thread.nodeIdxs.length >= 3) landmarks.push({ time: nd.impact, historicalTime: h, kind: 'divergence', label: thread.label ?? thread.id, nodeIdx: nd.idx, eventId: ev.id });
    } else if (isThreadStart && thread.role !== 'primary' && nd.kind !== 'root' && nd.kind !== 'boundary') {
      push('THREAD_ACTIVATE', nd.impact - bl, nd.impact, nd.impact + bl, [nd.sha, thread.id], 0.4, `${thread.label ?? thread.id} becomes active · ${fmtDate(h)}`, { historicalTime: h, beat: nd.beat });
    }

    if (nd.isMerge) {
      const ins = incoming.get(nd.idx) ?? [];
      const start = ins.length ? Math.min(...ins.map((e) => e.start)) : nd.impact - bl;
      const sal = ctx.mergeSalience[nd.idx]!;
      const parents = c.parentShas;
      const type: ChoreographyEventType = parents.length > 2 ? 'OCTOPUS_MERGE' : sal >= 0.72 ? 'MAJOR_MERGE' : 'MERGE_IMPACT';
      const subjects = [nd.sha, ...ins.filter((e) => e.parent >= 0).map((e) => nodes[e.parent]!.sha)];
      push('MERGE_APPROACH', start, nd.impact, nd.impact, subjects, sal, `${ins.length} path${ins.length === 1 ? '' : 's'} converge toward ${short(nd.sha)}`, {
        historicalTime: h,
        beat: nd.beat,
      });
      const volume = ctx.mergeVolume[nd.idx] ?? 0;
      const release = bl * (1.5 + 2 * sal) * (1 + Math.min(1.2, Math.log2(1 + volume) * 0.16));
      const scaleWord = type === 'OCTOPUS_MERGE' ? `Octopus merge of ${parents.length} parents` : type === 'MAJOR_MERGE' ? 'Major merge' : 'Merge';
      const volumeWord = volume > 0 ? ` · ${volume} commit${volume === 1 ? '' : 's'} converge` : '';
      const ev = push(type, nd.impact - 0.2, nd.impact, nd.impact + release, subjects, sal, `${scaleWord}${volumeWord} · ${who(nd)} · ${subjectOf(nd)} · ${fmtDate(h)}`, {
        historicalTime: h,
        beat: nd.beat,
        variant: parents.length > 2 ? 'octopus' : sal >= 0.72 ? 'major' : 'standard',
      });
      mergeEvents.push(ev);
      if (sal >= 0.55 || type !== 'MERGE_IMPACT') landmarks.push({ time: nd.impact, historicalTime: h, kind: 'merge', label: type === 'OCTOPUS_MERGE' ? 'octopus merge' : 'merge', nodeIdx: nd.idx, eventId: ev.id });
    } else if (nd.kind !== 'root') {
      push('COMMIT_STEP', nd.impact - bl * 0.5, nd.impact, nd.impact + bl * 0.5, [nd.sha], 0.15 + 0.2 * nd.salience, caption, { historicalTime: h, beat: nd.beat });
    }

    for (const tag of nd.tagLabels) {
      const ev = push('TAG_LANDMARK', nd.impact - bl, nd.impact, nd.impact + bl * 2, [nd.sha, tag], 0.65, `Tag ${tag} · ${fmtDate(h)}`, { historicalTime: h, beat: nd.beat });
      landmarks.push({ time: nd.impact, historicalTime: h, kind: 'tag', label: tag, nodeIdx: nd.idx, eventId: ev.id });
    }
  }

  // --- Handoffs (edges where the carried contributor changes) ---
  for (const e of edges) {
    if (e.body !== 'performer' || e.fromContributorIdx < 0 || e.fromContributorIdx === e.contributorIdx) continue;
    if (e.kind !== 'thread' && e.kind !== 'aggregate') continue;
    const from = contributors[e.fromContributorIdx]?.displayName ?? 'someone';
    const to = contributors[e.contributorIdx]?.displayName ?? 'someone';
    const nd = nodes[e.child]!;
    push('CONTRIBUTOR_HANDOFF', e.start, e.end, e.end + ctx.beatLen[e.child]! * 0.5, [nodes[e.parent]!.sha, nd.sha, contributors[e.fromContributorIdx]?.id ?? '', contributors[e.contributorIdx]?.id ?? ''], 0.3, `${from} hands ${threads[e.threadIdx]!.label ?? threads[e.threadIdx]!.id} to ${to}`, {
      historicalTime: hist(nd),
      beat: nd.beat,
      variant: 'crossfade',
    });
  }

  // --- Aggregates ---
  ctx.aggregates.forEach((agg, i) => {
    const eIdx = ctx.aggregateEdge[i]!;
    const e = edges[eIdx];
    if (!e) return;
    push('AGGREGATE_SPAN', e.start, e.end, e.end, [agg.id, ...agg.boundaryShas], 0.4, `${describeAggregate(agg)} pass as one span (${fmtDate(agg.historicalStart)} → ${fmtDate(agg.historicalEnd)})`, {
      historicalTime: agg.historicalStart,
      provenance: 'aggregate',
      variant: 'ribbon',
    });
    push('COMMIT_CLUSTER', e.start, e.end, e.end, [agg.id], 0.35, `${describeAggregate(agg)} by ${agg.contributorIds.length} contributor${agg.contributorIds.length === 1 ? '' : 's'}`, {
      historicalTime: agg.historicalStart,
      provenance: 'aggregate',
    });
  });

  // --- Thread endings ---
  for (const th of threads) {
    const last = nodes[th.nodeIdxs[th.nodeIdxs.length - 1]!];
    if (!last) continue;
    const bl = ctx.beatLen[last.idx]!;
    if (th.ending === 'tip') {
      push('UNMERGED_TIP', last.impact, last.impact, last.impact + bl * 2, [last.sha, th.id], 0.45, `${th.label ? `“${th.label}”` : th.id} remains a live line of development · ${fmtDate(hist(last))}`, {
        historicalTime: hist(last),
        beat: last.beat,
      });
    } else if (th.ending === 'dormant' && th.role !== 'primary') {
      push('THREAD_DORMANT', last.impact, last.impact + bl, last.impact + bl * 3, [last.sha, th.id], 0.25, `${th.id} goes quiet after ${fmtDate(hist(last))}`, {
        historicalTime: hist(last),
        beat: last.beat,
        provenance: 'derived',
      });
    }
  }

  // --- Merge storms: several impacts inside a short window become one phrase ---
  mergeEvents.sort((a, b) => a.performanceImpact - b.performanceImpact);
  // Indexed once rather than searched per merge.
  //
  // This was `nodes.find(x => x.sha === ...)` inside the loop below, which is a
  // linear scan of every node for every merge. On most histories that is
  // invisible. On a merge-queue project it is the entire cost of compiling:
  // Rust has 107,048 merges and 248,298 nodes, so the search ran 26.6 billion
  // comparisons and this function took twenty-eight minutes. Linux never
  // finished at all.
  const nodeBySha = new Map<string, NodeGeom>();
  for (const nd of nodes) nodeBySha.set(nd.sha, nd);

  let i = 0;
  while (i < mergeEvents.length) {
    let j = i;
    while (j + 1 < mergeEvents.length) {
      const cur = mergeEvents[j]!;
      const nd = nodeBySha.get(cur.subjectIds[0]!);
      const window = Math.max(1.0, (nd ? ctx.beatLen[nd.idx]! : 0.5) * 3.2);
      if (mergeEvents[j + 1]!.performanceImpact - cur.performanceImpact >= window) break;
      j++;
    }
    if (j - i + 1 >= 3) {
      const group = mergeEvents.slice(i, j + 1);
      const sal = Math.min(1, Math.max(...group.map((g) => g.salience)) + 0.15);
      push('MERGE_STORM', group[0]!.performanceStart, group[group.length - 1]!.performanceImpact, group[group.length - 1]!.performanceEnd + 0.6, group.map((g) => g.subjectIds[0]!), sal, `${group.length} merges land as one phrase`, {
        historicalTime: group[0]!.historicalTime,
        variant: 'storm',
      });
      group.forEach((g, k) => (g.effectBudget = k === group.length - 1 ? 1 : 0.35));
    }
    i = j + 1;
  }

  // --- Parallel phrases: windows with ≥2 concurrently moving performers ---
  const performerEdges = edges.filter((e) => e.body === 'performer').sort((a, b) => a.start - b.start);
  const parallelRuns: Array<{ start: number; end: number; max: number; threads: Set<number> }> = [];
  {
    const step = 0.1;
    let run: (typeof parallelRuns)[number] | null = null;
    let ptr = 0;
    const open: EdgeGeom[] = [];
    for (let t = 0; t <= ctx.duration; t += step) {
      while (ptr < performerEdges.length && performerEdges[ptr]!.start <= t) open.push(performerEdges[ptr++]!);
      // Swap-remove, not splice: `open` is only ever counted over, so its order
      // carries no meaning, and splice shifts every element after the one it
      // drops. With tens of thousands of edges live at once that shifting was
      // the dominant cost of this scan.
      for (let k = open.length - 1; k >= 0; k--) {
        if (open[k]!.end < t) {
          open[k] = open[open.length - 1]!;
          open.pop();
        }
      }
      // Counted in place. The previous form built an intermediate array and a
      // mapped array before the Set, three allocations per step, and there are
      // `duration / 0.1` steps.
      const active = new Set<number>();
      for (const e of open) if (e.start <= t) active.add(e.threadIdx);
      if (active.size >= 2) {
        if (!run) run = { start: t, end: t, max: active.size, threads: new Set(active) };
        run.end = t;
        run.max = Math.max(run.max, active.size);
        active.forEach((a) => run!.threads.add(a));
      } else if (run && t - run.end > 0.6) {
        parallelRuns.push(run);
        run = null;
      }
    }
    if (run) parallelRuns.push(run);
  }
  for (const run of parallelRuns) {
    if (run.end - run.start < 0.4) continue;
    push('PARALLEL_PHRASE', run.start, run.start, run.end, [...run.threads].map((t) => threads[t]!.id), Math.min(1, 0.4 + run.max * 0.15), `${run.max} threads advance in parallel`, {
      provenance: 'derived',
      variant: run.max >= 4 ? 'chaos' : 'ensemble',
    });
  }

  // --- Eras ---
  ctx.eras.forEach((era, k) => {
    if (k === 0) return;
    const ev = push('ERA_TRANSITION', era.performanceStart - 0.5, era.performanceStart, era.performanceStart + 1.5, [era.id], 0.4 + era.intensity * 0.3, `${capitalize(era.label)} · from ${fmtMonth(era.historicalStart)}`, {
      historicalTime: era.historicalStart,
      provenance: 'derived',
      variant: era.label,
    });
    landmarks.push({ time: era.performanceStart, historicalTime: era.historicalStart, kind: 'era', label: era.label, nodeIdx: null, eventId: ev.id });
  });

  // --- Present ---
  const lastNode = nodes.length ? nodes.reduce((a, b) => (b.impact > a.impact ? b : a)) : null;
  const presentTime = ctx.duration - ctx.tail;
  const tips = threads.filter((t) => t.ending === 'tip').length;
  const present = push('REPO_PRESENT', presentTime, presentTime + 0.3, ctx.duration, lastNode ? [lastNode.sha] : [], 0.7, `Present day · ${tips} live tip${tips === 1 ? '' : 's'}${ctx.boundaryCount ? ` · ${ctx.boundaryCount} unloaded boundar${ctx.boundaryCount === 1 ? 'y' : 'ies'}` : ''}`, {
    historicalTime: lastNode ? hist(lastNode) : null,
  });
  landmarks.push({ time: presentTime, historicalTime: lastNode ? hist(lastNode) : 0, kind: 'present', label: 'present', nodeIdx: lastNode?.idx ?? null, eventId: present.id });

  events.sort((a, b) => a.performanceImpact - b.performanceImpact || a.performanceStart - b.performanceStart || (a.id < b.id ? -1 : 1));
  allocateEffectBudget(events);
  landmarks.sort((a, b) => a.time - b.time);

  const transcript = buildTranscript(events, ctx);
  return { events, landmarks, transcript };
}

/** Deterministic per-second budget: the most salient impacts keep full amplitude, the rest collapse to local pulses. */
function allocateEffectBudget(events: ChoreographyEvent[]) {
  const heavy = new Set<ChoreographyEventType>(['MERGE_IMPACT', 'MAJOR_MERGE', 'OCTOPUS_MERGE', 'DIVERGENCE', 'TAG_LANDMARK']);
  const windows = new Map<number, ChoreographyEvent[]>();
  for (const ev of events) {
    if (!heavy.has(ev.type)) continue;
    const w = Math.floor(ev.performanceImpact);
    const list = windows.get(w) ?? [];
    list.push(ev);
    windows.set(w, list);
  }
  for (const list of windows.values()) {
    list.sort((a, b) => b.salience - a.salience || (a.id < b.id ? -1 : 1));
    list.forEach((ev, i) => {
      const cap = i < 2 ? 1 : i < 4 ? 0.6 : 0.3;
      ev.effectBudget = Math.min(ev.effectBudget, cap);
    });
  }
}

function buildTranscript(events: ChoreographyEvent[], ctx: EventContext): string[] {
  const lines: string[] = [];
  const skip = new Set<ChoreographyEventType>(['COMMIT_STEP', 'MERGE_APPROACH', 'CONTRIBUTOR_ENTER', 'COMMIT_CLUSTER']);
  for (const ev of events) {
    if (skip.has(ev.type)) continue;
    const when = ev.historicalTime != null ? fmtDate(ev.historicalTime) : '';
    lines.push(`[${fmtClock(ev.performanceImpact)}] ${when ? when + ' — ' : ''}${ev.caption}`);
  }
  if (ctx.boundaryCount > 0) lines.push(`Coverage note: ${ctx.boundaryCount} commit${ctx.boundaryCount === 1 ? '' : 's'} have parents that were not loaded; earlier topology is not shown.`);
  return lines;
}

export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function r(v: number, p = 3): number {
  const m = Math.pow(10, p);
  return Math.round(v * m) / m;
}

export function provenanceLabel(p: Provenance): string {
  return { exact: 'exact', derived: 'derived', aggregate: 'aggregate', estimated: 'estimated', unknown: 'unknown' }[p];
}
