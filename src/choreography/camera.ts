import type { CameraCue, CameraState, ChoreographyEvent, EdgeGeom, NodeGeom } from '@/model/types';
import { pointAt } from '@/layout/paths';

/**
 * Camera director (spec §12). Shots are planned at compile time from the
 * precomputed geometry and future events, then smoothed with a critically
 * damped spring so the camera anticipates rather than chases.
 *
 * States: intimate → split → ensemble → overview → convergence → impact →
 * release → tableau. Junctions in a split/merge window are never cropped.
 */
export interface CameraPlanInput {
  nodes: NodeGeom[];
  edges: EdgeGeom[];
  events: ChoreographyEvent[];
  duration: number;
  tail: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  reducedMotion: boolean;
}

export const CAMERA_STEP = 0.05;
const LOOK_AHEAD = 1.15;
const MERGE_ANTICIPATION = 2.6;

export function planCamera(input: CameraPlanInput): CameraCue[] {
  const { nodes, edges, events, duration, reducedMotion } = input;
  const cues: CameraCue[] = [];
  const steps = Math.ceil(duration / CAMERA_STEP) + 1;

  const merges = events.filter((e) => e.type === 'MERGE_IMPACT' || e.type === 'MAJOR_MERGE' || e.type === 'OCTOPUS_MERGE');
  const splits = events.filter((e) => e.type === 'DIVERGENCE');
  const eras = events.filter((e) => e.type === 'ERA_TRANSITION');
  const nodeBySha = new Map<string, NodeGeom>();
  for (const nd of nodes) nodeBySha.set(nd.sha, nd);
  const sortedEdges = [...edges].sort((a, b) => a.start - b.start);
  const spineNodes = nodes.filter((nd) => nd.isSpine).sort((a, b) => a.impact - b.impact);

  // Dolly track: world x as a function of performance time. Because x is derived
  // from the natural clock, this is very nearly linear, which is what gives the
  // performance its timelapse glide instead of a camera that chases each body.
  const track = [...nodes].sort((a, b) => a.impact - b.impact || a.x - b.x);
  const dollyAt = (time: number): number => {
    if (!track.length) return 0;
    if (time <= track[0]!.impact) return track[0]!.x;
    const last = track[track.length - 1]!;
    if (time >= last.impact) return last.x + (time - last.impact) * 40;
    let lo = 0;
    let hi = track.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (track[mid]!.impact <= time) lo = mid;
      else hi = mid;
    }
    const a = track[lo]!;
    const b = track[hi]!;
    const span = b.impact - a.impact;
    return span > 0 ? a.x + ((b.x - a.x) * (time - a.impact)) / span : a.x;
  };

  // Spring state (center + log extents).
  const first = spineNodes[0] ?? nodes[0];
  let cx = first ? first.x : 0;
  let cy = first ? first.y : 0;
  let lw = Math.log(360);
  let lh = Math.log(220);
  let vx = 0, vy = 0, vw = 0, vh = 0;
  let lastState: CameraState = 'intimate';

  let edgePtr = 0;
  const open: EdgeGeom[] = [];
  let mergePtr = 0;
  let splitPtr = 0;
  let spinePtr = 0;
  const tmp = { x: 0, y: 0 };

  for (let s = 0; s < steps; s++) {
    const t = s * CAMERA_STEP;
    // maintain the set of edges that are or will shortly be active
    while (edgePtr < sortedEdges.length && sortedEdges[edgePtr]!.start <= t + LOOK_AHEAD) open.push(sortedEdges[edgePtr++]!);
    for (let i = open.length - 1; i >= 0; i--) if (open[i]!.end < t - 0.05) open.splice(i, 1);
    while (mergePtr < merges.length && merges[mergePtr]!.performanceEnd + 1.6 < t) mergePtr++;
    while (splitPtr < splits.length && splits[splitPtr]!.performanceImpact + 1.2 < t) splitPtr++;
    while (spinePtr + 1 < spineNodes.length && spineNodes[spinePtr + 1]!.impact <= t) spinePtr++;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const include = (x: number, y: number) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    const threadsActive = new Set<number>();
    for (const e of open) {
      if (e.start <= t && e.end >= t) {
        const u = (t - e.start) / Math.max(1e-6, e.end - e.start);
        pointAt(e.pts, u, tmp);
        include(tmp.x, tmp.y);
        if (e.body === 'performer') threadsActive.add(e.threadIdx);
      }
      // near-future position, so the frame leads the movement
      const ahead = Math.min(e.end, t + LOOK_AHEAD);
      if (ahead >= e.start) {
        const u2 = (ahead - e.start) / Math.max(1e-6, e.end - e.start);
        pointAt(e.pts, u2, tmp);
        include(tmp.x, tmp.y);
      }
    }
    // The primary spine is the anchor: keep its newest landed node in frame.
    const anchor = spineNodes[spinePtr];
    if (anchor && anchor.impact <= t) include(anchor.x, anchor.y);
    if (!Number.isFinite(minX) && anchor) include(anchor.x, anchor.y);

    let state: CameraState = threadsActive.size >= 4 ? 'overview' : threadsActive.size >= 2 ? 'ensemble' : 'intimate';
    let reason: string | null = null;
    let punchTarget = 1;
    let roll = 0;

    // Divergence windows: keep the exact junction and both trajectories.
    for (let i = splitPtr; i < splits.length; i++) {
      const ev = splits[i]!;
      if (ev.performanceStart > t + 0.6) break;
      if (t >= ev.performanceStart - 0.4 && t <= ev.performanceImpact + 1.2) {
        for (const sha of ev.subjectIds) {
          const nd = nodeBySha.get(sha);
          if (nd) include(nd.x, nd.y);
        }
        if (state === 'intimate') state = 'split';
        reason = ev.id;
        punchTarget = Math.min(punchTarget, reducedMotion ? 1 : 0.94); // slight pull back
      }
    }
    // Merge anticipation, impact and release.
    for (let i = mergePtr; i < merges.length; i++) {
      const ev = merges[i]!;
      if (ev.performanceImpact - MERGE_ANTICIPATION > t) break;
      const dt = ev.performanceImpact - t;
      if (dt > -1.6 && dt < MERGE_ANTICIPATION) {
        for (const sha of ev.subjectIds) {
          const nd = nodeBySha.get(sha);
          if (nd) include(nd.x, nd.y);
        }
        reason = ev.id;
        const sal = ev.salience * ev.effectBudget;
        if (dt > 0.15) {
          // A neighbouring merge's approach must not demote the hit we are on.
          if (state !== 'overview' && state !== 'impact') state = 'convergence';
        } else if (dt > -0.2) {
          state = 'impact';
          if (!reducedMotion) {
            const k = 1 - Math.min(1, Math.abs(dt) / 0.2);
            punchTarget = Math.max(punchTarget, 1 + 0.16 * sal * k);
            roll = 0.012 * sal * Math.sin(k * Math.PI);
          }
        } else {
          if (state !== 'impact') state = 'release';
          if (!reducedMotion) punchTarget = Math.max(punchTarget, 1 + 0.16 * sal * Math.max(0, 1 - (-dt - 0.2) / 1.4));
        }
      }
    }

    const inTail = t >= duration - input.tail;
    if (inTail) {
      state = 'tableau';
      minX = input.bounds.minX;
      maxX = input.bounds.maxX;
      minY = input.bounds.minY;
      maxY = input.bounds.maxY;
    }

    // As the history accumulates the frame opens up, so the viewer watches the
    // shape being built rather than a fixed-size window sliding along forever.
    // This is the difference between a timelapse and a treadmill.
    const progress = Math.max(0, Math.min(1, t / Math.max(1, duration - input.tail)));
    const growth = 1 + Math.pow(progress, 0.8) * 1.15;

    // Era changes get a brief reframe of their own, so the composition keeps
    // changing even through long stretches of similar work.
    let eraWiden = 1;
    for (const ev of eras) {
      const dt = t - ev.performanceImpact;
      if (dt >= -0.5 && dt < 2.4) eraWiden = Math.max(eraWiden, 1 + 0.22 * (1 - Math.abs(dt - 0.9) / 1.5));
    }

    // Desired frame with state-dependent breathing room.
    const padX = state === 'intimate' ? 120 : state === 'overview' ? 180 : 140;
    const padY = state === 'intimate' ? 90 : state === 'overview' ? 130 : 110;
    const minW = state === 'intimate' ? 420 : state === 'overview' ? 720 : 560;
    const minH = state === 'intimate' ? 230 : state === 'overview' ? 380 : 300;
    let tw = Math.max(minW * growth * eraWiden, maxX - minX + padX * 2);
    let th = Math.max(minH * (1 + (growth - 1) * 0.55) * eraWiden, maxY - minY + padY * 2);
    if (inTail) {
      tw = Math.max(minW, (maxX - minX) * 1.12 + 80);
      th = Math.max(minH, (maxY - minY) * 1.25 + 80);
    }
    // Horizontal: ride the dolly track, nudged only enough to keep the action framed.
    const dolly = dollyAt(t) + tw * 0.06;
    const bboxCentre = (minX + maxX) / 2;
    const tx = inTail ? bboxCentre : dolly + Math.max(-tw * 0.18, Math.min(tw * 0.18, bboxCentre - dolly)) * 0.35;
    // Vertical: the straight spine is the centre line of the stage, full stop.
    // Threads spreading unevenly widen the frame instead of pushing main off-centre.
    const ty = inTail ? (minY + maxY) / 2 : 0;

    // Critically damped springs. The centre tracks briskly; the zoom breathes more
    // slowly so the frame does not pump on every passing thread.
    const period = reducedMotion ? 2.6 : state === 'impact' ? 0.55 : state === 'convergence' ? 0.9 : inTail ? 2.2 : 1.15;
    const zoomPeriod = reducedMotion ? 3.2 : state === 'impact' ? 0.8 : inTail ? 2.4 : 2;
    const spring = (pos: number, vel: number, target: number, p: number): [number, number] => {
      const w0 = (2 * Math.PI) / p;
      const acc = w0 * w0 * (target - pos) - 2 * w0 * vel;
      const v = vel + acc * CAMERA_STEP;
      return [pos + v * CAMERA_STEP, v];
    };
    [cx, vx] = spring(cx, vx, tx, period);
    [cy, vy] = spring(cy, vy, ty, period);
    [lw, vw] = spring(lw, vw, Math.log(tw), zoomPeriod);
    [lh, vh] = spring(lh, vh, Math.log(th), zoomPeriod);

    // Never crop a live junction: expand the smoothed frame if a must-include point escaped it.
    if (Number.isFinite(minX) && !inTail) {
      const w = Math.exp(lw);
      const h = Math.exp(lh);
      const needW = Math.max(maxX - cx, cx - minX) * 2 + padX * 0.8;
      const needH = Math.max(maxY - cy, cy - minY) * 2 + padY * 0.8;
      if (needW > w) lw = Math.log(needW);
      if (needH > h) lh = Math.log(needH);
    }

    cues.push({
      time: t,
      x: round(cx),
      y: round(cy),
      w: round(Math.exp(lw)),
      h: round(Math.exp(lh)),
      rotation: round(roll, 5),
      punch: round(punchTarget, 4),
      reasonEventId: reason,
      state,
    });
    lastState = state;
  }
  void lastState;
  return cues;
}

function round(v: number, p = 2): number {
  const m = Math.pow(10, p);
  return Math.round(v * m) / m;
}

/** Sample the cue list at time t (linear between cues; punch smoothed by the renderer). */
export function sampleCamera(cues: CameraCue[], t: number): CameraCue {
  if (!cues.length) return { time: t, x: 0, y: 0, w: 600, h: 400, rotation: 0, punch: 1, reasonEventId: null, state: 'intimate' };
  const f = Math.max(0, Math.min(cues.length - 1, t / CAMERA_STEP));
  const i = Math.floor(f);
  const a = cues[i]!;
  const b = cues[Math.min(cues.length - 1, i + 1)]!;
  const k = f - i;
  return {
    time: t,
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    w: a.w + (b.w - a.w) * k,
    h: a.h + (b.h - a.h) * k,
    rotation: a.rotation + (b.rotation - a.rotation) * k,
    punch: a.punch + (b.punch - a.punch) * k,
    reasonEventId: k < 0.5 ? a.reasonEventId : b.reasonEventId,
    state: k < 0.5 ? a.state : b.state,
  };
}
