import type { AggregateSpan, CommitNode } from '@/model/types';
import type { GraphIndex } from '@/dag/graph';

/**
 * Topology-preserving aggregation (spec §15.1).
 *
 * Two things collapse into counted ribbons, and both keep their entry and exit
 * commits exact so every edge that leaves the collapsed set still has a real
 * node to land on:
 *
 *  - **plain linear runs** inside a thread — one known parent, one child, no
 *    refs, not a junction;
 *  - **stretches of the primary spine** whose merges are all *pull-request
 *    bubbles*: a branch that left the spine, carried at most `SIDE_MAX` plain
 *    commits, and was merged back with nothing else hanging off it.
 *
 * Junctions with real side history, octopus and criss-cross merges, roots,
 * boundaries and ref targets are protected and never disappear.
 *
 * The amount of aggregation is driven by a *visible budget*: the number of
 * nodes the performance can land inside its target duration while still giving
 * each one a legible beat. A ten-thousand-commit repository therefore becomes a
 * show of the same length as a small one, told through ribbons instead of a
 * five-minute queue of identical dots.
 *
 * The spine rule exists because the linear rule alone cannot help a
 * pull-request project. Aggregation refused to touch junctions, and in a
 * repository that merges a branch for every change nearly every commit is a
 * junction or next to one: measured on rust-lang/mdBook, 2,581 of its 3,293
 * commits stayed on stage and the show ran 11.3 minutes. Collapsing the
 * *repeated shape* rather than the individual commit brings that to 1,207
 * commits and 5.3 minutes, and public-apis' 2021 from 1,587 and 6.9 minutes to
 * 1,171 and 5.1.
 *
 * What is left is history no ribbon can honestly stand for. Measured over the
 * same two, a third of the branch-and-merge-back merges left the spine well
 * before the commit they were merged onto — public-apis' median is sixteen
 * commits back, and its worst is 888 — and a ribbon can only hide a branch
 * point if it also hides the branch, so those windows stay open and those
 * merges stay on stage.
 */
export interface AggregationResult {
  spans: AggregateSpan[];
  /** Aggregate index per node id, or -1. Boundary (entry/exit) nodes stay -1. */
  aggregateOf: Int32Array;
  /** Shortest run length that was collapsed (diagnostics). */
  collapsedFrom: number;
}

/**
 * The most commits a side branch may carry and still count as a bubble.
 *
 * This is the shape a merge button produces: branch off the main line, one or
 * two commits, merge back. Measured over mdBook's whole history, 825 of its
 * 881 branch-and-merge-back merges carry three commits or fewer. Past that a
 * branch plausibly has a story of its own, which the viewer should see rather
 * than have summarized.
 */
export const SIDE_MAX = 3;

/**
 * How far past its last legal exit a spine window will keep looking for one.
 *
 * A branch that left the spine inside the window has to be absorbed by it, or
 * the ribbon would hide the branch point and leave the branch dangling — so a
 * stale pull request can force the window to grow. This bounds that chase, and
 * with it the work per window; it is not a rule about shape.
 */
const CHASE_MAX = 512;

export interface AggregationInput {
  g: GraphIndex;
  commits: CommitNode[];
  /** Thread index → commit ids, oldest → newest. */
  members: number[][];
  /** Thread index per commit id. */
  threadOf: Int32Array;
  /** Commits that must stay exact: junctions, roots, boundaries, refs, thread ends. */
  protectedIds: Uint8Array;
  /** Commits a branch or tag points at — the one protection a bubble may never override. */
  refTargets: Uint8Array;
  /** The primary spine, oldest → newest (a first-parent chain). */
  spine: number[];
  presentation: Float64Array;
  contributorOf: Int32Array;
  contributorIds: string[];
  visibleBudget: number;
  minRun?: number;
}

/** What a spine commit can be when a stretch of the spine collapses. */
const BLOCKED = 0;
const PLAIN = 1;
const BUBBLE = 2;

interface SpineScan {
  spine: number[];
  /** `BLOCKED`, `PLAIN` or `BUBBLE` per spine index. */
  kind: Uint8Array;
  /** Spine index the commit's side branch left from (`i - 1` when there is none). */
  base: Int32Array;
  /**
   * Smallest exit index that absorbs every branch which left this commit, or
   * -1 when something else hangs off it and it can never be hidden.
   */
  absorb: Int32Array;
  /** Side-branch commits per spine index, oldest → newest. Empty unless `BUBBLE`. */
  sides: number[][];
}

