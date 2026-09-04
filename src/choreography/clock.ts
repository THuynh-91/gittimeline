/**
 * Performance clock: maps ordered history items onto a musical timeline.
 *
 *  - quiet spans compress (bounded calendar sweep), dense spans get more time
 *    per bucket but less time per commit, so the dance speeds up as history
 *    slows down;
 *  - tempo moves between bounded regions with hysteresis, changing per phrase;
 *  - every impact is quantized to the beat grid, but never reordered:
 *    a child always lands after its parents, and merges/divergences reserve
 *    approach time.
 *
 * Quantization happens in *natural* time (1× pace) and is then scaled to the
 * target duration, so layout geometry is identical for every target duration
 * and only the playback speed (and perceived tempo) changes.
 */
export interface ClockItem {
  /** Historical presentation time. */
  h: number;
  /** Phrase intensity 0..1 at this item. */
  intensity: number;
  /** Thread index (items on one thread need spacing to travel). */
  thread: number;
  /** Ids (indices into items) that must land strictly before this one. */
  after: number[];
  /** Extra weight: aggregates carry many commits. */
  weight: number;
  /** Merge commits reserve approach time from every parent. */
  isMerge: boolean;
  /** First node of a diverging thread reserves peel time from its base. */
  isDivergence: boolean;
  /** Merge salience in 0..1 (adds dramatic room). */
  salience: number;
}

export interface ClockResult {
  /** Performance time of each item's landing. */
  impact: Float64Array;
  beat: Int32Array;
  /** Beat length in performance seconds at each item. */
  beatLen: Float32Array;
  /** [performance time, bpm] segments. */
  tempoMap: Array<[number, number]>;
  duration: number;
  /** Performance seconds per natural second. */
  scale: number;
  /** Gap items: index → historical gap in ms preceding the item. */
  gaps: Map<number, number>;
  naturalDuration: number;
}

export const TEMPO_REGIONS = [
  { max: 0.28, bpm: 72 },
  { max: 0.56, bpm: 100 },
  { max: 0.8, bpm: 132 },
  { max: 1.01, bpm: 164 },
] as const;

const DAY = 86_400_000;
const GAP_THRESHOLD = 21 * DAY;
export const CLOCK_TAIL = 3.2; // performance seconds reserved for the final tableau
export const CLOCK_HEAD = 1.0; // performance seconds before the first impact

export function buildClock(items: ClockItem[], targetDuration: number, reducedMotion: boolean): ClockResult {
  const n = items.length;
  const gaps = new Map<number, number>();
  if (n === 0) {
    return { impact: new Float64Array(0), beat: new Int32Array(0), beatLen: new Float32Array(0), tempoMap: [[0, 90]], duration: CLOCK_HEAD + CLOCK_TAIL, scale: 1, gaps, naturalDuration: 0 };
  }

  // 1. Natural step durations (seconds at 1x).
  const step = new Float64Array(n);
  let natural = 0;
  for (let i = 0; i < n; i++) {
    const it = items[i]!;
    const d = Math.pow(Math.max(0, Math.min(1, it.intensity)), 0.8);
    let s = (0.92 - 0.74 * d) * Math.max(1, it.weight);
    if (i > 0) {
      const dh = it.h - items[i - 1]!.h;
      if (dh > GAP_THRESHOLD) {
        s += Math.min(1.6, 0.4 * Math.log2(dh / GAP_THRESHOLD + 1));
        gaps.set(i, dh);
      }
    }
    if (it.isMerge) s += 0.35 + 0.5 * it.salience;
    step[i] = s;
    natural += s;
  }

  // 2. Quantize in natural time.
  // The first item lands at t=0 (natural); step[i] is the interval preceding item i.
  const nominal = new Float64Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    acc += step[i]!;
    nominal[i] = acc;
  }
  const q = quantize(items, nominal, reducedMotion);
  const naturalSpan = q.impact[n - 1]!;

  // 3. Scale to the target duration with bounded per-step limits so tiny
  //    histories stay lively and huge ones stay legible.
  let scale = targetDuration > 0 ? (targetDuration - CLOCK_HEAD - CLOCK_TAIL) / Math.max(1e-6, naturalSpan) : 1;
  let maxStep = 0;
  let minStep = Infinity;
  for (let i = 1; i < n; i++) {
    const d = q.impact[i]! - q.impact[i - 1]!;
    if (!gaps.has(i)) maxStep = Math.max(maxStep, d);
    if (d > 1e-6) minStep = Math.min(minStep, d);
  }
  if (n === 1) maxStep = 1;
  // Never slow the natural pace by more than 70%: tiny histories end early rather than crawling.
  scale = Math.min(scale, 1.7);
  if (maxStep * scale > 3.4) scale = 3.4 / maxStep;
  const minStepAllowed = reducedMotion ? 0.16 : 0.07;
  if (Number.isFinite(minStep) && minStep * scale < minStepAllowed) scale = minStepAllowed / minStep;
  const maxBpm = reducedMotion ? 120 : 200;
  const minBpm = 48;
  const bpmSpan = q.tempoMap.map((t) => t[1] / scale);
  const fastest = Math.max(...bpmSpan);
  const slowest = Math.min(...bpmSpan);
  if (fastest > maxBpm) scale = Math.max(scale, Math.max(...q.tempoMap.map((t) => t[1])) / maxBpm);
  if (slowest < minBpm) scale = Math.min(scale, Math.min(...q.tempoMap.map((t) => t[1])) / minBpm);

  const impact = new Float64Array(n);
  const beatLen = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    impact[i] = CLOCK_HEAD + q.impact[i]! * scale;
    beatLen[i] = q.beatLen[i]! * scale;
  }
  const tempoMap: Array<[number, number]> = q.tempoMap.map(([t, bpm]) => [round(CLOCK_HEAD + t * scale, 3), round(bpm / scale, 2)]);
  const duration = impact[n - 1]! + CLOCK_TAIL;
  return { impact, beat: q.beat, beatLen, tempoMap, duration, scale, gaps, naturalDuration: natural };
}

