import { hash01 } from '@/model/prng';
import { flattenCubic, sCurve, type Pt } from './paths';

/**
 * Constrained layered layout adapted for animation (spec §18.2):
 *  - x is monotone in performance time (chronology never reverses);
 *  - the primary spine is pinned to a gently curving baseline;
 *  - threads take lanes above/below the spine, nested threads stay on the
 *    side of their base thread and further out;
 *  - a thread keeps its side and lane for its whole lifetime (no lane swaps);
 *  - side choice balances composition and is seeded/stable.
 */
export const LANE_GAP = 54;
/**
 * The most lanes a side of the spine will ever use. A project that merges a
 * pull request per change can have thousands of overlapping short-lived
 * threads; giving each its own lane pushes the graph tens of thousands of units
 * tall and the camera has no choice but to squash the whole thing into an
 * illegible band. Past this many, short threads share outer lanes instead.
 * Every edge is still drawn exactly; only the lane is reused.
 */
export const MAX_LANES = 12;
export const X_PER_SECOND = 96; // world units per natural second

export interface ThreadLayoutInput {
  idx: number;
  id: string;
  nodeIds: number[];
  baseId: number;
  mergeId: number;
  isSpine: boolean;
}

export interface ThreadLayout {
  side: number;
  lane: number;
  xStart: number;
  xEnd: number;
  bulge: number;
}

export interface LayoutResult {
  x: Float64Array;
  y: Float64Array;
  threads: ThreadLayout[];
  laneY: (threadIdx: number, x: number) => number;
  maxLane: number;
}

/**
 * The primary spine is a perfectly straight horizontal axis. Everything else
 * is placed relative to it, so the main line is unmistakable at any zoom and
 * chronology reads left to right without wobble.
 */
export function spineY(_x: number): number {
  return 0;
}