/** One collapsible stretch: `[entry, exit]` stay exact, `members` become a ribbon. */
interface SpineWindow {
  entry: number;
  exit: number;
  members: number[];
}

type Candidate =
  | { kind: 'run'; threadIdx: number; at: number; collapsible: number; entry: number; exit: number; inner: number[] }
  | { kind: 'window'; threadIdx: number; at: number; collapsible: number; window: SpineWindow };

export function aggregateHistory(input: AggregationInput): AggregationResult {
  const { g, commits, members, threadOf, protectedIds, presentation, contributorOf, contributorIds, visibleBudget } = input;
  const minRun = input.minRun ?? 3;
  const n = commits.length;
  const aggregateOf = new Int32Array(n).fill(-1);
  const spans: AggregateSpan[] = [];
  if (n <= visibleBudget) return { spans, aggregateOf, collapsedFrom: Infinity };

  // 1. The spine first. Its stretches are what a pull-request history is made
  //    of, and the widest ones say how much it could ever give up — which is
  //    what the chunk size below is worked out from.
  const scan = scanSpine(input);
  const spineThread = scan.spine.length ? threadOf[scan.spine[0]!]! : -1;
  const claimed = new Uint8Array(n);
  let spineCollapsible = 0;
  for (const w of spineWindows(scan, Infinity)) {
    spineCollapsible += w.members.length;
    for (const id of w.members) claimed[id] = 1;
  }

  const plain = (id: number) =>
    !protectedIds[id] &&
    !claimed[id] &&
    g.parents[id]!.length === 1 &&
    commits[id]!.parentShas.length === 1 &&
    g.children[id]!.length === 1;

  // 2. Every collapsible plain run on the other threads, keeping its exact
  //    boundaries.
  //
  // A run's boundaries are the *protected* commits on either side of it — the
  // junction it came from and the one it leads to — rather than the first and
  // last plain commit. That lets every plain commit in the middle collapse
  // while both junctions stay exact, which matters enormously in a repository
  // that merges a pull request for every change: there, almost nothing is a
  // long linear stretch, and boundaries drawn any tighter collapse nothing.
  //
  // The spine is skipped here because the window scan above already covers it,
  // and two ribbons cannot share a commit.
  const candidates: Candidate[] = [];
  members.forEach((ids, threadIdx) => {
    if (threadIdx === spineThread) return;
    let i = 0;
    while (i < ids.length) {
      if (!plain(ids[i]!)) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < ids.length && plain(ids[j + 1]!) && g.firstParent[ids[j + 1]!] === ids[j]!) j++;
      const hasEntry = i > 0;
      const hasExit = j + 1 < ids.length;
      const entry = hasEntry ? ids[i - 1]! : ids[i]!;
      const exit = hasExit ? ids[j + 1]! : ids[j]!;
      const inner = ids.slice(hasEntry ? i : i + 1, hasExit ? j + 1 : j);
      if (inner.length >= minRun - 2 && inner.length > 0) {
        candidates.push({ kind: 'run', threadIdx, at: presentation[entry]!, collapsible: inner.length, entry, exit, inner });
      }
      i = j + 1;
    }
  });
  const collapsible = spineCollapsible + candidates.reduce((sum, c) => sum + c.collapsible, 0);
  if (!collapsible) return { spans, aggregateOf, collapsedFrom: Infinity };

  // 3. Aim *at* the budget rather than merely under it.
  //
  // Collapsing a run whole satisfies any budget, which is how a scoped fetch of
  // a nearly linear year turned two thousand commits into two ribbons and a
  // nine-second show. Instead, long runs are cut into chunks with a real commit
  // kept between each, so the visible count lands near the budget and the
  // ribbons each stand for a comparable amount of work. One chunk size serves
  // both shapes, so similar runs are always treated alike.
  const fixed = n - collapsible; // commits that can never be collapsed
  const ribbonsAffordable = Math.max(1, visibleBudget - fixed);
  const chunk = Math.max(2, Math.ceil(collapsible / ribbonsAffordable));

  for (const w of spineWindows(scan, chunk)) {
    candidates.push({ kind: 'window', threadIdx: spineThread, at: presentation[w.entry]!, collapsible: w.members.length, window: w });
  }

  // 4. Materialize, in a stable order.
  const ordered = [...candidates].sort((a, b) => a.at - b.at || (g.shas[entryOf(a)]! < g.shas[entryOf(b)]! ? -1 : 1));
  const emit = (threadIdx: number, segment: number[], entry: number, exit: number) => {
    // A ribbon has to be able to stand in for exactly what it hides: everything
    // its members touch must be another member or one of the two boundaries, or
    // an edge would simply go undrawn. Checked here, at the one place a span is
    // created, rather than trusted from the shape that produced it.
    if (!enclosed(g, commits, segment, entry, exit)) return;
    const contributors = new Set<string>();
    let mergeCount = 0;
    for (const id of segment) {
      contributors.add(contributorIds[contributorOf[id]!]!);
      if (commits[id]!.parentShas.length > 1) mergeCount++;
    }
    const idx = spans.length;
    for (const id of segment) aggregateOf[id] = idx;
    spans.push({
      id: `agg-${threadIdx}-${idx}`,
      memberShas: segment.map((id) => g.shas[id]!),
      memberCount: segment.length,
      mergeCount,
      boundaryShas: [g.shas[entry]!, g.shas[exit]!],
      historicalStart: presentation[segment[0]!]!,
      historicalEnd: presentation[segment[segment.length - 1]!]!,
      level: 1,
      expandable: true,
      contributorIds: [...contributors].sort(),
      provenance: 'aggregate',
    });
  };

  for (const c of ordered) {
    if (c.kind === 'window') {
      const seg = [...c.window.members].sort((a, b) => presentation[a]! - presentation[b]! || (g.shas[a]! < g.shas[b]! ? -1 : 1));
      emit(c.threadIdx, seg, c.window.entry, c.window.exit);
      continue;
    }
    const seq = [c.entry, ...c.inner, c.exit];
    let kept = 0;
    while (kept < seq.length - 1) {
      const remaining = seq.length - 1 - kept;
      const take = Math.min(chunk, remaining - 1);
      if (take < 2) break; // a ribbon standing for one commit is worse than the commit
      const nextKept = kept + 1 + take;
      emit(c.threadIdx, seq.slice(kept + 1, kept + 1 + take), seq[kept]!, seq[nextKept]!);
      kept = nextKept;
    }
  }
  return { spans, aggregateOf, collapsedFrom: spans.length ? chunk : Infinity };
}