interface QuantizeResult {
  impact: Float64Array;
  beat: Int32Array;
  beatLen: Float32Array;
  tempoMap: Array<[number, number]>;
}

function quantize(items: ClockItem[], nominal: Float64Array, reducedMotion: boolean): QuantizeResult {
  const n = items.length;
  // Tempo map by 4-second phrase (natural time) with hysteresis.
  const phraseLen = 4;
  const tempoMap: Array<[number, number]> = [];
  let region = 1;
  let cursor = 0;
  const end = nominal[n - 1]!;
  for (let t = 0; t < end + phraseLen; t += phraseLen) {
    let sum = 0;
    let count = 0;
    while (cursor < n && nominal[cursor]! < t + phraseLen) {
      sum += items[cursor]!.intensity;
      count++;
      cursor++;
    }
    const avg = count ? sum / count : items[Math.min(cursor, n - 1)]!.intensity * 0.6;
    let next = TEMPO_REGIONS.findIndex((r) => avg < r.max);
    if (next < 0) next = TEMPO_REGIONS.length - 1;
    if (next > region) region = Math.min(region + 1, next);
    else if (next < region && avg < TEMPO_REGIONS[region - 1]!.max - 0.06) region = Math.max(region - 1, next);
    const bpm = reducedMotion ? Math.min(TEMPO_REGIONS[region]!.bpm, 108) : TEMPO_REGIONS[region]!.bpm;
    if (!tempoMap.length || tempoMap[tempoMap.length - 1]![1] !== bpm) tempoMap.push([t, bpm]);
  }

  const grid = new BeatGrid(tempoMap);
  const impact = new Float64Array(n);
  const beat = new Int32Array(n);
  const beatLen = new Float32Array(n);
  const lastOnThread = new Map<number, number>();
  const minStep = reducedMotion ? 0.16 : 0.07;
  for (let i = 0; i < n; i++) {
    const it = items[i]!;
    const bl = beatLengthAt(tempoMap, nominal[i]!);
    beatLen[i] = bl;
    const subdiv = it.intensity < 0.35 ? 1 : it.intensity < 0.7 ? 2 : 4;
    let earliest = nominal[i]!;
    if (i > 0) earliest = Math.max(earliest, impact[i - 1]!); // never reorder the global sequence
    const prevOnThread = lastOnThread.get(it.thread);
    if (prevOnThread !== undefined) earliest = Math.max(earliest, impact[prevOnThread]! + Math.max(minStep, bl * 0.5));
    for (const a of it.after) {
      let reserve = bl * 0.5;
      if (it.isMerge) reserve = bl * (1.25 + it.salience * 1.25);
      if (it.isDivergence) reserve = Math.max(reserve, bl * 0.9);
      earliest = Math.max(earliest, impact[a]! + reserve);
    }
    const qq = grid.quantizeUp(earliest, subdiv);
    impact[i] = qq.time;
    beat[i] = qq.beat;
    lastOnThread.set(it.thread, i);
  }
  return { impact, beat, beatLen, tempoMap };
}

/** Beat grid that extends itself on demand so quantization never runs out of beats. */
class BeatGrid {
  private beats: number[] = [0];
  private seg = 0;
  constructor(private tempoMap: Array<[number, number]>) {}

  private extendTo(time: number) {
    while (this.beats[this.beats.length - 1]! <= time + 1e-6) {
      const t = this.beats[this.beats.length - 1]!;
      while (this.seg + 1 < this.tempoMap.length && this.tempoMap[this.seg + 1]![0] <= t) this.seg++;
      this.beats.push(t + 60 / this.tempoMap[this.seg]![1]);
    }
  }

  quantizeUp(time: number, subdiv: number): { time: number; beat: number } {
    this.extendTo(time + 1);
    const beats = this.beats;
    let lo = 0;
    let hi = beats.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (beats[mid]! <= time) lo = mid;
      else hi = mid - 1;
    }
    const b0 = beats[lo]!;
    const b1 = beats[lo + 1]!;
    const len = Math.max(1e-6, b1 - b0);
    const frac = (time - b0) / len;
    const k = Math.ceil(frac * subdiv - 1e-9);
    if (k >= subdiv) return { time: b1, beat: lo + 1 };
    return { time: b0 + (k / subdiv) * len, beat: lo };
  }
}

export function beatLengthAt(tempoMap: Array<[number, number]>, t: number): number {
  let bpm = tempoMap[0]![1];
  for (const [start, b] of tempoMap) {
    if (start <= t) bpm = b;
    else break;
  }
  return 60 / bpm;
}

/** Piecewise-linear lookup in a monotone [x, y] table. */
export function mapMonotone(table: Array<[number, number]>, x: number, inverse = false): number {
  if (!table.length) return 0;
  const ax = inverse ? 1 : 0;
  const ay = inverse ? 0 : 1;
  if (x <= table[0]![ax]) return table[0]![ay];
  const last = table[table.length - 1]!;
  if (x >= last[ax]) return last[ay];
  let lo = 0;
  let hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid]![ax] <= x) lo = mid;
    else hi = mid;
  }
  const a = table[lo]!;
  const b = table[hi]!;
  const span = b[ax] - a[ax];
  const f = span > 0 ? (x - a[ax]) / span : 0;
  return a[ay] + (b[ay] - a[ay]) * f;
}

function round(v: number, p: number): number {
  const m = Math.pow(10, p);
  return Math.round(v * m) / m;
}