export function layoutGraph(threads: ThreadLayoutInput[], impact: Float64Array, xScale: number, seed: string): LayoutResult {
  const n = impact.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = impact[i]! * xScale;

  const layouts: ThreadLayout[] = threads.map(() => ({ side: 0, lane: 0, xStart: 0, xEnd: 0, bulge: 0 }));
  const threadOfNode = new Int32Array(n).fill(-1);
  threads.forEach((t) => t.nodeIds.forEach((id) => (threadOfNode[id] = t.idx)));

  /**
   * Which stretches of each lane are taken.
   *
   * Both questions asked of this — "is this span free?" and "how many lanes
   * are busy here?" — used to be a linear scan of every interval placed so
   * far, from inside a loop over every thread. That is quadratic, and it is
   * fine until it isn't: CPython's 12,022 threads pass unnoticed, Rust has
   * 107,048 merges and therefore about that many threads, and the layout stage
   * simply never returned.
   *
   * So each lane keeps its intervals ordered by start, alongside a running
   * maximum of the ends seen so far. A span overlaps something only if some
   * interval starting before it ends finishes after it starts — which is one
   * binary search and one comparison against that running maximum. The answers
   * are identical to the scan's; only the cost changes. Threads are visited in
   * order of their anchor, so `starts` is almost always already sorted and the
   * insert is an append.
   */
  interface Lane {
    starts: number[];
    ends: number[];
    /** `maxEnd[i]` is the largest end among intervals `0..i`. */
    maxEnd: number[];
  }
  const lanes = new Map<number, Lane>();
  const laneKey = (side: number, lane: number) => side * (MAX_LANES + 1) + lane;

  /** Does any interval in this lane overlap [s, e)? */
  const overlaps = (l: Lane, s: number, e: number): boolean => {
    // Intervals that could overlap are those starting strictly before `e`.
    let lo = 0;
    let hi = l.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (l.starts[mid]! < e) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return false;
    // Among those, an overlap exists exactly when one of them ends after `s`.
    return l.maxEnd[lo - 1]! > s;
  };

  const isFree = (side: number, lane: number, s: number, e: number) => {
    const l = lanes.get(laneKey(side, lane));
    return !l || !overlaps(l, s, e);
  };

  const occupy = (side: number, lane: number, s: number, e: number) => {
    const key = laneKey(side, lane);
    let l = lanes.get(key);
    if (!l) {
      l = { starts: [], ends: [], maxEnd: [] };
      lanes.set(key, l);
    }
    const last = l.starts.length - 1;
    if (last < 0 || s >= l.starts[last]!) {
      l.starts.push(s);
      l.ends.push(e);
      l.maxEnd.push(last < 0 ? e : Math.max(l.maxEnd[last]!, e));
      return;
    }
    // Out of order, which the anchor ordering makes rare. Insert and repair
    // the running maxima from that point on.
    let lo = 0;
    let hi = l.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (l.starts[mid]! <= s) lo = mid + 1;
      else hi = mid;
    }
    l.starts.splice(lo, 0, s);
    l.ends.splice(lo, 0, e);
    l.maxEnd.splice(lo, 0, 0);
    for (let i = lo; i < l.maxEnd.length; i++) l.maxEnd[i] = i === 0 ? l.ends[0]! : Math.max(l.maxEnd[i - 1]!, l.ends[i]!);
  };

  /** How many lanes on this side have work in progress at `at`. */
  const activeOnSide = (side: number, at: number) => {
    let count = 0;
    for (let lane = 0; lane <= MAX_LANES; lane++) {
      const l = lanes.get(laneKey(side, lane));
      // `[a, b]` containing `at` is `a <= at && b >= at`, which is the same
      // question as overlapping the degenerate span at `at` — with the
      // inclusive bounds the scan used.
      if (l && overlaps(l, at - 1e-9, at + 1e-9)) count++;
    }
    return count;
  };

  // A thread every commit of which was collapsed into a ribbon has no nodes to
  // place. It draws nothing, so it is ordered by whatever anchor it still has
  // and then skipped entirely: it takes no lane and reserves no interval, and
  // the composition is exactly what it would have been without the branch.
  const anchorX = (t: ThreadLayoutInput) =>
    t.baseId >= 0 ? x[t.baseId]! : t.nodeIds.length ? x[t.nodeIds[0]!]! : t.mergeId >= 0 ? x[t.mergeId]! : 0;
  const order = [...threads].sort((a, b) => anchorX(a) - anchorX(b) || a.idx - b.idx);
  const margin = 18;
  let maxLane = 0;

  for (const t of order) {
    const lay = layouts[t.idx]!;
    if (!t.nodeIds.length) continue;
    const first = t.nodeIds[0]!;
    const last = t.nodeIds[t.nodeIds.length - 1]!;
    lay.xStart = t.baseId >= 0 ? x[t.baseId]! : x[first]! - 40;
    lay.xEnd = t.mergeId >= 0 ? x[t.mergeId]! : x[last]! + 48;
    if (t.isSpine) {
      lay.side = 0;
      lay.lane = 0;
      continue;
    }
    const baseThread = t.baseId >= 0 ? threadOfNode[t.baseId]! : -1;
    const baseLay = baseThread >= 0 ? layouts[baseThread]! : null;
    let side: number;
    let minLane: number;
    if (baseLay && baseLay.side !== 0) {
      side = baseLay.side;
      minLane = baseLay.lane + 1;
    } else {
      const up = activeOnSide(-1, lay.xStart);
      const down = activeOnSide(1, lay.xStart);
      if (up === down) side = hash01(`${seed}:side:${t.id}`) < 0.5 ? -1 : 1;
      else side = up < down ? -1 : 1;
      minLane = 1;
    }
    let lane = minLane;
    while (lane < MAX_LANES && !isFree(side, lane, lay.xStart - margin, lay.xEnd + margin)) lane++;
    if (lane >= MAX_LANES) {
      // Everything is busy: take a deterministic outer lane and accept that a
      // very dense era looks dense.
      lane = minLane + (Math.floor(hash01(`${seed}:lane:${t.id}`) * (MAX_LANES - minLane)) % Math.max(1, MAX_LANES - minLane));
    }
    lay.side = side;
    lay.lane = lane;
    occupy(side, lane, lay.xStart - margin, lay.xEnd + margin);
    maxLane = Math.max(maxLane, lane);
    const len = lay.xEnd - lay.xStart;
    lay.bulge = Math.min(LANE_GAP * 0.22, len / 60);
  }

  const laneY = (threadIdx: number, px: number): number => {
    const lay = layouts[threadIdx]!;
    if (lay.side === 0) return spineY(px);
    const span = Math.max(1, lay.xEnd - lay.xStart);
    const u = Math.max(0, Math.min(1, (px - lay.xStart) / span));
    const bulge = lay.bulge * Math.sin(Math.PI * u);
    return spineY(px) + lay.side * (lay.lane * LANE_GAP + bulge);
  };

  for (const t of threads) for (const id of t.nodeIds) y[id] = laneY(t.idx, x[id]!);

  return { x, y, threads: layouts, laneY, maxLane };
}

/** Polyline that follows a lane curve between two x positions. */
export function routeAlongLane(laneY: (x: number) => number, x0: number, x1: number, spacing = 6): { pts: Float32Array; length: number } {
  const span = Math.max(0.001, x1 - x0);
  const count = Math.max(2, Math.min(200, Math.ceil(span / spacing) + 1));
  const pts = new Float32Array(count * 2);
  let length = 0;
  for (let i = 0; i < count; i++) {
    const px = x0 + (span * i) / (count - 1);
    pts[i * 2] = px;
    pts[i * 2 + 1] = laneY(px);
    if (i > 0) length += Math.hypot(pts[i * 2]! - pts[i * 2 - 2]!, pts[i * 2 + 1]! - pts[i * 2 - 1]!);
  }
  return { pts, length };
}

/** Peel / swoop between two nodes: horizontal tangents, bounded curvature. */
export function routeCurve(a: Pt, b: Pt, kind: 'divergence' | 'merge' | 'secondary'): { pts: Float32Array; length: number } {
  const dx = b.x - a.x;
  const dy = Math.abs(b.y - a.y);
  if (kind === 'secondary' && dy < 1) {
    // same lane (e.g. criss-cross within a lane): a shallow arc so it does not hide under the thread edge
    const lift = Math.min(22, Math.max(10, dx * 0.12));
    const c1 = { x: a.x + dx * 0.3, y: a.y - lift };
    const c2 = { x: b.x - dx * 0.3, y: b.y - lift };
    return flattenCubic(a, c1, c2, b);
  }
  const tension = kind === 'merge' ? 0.55 : 0.45;
  return sCurve(a, b, tension);
}
