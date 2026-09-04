/** Deterministic spline helpers: cubic Béziers flattened at uniform arc length. */

export interface Pt {
  x: number;
  y: number;
}

export function cubicPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/**
 * Flatten a cubic into a polyline whose samples are (nearly) uniform in arc
 * length so bodies travel at constant speed. Returns flattened [x,y,...] and length.
 */
export function flattenCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, spacing = 6): { pts: Float32Array; length: number } {
  const coarse: Pt[] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) coarse.push(cubicPoint(p0, p1, p2, p3, i / steps));
  const cum = new Float64Array(coarse.length);
  for (let i = 1; i < coarse.length; i++) {
    const a = coarse[i - 1]!;
    const b = coarse[i]!;
    cum[i] = cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const length = cum[coarse.length - 1]!;
  const count = Math.max(2, Math.min(220, Math.ceil(length / spacing) + 1));
  const pts = new Float32Array(count * 2);
  let seg = 1;
  for (let i = 0; i < count; i++) {
    const target = (length * i) / (count - 1);
    while (seg < coarse.length - 1 && cum[seg]! < target) seg++;
    const a = coarse[seg - 1]!;
    const b = coarse[seg]!;
    const span = cum[seg]! - cum[seg - 1]!;
    const f = span > 0 ? (target - cum[seg - 1]!) / span : 0;
    pts[i * 2] = a.x + (b.x - a.x) * f;
    pts[i * 2 + 1] = a.y + (b.y - a.y) * f;
  }
  return { pts, length };
}

/** Point at normalized position u∈[0,1] along a uniformly sampled polyline. */
export function pointAt(pts: Float32Array, u: number, out: Pt = { x: 0, y: 0 }): Pt {
  const count = pts.length >> 1;
  if (count === 0) return out;
  if (count === 1) {
    out.x = pts[0]!;
    out.y = pts[1]!;
    return out;
  }
  const v = u <= 0 ? 0 : u >= 1 ? 1 : u;
  const f = v * (count - 1);
  const i = Math.min(count - 2, Math.floor(f));
  const k = f - i;
  out.x = pts[i * 2]! + (pts[i * 2 + 2]! - pts[i * 2]!) * k;
  out.y = pts[i * 2 + 1]! + (pts[i * 2 + 3]! - pts[i * 2 + 1]!) * k;
  return out;
}

/** Heading (radians) at normalized u along a polyline. */
export function headingAt(pts: Float32Array, u: number): number {
  const count = pts.length >> 1;
  if (count < 2) return 0;
  const f = Math.min(count - 2, Math.max(0, Math.floor(u * (count - 1))));
  return Math.atan2(pts[f * 2 + 3]! - pts[f * 2 + 1]!, pts[f * 2 + 2]! - pts[f * 2]!);
}

/** S-curve between two points with horizontal tangents (branch peel / merge swoop). */
export function sCurve(a: Pt, b: Pt, tension = 0.5, spacing = 6) {
  const dx = Math.max(12, Math.abs(b.x - a.x));
  const c1 = { x: a.x + dx * tension, y: a.y };
  const c2 = { x: b.x - dx * tension, y: b.y };
  return flattenCubic(a, c1, c2, b, spacing);
}