function entryOf(c: Candidate): number {
  return c.kind === 'run' ? c.entry : c.window.entry;
}

/**
 * Classify every commit on the primary spine: whether it could be hidden at
 * all, where its side branch left from, and what has to be swallowed with it.
 */
function scanSpine(input: AggregationInput): SpineScan {
  const { g, commits, refTargets, spine } = input;
  const m = spine.length;
  const kind = new Uint8Array(m);
  const base = new Int32Array(m).fill(-1);
  const absorb = new Int32Array(m).fill(-1);
  const sides: number[][] = Array.from({ length: m }, () => []);
  const spineIdx = new Map<number, number>();
  spine.forEach((id, i) => spineIdx.set(id, i));
  /** Side-branch head → the spine index of the merge that absorbed it. */
  const headOf = new Map<number, number>();

  for (let i = 1; i < m; i++) {
    const id = spine[i]!;
    const c = commits[id]!;
    if (c.flags.isBoundary || refTargets[id] || g.firstParent[id] !== spine[i - 1]!) continue; // BLOCKED
    if (c.parentShas.length === 1 && g.parents[id]!.length === 1) {
      kind[i] = PLAIN;
      base[i] = i - 1;
      continue;
    }
    if (c.parentShas.length !== 2 || g.parents[id]!.length !== 2 || g.parentSlots[id]![1] !== 1) continue; // octopus, or a parent outside the window
    // Walk the second-parent chain back to the spine. Every commit on it must
    // be plain and unlabelled: a ribbon may hide routine work, never a branch
    // anyone can name or point at.
    const side: number[] = [];
    let cur = g.parents[id]![1]!;
    let from = -1;
    for (;;) {
      if (side.length >= SIDE_MAX) break; // a branch with a story of its own
      const sc = commits[cur]!;
      if (spineIdx.has(cur) || sc.parentShas.length !== 1 || g.parents[cur]!.length !== 1) break;
      if (sc.flags.isBoundary || refTargets[cur] || g.children[cur]!.length !== 1) break;
      side.push(cur);
      const p = g.firstParent[cur]!;
      const pi = spineIdx.get(p);
      if (pi !== undefined) {
        from = pi;
        break;
      }
      if (p < 0) break; // the branch does not come back to the spine
      cur = p;
    }
    if (from < 0 || from >= i) continue; // BLOCKED
    side.reverse(); // oldest → newest, so `side[0]` is where the branch left
    kind[i] = BUBBLE;
    base[i] = from;
    sides[i] = side;
    headOf.set(side[0]!, i);
  }

  // What each commit owes: its own successor, plus every branch that left it.
  // Anything else among its children — a long-lived branch, an unmerged tip,
  // a merge that reaches back to it — means it can never be inside a ribbon.
  for (let i = 0; i < m; i++) {
    let need = i + 1;
    let ok = true;
    for (const ch of g.children[spine[i]!]!) {
      if (i + 1 < m && ch === spine[i + 1]!) continue;
      const owner = headOf.get(ch);
      if (owner !== undefined && base[owner]! === i) {
        need = Math.max(need, owner);
        continue;
      }
      ok = false;
      break;
    }
    absorb[i] = ok ? need : -1;
  }
  return { spine, kind, base, absorb, sides };
}

