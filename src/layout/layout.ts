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

  // Intervals per side/lane that are occupied: side → lane → [start,end][]
  const occupied: Map<string, Array<[number, number]>> = new Map();
  const isFree = (side: number, lane: number, s: number, e: number) => {
    const list = occupied.get(`${side}:${lane}`);
    if (!list) return true;
    return !list.some(([a, b]) => s < b && e > a);
  };
  const occupy = (side: number, lane: number, s: number, e: number) => {
    const key = `${side}:${lane}`;
    const list = occupied.get(key) ?? [];
    list.push([s, e]);
    occupied.set(key, list);
  };
  const activeOnSide = (side: number, at: number) => {
    let count = 0;
    for (const [key, list] of occupied) {
      if (!key.startsWith(`${side}:`)) continue;
      if (list.some(([a, b]) => at >= a && at <= b)) count++;
    }
    return count;
  };

  const order = [...threads].sort((a, b) => {
    const xa = a.baseId >= 0 ? x[a.baseId]! : x[a.nodeIds[0]!]!;
    const xb = b.baseId >= 0 ? x[b.baseId]! : x[b.nodeIds[0]!]!;
    return xa - xb || a.idx - b.idx;
  });
  const margin = 18;
  let maxLane = 0;

  for (const t of order) {
    const lay = layouts[t.idx]!;
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
    while (!isFree(side, lane, lay.xStart - margin, lay.xEnd + margin)) lane++;
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