/**
 * The stretches of the spine that can be collapsed, cut so each ribbon carries
 * about `chunk` commits.
 *
 * A window runs from one exact commit to another. Everything between them is
 * hidden, so everything between them has to be hideable: a plain commit or a
 * bubble merge, with its branch point inside the window and every branch that
 * left it absorbed by the window's end. The exit itself is under no such
 * obligation — it stays on stage, so a criss-cross, an octopus or a tagged
 * release is a perfectly good place to stop, which is what lets a ribbon reach
 * all the way up to the next real landmark.
 */
function spineWindows(scan: SpineScan, chunk: number): SpineWindow[] {
  const { spine, kind, base, absorb, sides } = scan;
  const m = spine.length;
  const out: SpineWindow[] = [];
  let a = 0;
  while (a + 1 < m) {
    /** The exit keeps its own branch only when that branch left inside the window. */
    const exitSide = (i: number) => (kind[i] === BUBBLE && base[i]! >= a ? sides[i]!.length : 0);
    const canHide = (i: number) => kind[i] !== BLOCKED && base[i]! >= a && absorb[i]! >= 0;
    let z = a + 1;
    let size = exitSide(z);
    let need = a + 1; // no interior yet, so the window is already legal
    let best = z;
    let bestSize = size;
    for (;;) {
      if (need <= z && size >= chunk) break;
      if (z + 1 >= m || !canHide(z)) break;
      need = Math.max(need, absorb[z]!);
      z++;
      size += 1 + exitSide(z);
      if (need <= z) {
        best = z;
        bestSize = size;
      }
      if (z - best > CHASE_MAX) break; // chasing a stale branch; take the last legal exit
    }
    if (bestSize >= 2) {
      // A ribbon standing for one commit is worse than the commit.
      const items: number[] = [];
      for (let i = a + 1; i <= best; i++) {
        if (i < best) items.push(spine[i]!);
        if (i < best || exitSide(i)) for (const s of sides[i]!) items.push(s);
      }
      out.push({ entry: spine[a]!, exit: spine[best]!, members: items });
    }
    a = best;
  }
  return out;
}

/**
 * Whether `segment` touches nothing outside itself but its two boundaries, and
 * hides no unloaded history. A ribbon over anything else would drop an edge.
 */
function enclosed(g: GraphIndex, commits: CommitNode[], segment: number[], entry: number, exit: number): boolean {
  if (!segment.length || segment.includes(entry) || segment.includes(exit)) return false;
  const inside = new Set(segment);
  for (const id of segment) {
    if (commits[id]!.parentShas.length !== g.parents[id]!.length || commits[id]!.flags.isBoundary) return false;
    for (const p of g.parents[id]!) if (!inside.has(p) && p !== entry) return false;
    for (const ch of g.children[id]!) if (!inside.has(ch) && ch !== exit) return false;
  }
  return true;
}

/**
 * What a ribbon says it holds. Merges are named because a run of pull requests
 * is a run of *changes that landed*, and "74 commits" alone would hide the
 * shape of how they landed. The structure is what Git proves — a branch that
 * left the spine and was merged back — so that is what the caption claims,
 * whether or not a pull request was involved.
 */
export function describeAggregate(agg: AggregateSpan): string {
  const commits = `${agg.memberCount} commit${agg.memberCount === 1 ? '' : 's'}`;
  if (agg.mergeCount <= 0) return commits;
  return `${agg.mergeCount} merged branch${agg.mergeCount === 1 ? '' : 'es'} · ${commits}`;
}
