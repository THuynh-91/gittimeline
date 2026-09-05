import type {
  ActivityBucket,
  AggregateSpan,
  CameraCue,
  ChoreographyEvent,
  CompiledPerformance,
  ContributorIdentity,
  EdgeGeom,
  Era,
  Landmark,
  NodeGeom,
  RefRecord,
  ThreadGeom,
  UnixMs,
} from '@/model/types';
import { ENGINE } from '@/model/types';
import { contentHashOf } from '@/model/hash';
import { routeAlongLane, routeCurve } from '@/layout/layout';
import type { Pt } from '@/layout/paths';

/**
 * `.gtperf` — a compiled performance, shipped instead of computed.
 *
 * A catalog entry used to be a `Dataset`: raw commits, which the browser then
 * had to turn into a plan. That compile is essentially the whole cost of
 * opening one. Measured on this machine: ripgrep 0.5s, React 2.0s, CPython
 * 20s, VS Code 36s, Kubernetes 142s, Rust 639s, and Linux and Chromium never
 * finished at all. The cost tracks merge density rather than commit count —
 * LLVM's 595,778 commits collapse to 894 nodes because it has five merges,
 * while Rust's 339,084 leave 248,298 because it has 107,048.
 *
 * None of that work needs a browser. `compilePerformance` is deterministic:
 * the same dataset, preset and seed always produce the same plan, and
 * `planHash` is the proof. So it runs once in CI and the *result* ships.
 *
 * ## Why not JSON
 *
 * Two reasons, and they are the same two that shaped `stream.ts`.
 *
 * A whole plan cannot be one `JSON.stringify` — a JavaScript string caps near
 * 512 MB and Rust's plan is larger than that, so the file has to be written
 * and read a record at a time in both directions.
 *
 * And a plan is not only records. `EdgeGeom.pts` is a `Float32Array` holding a
 * flattened polyline, one per edge, and `waveform` is another. Rust has
 * 354,672 edges: as JSON number arrays those points would be roughly six bytes
 * of text per float instead of four bytes of IEEE-754, and every one of them
 * would be re-parsed on load. They also would not survive the trip exactly,
 * because a float32 printed as decimal and read back as a float64 is not the
 * same bit pattern — and "not quite the same plan" is the one thing this file
 * may not be.
 *
 * ## The container
 *
 * A single gzip member holding a framed stream:
 *
 *     {header}\n
 *     {"t":"n","v":{...}}\n        one line per record, tagged
 *     ...
 *     {"t":"bin","floats":N}\n
 *     <N*4 raw little-endian float32 bytes>
 *     {"t":"end",...}\n
 *
 * Lines are split on byte 0x0A before decoding, never after, so the binary
 * section is simply a run the reader counts through rather than scans. Text
 * frames stay text and the geometry stays bytes. Nothing on either side ever
 * becomes one large string, and the whole file is still one download.
 *
 * The floats are laid out in one contiguous block — the waveform, then
 * whatever each edge still needs, in index order — and each edge line says how
 * its own slice is to be read. That keeps the header small: an index of
 * 354,672 offsets would have re-created the giant-string problem in the one
 * line that has to be read first.
 *
 * ## Why most of the geometry is not written at all
 *
 * The polylines were the file. Measured on the shipped catalog, `EdgeGeom.pts`
 * was 59% of Kubernetes' 87.9 MB and 51% of Linux's 266.3 MB, and it is the
 * one section that is not really data: every polyline is the return value of
 * `routeCurve` or `routeAlongLane` applied to two node positions. Linux's
 * 451,956 of them are 70,279,078 points generated from 903,912 numbers the
 * file already carries in its node records.
 *
 * So an edge names its route instead of listing its points, and the reader
 * runs the same two functions the layout ran. `edgeRouteOf` recovers the call
 * from the edge itself — its kind says which generator, its `parent` and
 * `child` index the endpoints, and for a boundary commit's missing parents its
 * `parentIndex` gives the fan offset. Four ways an edge's points can travel:
 *
 *  - **`GEOM_CURVE`** — `routeCurve(a, b, kind)`, no floats at all. Merges,
 *    divergences and secondary edges: 84% of Kubernetes' points, 57% of
 *    Linux's.
 *  - **`GEOM_FLAT`** — `routeAlongLane` along a constant lane, no floats. The
 *    primary spine is a straight horizontal axis, so every thread edge on it
 *    is a level run between two x positions.
 *  - **`GEOM_LANE`** — `routeAlongLane` along a lane that bulges. Half the
 *    floats: the x positions are exactly uniform between the two endpoints and
 *    come back from the generator, and only the y values are carried. The lane
 *    curve itself cannot be recovered, because it is built from thread extents
 *    that live in the layout pass and are not in the plan.
 *  - **`GEOM_RAW`** — every point, as version 1 always wrote them.
 *
 * Nothing here is inferred and then trusted. The writer regenerates each
 * candidate and compares it against the polyline the compiler actually
 * produced — bit for bit, and the arc length with it — and falls back to the
 * next form, and finally to raw points, the moment one disagrees. The
 * constants those routes rebuild (the 70 units a boundary edge reaches back,
 * the fan spacing on an octopus merge) are duplicated from `compilePerformance`
 * and could drift from it; if they ever do, every edge simply fails its
 * comparison and ships its points. A stale constant here costs bytes. It
 * cannot cost correctness.
 *
 * ## Why the geometry that is left is not written as it sits in memory
 *
 * gzip is nearly useless on raw float32: the mantissa bytes of a smooth curve
 * look like noise, and React's 821,740 points compress from 3.29 MB to only
 * 2.59 MB. Two reversible transforms fix that, and the block is written
 * through both — the `d2s` codec:
 *
 *  - **Delta with stride two, on the bit patterns.** The block is x, y, x, y,
 *    so every value is subtracted from the one two places back, which is the
 *    previous point's *same* coordinate rather than its other one. The
 *    subtraction is done on the IEEE-754 bits as unsigned 32-bit integers
 *    rather than on the numbers, because integer wrap-around is exactly
 *    reversible and floating-point subtraction is not: `a - b` rounded back
 *    into a float32 is not always `a` again, and "not always" is not a
 *    property this file may have. Neighbouring floats of similar magnitude
 *    have neighbouring bit patterns, so the differences come out small.
 *  - **Byte-plane transposition.** All the first bytes, then all the second
 *    bytes, and so on, so the near-constant exponent bytes sit next to each
 *    other instead of being interleaved with the bytes that vary.
 *
 * Together those take React's geometry from 2.59 MB to 1.13 MB — 56% off the
 * largest section of the file — and every value comes back bit for bit,
 * negative zeroes and NaN payloads included. The cost is two linear passes on
 * load, which is milliseconds against the minutes this file exists to remove.
 *
 * ## Subjects are named by index
 *
 * `ChoreographyEvent.subjectIds` is the other section that repeats what the
 * file already has: 606,359 of Kubernetes' 746,289 subject ids are the SHA of
 * a node listed a few thousand lines further down. A forty-character hex
 * string is close to incompressible — gzip gets one down to about 25 bytes,
 * and 20 is the floor — so those are written as the node's index instead and
 * looked back up on load. Subjects that are not a node's sha (thread ids,
 * contributor ids, aggregate ids, and the shas of commits that were collapsed
 * into a ribbon and so have no node) stay strings. `planHash` reads
 * `subjectIds`, so a mistake in that substitution is not a subtle one: the
 * fingerprint stops matching and the build refuses to keep the file.
 *
 * ## What this is not
 *
 * This is a *build output*, read only from the site's own origin by
 * `loadCatalogEntry`. A `.gittimeline` artifact is untrusted input — anyone
 * can paste one — so it is re-normalized through `buildDataset` on import. A
 * plan cannot be re-derived that way, because a plan is the derivation. So
 * `.gtperf` is deliberately *not* accepted from the file picker, and the
 * integrity checks here are for corruption and truncation rather than for
 * hostility.
 */

// 3: nodes carry their commit subject, so the ledger has words in it without
// fetching the dataset back. A version 2 plan would read perfectly well and
// show "(no message)" on every row, which is the failure this is fixing, so it
// is refused rather than tolerated.
export const PERF_SCHEMA_VERSION = 3;
export const PERF_MAGIC = 'gittimeline-perf';
/** Suffix the build writes and the loader looks for, next to the dataset. */
export const PERF_EXTENSION = '.gtperf.gz';

/**
 * How the dataset this plan came from can still be reached.
 *
 * The plan is enough to *watch* a history and to read the ledger beside it,
 * but not to inspect one: parent lists and GitHub links live in the dataset
 * and nothing in a compiled performance carries them. So the file records
 * where its dataset is and how big it is, and the loader decides — after the
 * first frame is already on screen — whether fetching it in the background is
 * worth the bytes.
 *
 * Commit subjects used to be on that list and are not any more. They were the
 * one omission that showed: the ledger is on screen for the whole performance,
 * and every history too large to fetch its dataset back — which is every large
 * one — ran for hours with "(no message)" on every row.
 */
export interface PerfDatasetRef {
  file: string;
  bytes: number;
  contentHash: string;
  commits: number;
}

export interface PerfHeader {
  format: typeof PERF_MAGIC;
  schemaVersion: number;
  engine: typeof ENGINE;
  seed: string;
  preset: CompiledPerformance['preset'];
  duration: number;
  source: CompiledPerformance['source'];
  coverage: CompiledPerformance['coverage'];
  bounds: CompiledPerformance['bounds'];
  stats: CompiledPerformance['stats'];
  planHash: string;
  /** Total float32 values in the binary section: waveform first, then edges. */
  floats: number;
  waveform: number;
  counts: PerfCounts;
  dataset: PerfDatasetRef | null;
  builtAt: string;
}

export interface PerfCounts {
  n: number;
  e: number;
  t: number;
  v: number;
  c: number;
  m: number;
  p: number;
  a: number;
  r: number;
  i: number;
  g: number;
  f: number;
  l: number;
  s: number;
}

/**
 * How much of an edge's polyline is in the binary section, and what the reader
 * does with the rest.
 *
 * These are numbers rather than names because they are written once per edge
 * and there are 451,956 edges in Linux's plan.
 */
export const GEOM_RAW = 0;
export const GEOM_CURVE = 1;
export const GEOM_FLAT = 2;
export const GEOM_LANE = 3;
export type PerfGeomCode = typeof GEOM_RAW | typeof GEOM_CURVE | typeof GEOM_FLAT | typeof GEOM_LANE;

/**
 * An edge as it travels: no polyline, and no `length` or point count either.
 *
 * Both of those are outputs of the same generator call the points are, so a
 * reader that regenerates the points has them for free. Only `GEOM_RAW`, which
 * regenerates nothing, has to carry them.
 */
export type SerializedEdge = Omit<EdgeGeom, 'pts' | 'length'> & {
  g: PerfGeomCode;
  ptsLen?: number;
  length?: number;
};

/** An event whose node-sha subjects have been replaced by node indices. */
export type SerializedEvent = Omit<ChoreographyEvent, 'subjectIds'> & { subjectIds: Array<string | number> };

/**
 * One body line. The tag is first so a reader can dispatch on it without
 * parsing the payload twice, and single letters because there are up to
 * 600,000 of these in one file.
 */
export type PerfRecord =
  | { t: 'n'; v: NodeGeom }
  | { t: 'e'; v: SerializedEdge }
  | { t: 't'; v: ThreadGeom }
  | { t: 'v'; v: SerializedEvent }
  | { t: 'c'; v: CameraCue }
  | { t: 'm'; v: [UnixMs, number] }
  | { t: 'p'; v: [number, number] }
  | { t: 'a'; v: ActivityBucket }
  | { t: 'r'; v: Era }
  | { t: 'i'; v: ContributorIdentity }
  | { t: 'g'; v: AggregateSpan }
  | { t: 'f'; v: RefRecord }
  | { t: 'l'; v: Landmark }
  | { t: 's'; v: string };

/**
 * The codec the geometry block is written through. Named in the file rather
 * than assumed, so a reader can refuse a block it would silently mis-decode.
 */
export type PerfCodec = 'd2s';

export interface PerfBinaryMarker {
  t: 'bin';
  floats: number;
  codec: PerfCodec;
}

export interface PerfTrailer {
  t: 'end';
  planHash: string;
  contentHash: string;
}

export function perfContentHash(planHash: string): string {
  return contentHashOf({ plan: planHash, schema: PERF_SCHEMA_VERSION });
}

export class PerformanceFormatError extends Error {}

/**
 * Both ends of this format read and write typed arrays through a native
 * `Float32Array` view, which is little-endian on every platform that runs
 * this — x86, ARM in its usual mode, WebAssembly. Rather than carry a
 * byte-swapping path that could never be exercised, the assumption is checked
 * once and said out loud if it is ever wrong.
 */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const EMPTY = new Uint8Array(0);

function requireLittleEndian() {
  if (!LITTLE_ENDIAN) throw new PerformanceFormatError('.gtperf files are little-endian; this platform is not.');
}

/** Bytes buffered before a binary chunk is handed on, so 350,000 polylines do not become 350,000 writes. */
const BINARY_CHUNK = 1 << 20;

/**
 * How far back a boundary commit's edge reaches for its unloaded parents, and
 * how the extra parents of an octopus merge fan out around it.
 *
 * `compilePerformance` writes these literally, at the one place it draws an
 * edge whose other end is a commit nobody fetched. They are repeated rather
 * than imported because importing them would pull the whole compiler into the
 * loader's bundle to read three numbers — and because being wrong about them
 * is harmless: an edge whose regenerated shape does not match the compiled one
 * is written out in full instead.
 */
const UNKNOWN_REACH = 70;
const UNKNOWN_FAN = 28;
const UNKNOWN_FAN_STEP = 14;

/** The same two-decimal rounding `compilePerformance` applies to `EdgeGeom.length`. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * The generator call that produced an edge's polyline.
 *
 * Every edge in a plan comes from one of exactly two functions, and which one —
 * with which arguments — is written on the edge itself. `kind` picks the
 * generator; `parent` and `child` index the endpoints out of the node array;
 * `parentIndex` distinguishes the several unloaded parents of one boundary
 * commit from each other. Nothing is measured off the polyline, so this
 * answers the same way on both sides of the file.
 *
 * `null` means the edge does not fit any of them — an endpoint out of range, a
 * kind this build does not know — and the points travel in full.
 */
type EdgeRoute =
  | { via: 'curve'; a: Pt; b: Pt; kind: 'divergence' | 'merge' | 'secondary' }
  | { via: 'lane'; x0: number; x1: number; flatY: number };

function edgeRouteOf(edge: { kind: EdgeGeom['kind']; parent: number; child: number; parentIndex: number }, nodes: NodeGeom[]): EdgeRoute | null {
  const b = nodes[edge.child];
  if (!b) return null;
  const a = edge.parent >= 0 ? nodes[edge.parent] : null;
  switch (edge.kind) {
    case 'divergence':
    case 'merge':
    case 'secondary':
      return a ? { via: 'curve', a, b, kind: edge.kind } : null;
    case 'thread':
    case 'aggregate':
      return a ? { via: 'lane', x0: a.x, x1: b.x, flatY: b.y } : null;
    case 'unknown': {
      // The first parent of a boundary commit runs level into it; the rest fan
      // above and below so an octopus merge with unloaded parents does not draw
      // several edges on top of each other.
      if (edge.parentIndex === 0) return { via: 'lane', x0: b.x - UNKNOWN_REACH, x1: b.x, flatY: b.y };
      const dy = (edge.parentIndex % 2 ? -1 : 1) * (UNKNOWN_FAN + UNKNOWN_FAN_STEP * Math.floor(edge.parentIndex / 2));
      return { via: 'curve', a: { x: b.x - UNKNOWN_REACH, y: b.y + dy }, b, kind: 'secondary' };
    }
    default:
      return null;
  }
}

/**
 * Run the route, optionally feeding it y values that were stored rather than
 * computed.
 *
 * `routeAlongLane` asks its lane function for exactly one y per sample, in
 * order, so handing it a closure over the stored values rebuilds the polyline
 * the layout produced — including its arc length, which accumulates over the
 * same float32 values either way — without this module knowing anything about
 * how lanes are shaped.
 */
function runRoute(route: EdgeRoute, laneY: ((i: number) => number) | null): { pts: Float32Array; length: number } {
  if (route.via === 'curve') return routeCurve(route.a, route.b, route.kind);
  if (!laneY) return routeAlongLane(() => route.flatY, route.x0, route.x1);
  let i = 0;
  return routeAlongLane(() => laneY(i++), route.x0, route.x1);
}

/** Are two polylines the same polyline — bits, not values — and the same length? */
function sameGeometry(made: { pts: Float32Array; length: number }, pts: Float32Array, length: number): boolean {
  if (made.pts.length !== pts.length) return false;
  const a = new Uint32Array(made.pts.buffer, made.pts.byteOffset, made.pts.length);
  const b = new Uint32Array(pts.buffer, pts.byteOffset, pts.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return round2(made.length) === length;
}

/**
 * The smallest form each edge's points can travel in, decided by trying it.
 *
 * Returns one code per edge and the running total of floats the binary section
 * will hold, which the header has to state before any of the body is written.
 * The work is one extra routing pass over the plan — the same call the layout
 * already made once — which is seconds on Linux inside a build that takes
 * minutes, and buys the reader the right to trust what it regenerates.
 */
function chooseGeometry(perf: CompiledPerformance): { codes: Uint8Array; floats: number } {
  const codes = new Uint8Array(perf.edges.length);
  let floats = perf.waveform.length;
  for (let i = 0; i < perf.edges.length; i++) {
    const e = perf.edges[i]!;
    const route = edgeRouteOf(e, perf.nodes);
    let code: PerfGeomCode = GEOM_RAW;
    if (route && sameGeometry(runRoute(route, null), e.pts, e.length)) {
      code = route.via === 'curve' ? GEOM_CURVE : GEOM_FLAT;
    } else if (route && route.via === 'lane') {
      const half = e.pts.length >> 1;
      if (sameGeometry(runRoute(route, (k) => e.pts[k * 2 + 1] ?? 0), e.pts, e.length)) {
        code = GEOM_LANE;
        floats += half;
      } else {
        floats += e.pts.length;
      }
    } else {
      floats += e.pts.length;
    }
    codes[i] = code;
  }
  return { codes, floats };
}

/**
 * How each edge's points would travel, without writing a file.
 *
 * The build prints this and the tests assert on it, and both need it for the
 * same reason: "smaller" is not the claim being made here, "regenerated"
 * is — and an edge that quietly stopped matching its route would still write a
 * correct file, just a much larger one. A count of how many edges fell back to
 * raw points is the only thing that notices.
 */
export function geometryBreakdown(perf: CompiledPerformance): { raw: number; curve: number; flat: number; lane: number; floats: number; ptsFloats: number } {
  const { codes, floats } = chooseGeometry(perf);
  const out = { raw: 0, curve: 0, flat: 0, lane: 0, floats, ptsFloats: perf.waveform.length };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!;
    out.ptsFloats += perf.edges[i]!.pts.length;
    if (code === GEOM_CURVE) out.curve++;
    else if (code === GEOM_FLAT) out.flat++;
    else if (code === GEOM_LANE) out.lane++;
    else out.raw++;
  }
  return out;
}

/**
 * Emit a compiled performance frame by frame.
 *
 * A generator of `string | Uint8Array` rather than a buffer, so the caller
 * decides where the frames go — a gzip stream on disk in CI — without either
 * side holding the whole file. Strings are UTF-8 lines; byte arrays are raw
 * payload and are never decoded.
 */
export function* streamCompiledPerformance(perf: CompiledPerformance, dataset: PerfDatasetRef | null = null): Generator<string | Uint8Array> {
  requireLittleEndian();
  const { codes, floats } = chooseGeometry(perf);

  // Which subjects are node shas has to be settled before the first event line
  // is written, and the lookup is wanted for every one of them, so the index is
  // built once here rather than searched per subject.
  const nodeOfSha = new Map<string, number>();
  for (let i = 0; i < perf.nodes.length; i++) nodeOfSha.set(perf.nodes[i]!.sha, i);

  const header: PerfHeader = {
    format: PERF_MAGIC,
    schemaVersion: PERF_SCHEMA_VERSION,
    engine: perf.engine,
    seed: perf.seed,
    preset: perf.preset,
    duration: perf.duration,
    source: perf.source,
    coverage: perf.coverage,
    bounds: perf.bounds,
    stats: perf.stats,
    planHash: perf.planHash,
    floats,
    waveform: perf.waveform.length,
    counts: {
      n: perf.nodes.length,
      e: perf.edges.length,
      t: perf.threads.length,
      v: perf.events.length,
      c: perf.camera.length,
      m: perf.timeMap.length,
      p: perf.tempoMap.length,
      a: perf.activity.length,
      r: perf.eras.length,
      i: perf.contributors.length,
      g: perf.aggregates.length,
      f: perf.refs.length,
      l: perf.landmarks.length,
      s: perf.transcript.length,
    },
    dataset,
    builtAt: new Date().toISOString(),
  };
  yield `${JSON.stringify(header)}\n`;

  // Order is not load-bearing — every record carries its own tag — but keeping
  // the small sections ahead of the two large ones means a reader that fails
  // does so having already said which repository it was reading.
  for (const v of perf.contributors) yield `${JSON.stringify({ t: 'i', v })}\n`;
  for (const v of perf.refs) yield `${JSON.stringify({ t: 'f', v })}\n`;
  for (const v of perf.eras) yield `${JSON.stringify({ t: 'r', v })}\n`;
  for (const v of perf.landmarks) yield `${JSON.stringify({ t: 'l', v })}\n`;
  for (const v of perf.transcript) yield `${JSON.stringify({ t: 's', v })}\n`;
  for (const v of perf.timeMap) yield `${JSON.stringify({ t: 'm', v })}\n`;
  for (const v of perf.tempoMap) yield `${JSON.stringify({ t: 'p', v })}\n`;
  for (const v of perf.activity) yield `${JSON.stringify({ t: 'a', v })}\n`;
  for (const v of perf.aggregates) yield `${JSON.stringify({ t: 'g', v })}\n`;
  for (const v of perf.threads) yield `${JSON.stringify({ t: 't', v })}\n`;
  for (const ev of perf.events) {
    const v: SerializedEvent = { ...ev, subjectIds: ev.subjectIds.map((s) => nodeOfSha.get(s) ?? s) };
    yield `${JSON.stringify({ t: 'v', v })}\n`;
  }
  for (const v of perf.camera) yield `${JSON.stringify({ t: 'c', v })}\n`;
  for (const v of perf.nodes) yield `${JSON.stringify({ t: 'n', v })}\n`;
  for (let i = 0; i < perf.edges.length; i++) {
    const { pts, length, ...rest } = perf.edges[i]!;
    const g = codes[i] as PerfGeomCode;
    const v: SerializedEdge = g === GEOM_RAW ? { ...rest, g, ptsLen: pts.length, length } : { ...rest, g };
    yield `${JSON.stringify({ t: 'e', v })}\n`;
  }

  const marker: PerfBinaryMarker = { t: 'bin', floats, codec: 'd2s' };
  yield `${JSON.stringify(marker)}\n`;
  yield* binaryFrames(perf, codes);

  const trailer: PerfTrailer = { t: 'end', planHash: perf.planHash, contentHash: perfContentHash(perf.planHash) };
  yield `${JSON.stringify(trailer)}\n`;
}

/**
 * A stretch of the block: `count` values from `bits`, starting at `start` and
 * taken every `stride`. A stride of two is how a `GEOM_LANE` edge contributes
 * only its y coordinates without a copy being made of them first.
 */
interface GeometryRun {
  bits: Uint32Array;
  start: number;
  stride: number;
  count: number;
}

/** Every float in the block, in the order the reader will put them back. */
function* geometryRuns(perf: CompiledPerformance, codes: Uint8Array): Generator<GeometryRun> {
  const w = perf.waveform;
  yield { bits: new Uint32Array(w.buffer, w.byteOffset, w.length), start: 0, stride: 1, count: w.length };
  for (let i = 0; i < perf.edges.length; i++) {
    const code = codes[i]!;
    if (code === GEOM_CURVE || code === GEOM_FLAT) continue;
    const pts = perf.edges[i]!.pts;
    const bits = new Uint32Array(pts.buffer, pts.byteOffset, pts.length);
    if (code === GEOM_LANE) yield { bits, start: 1, stride: 2, count: pts.length >> 1 };
    else yield { bits, start: 0, stride: 1, count: pts.length };
  }
}

/**
 * The geometry block, delta-coded and transposed into byte planes.
 *
 * Four passes over the same floats rather than one pass into four buffers,
 * because a plane cannot be emitted until every value has contributed its byte
 * to it, and holding all four would mean holding the whole block again. The
 * delta state is rebuilt on each pass, which costs three extra subtractions
 * per value and no memory at all.
 *
 * Each frame is a copy of the fill buffer rather than a view of it: the
 * consumer is a gzip stream and may still be holding the previous frame when
 * the next one starts filling.
 */
function* binaryFrames(perf: CompiledPerformance, codes: Uint8Array): Generator<Uint8Array> {
  const buf = new Uint8Array(BINARY_CHUNK);
  let used = 0;
  for (let plane = 0; plane < 4; plane++) {
    const shift = plane * 8;
    // The two bit patterns two and one places back; both start at zero so the
    // first pair of values is written as-is.
    let back2 = 0;
    let back1 = 0;
    for (const run of geometryRuns(perf, codes)) {
      const { bits, stride } = run;
      for (let i = 0, j = run.start; i < run.count; i++, j += stride) {
        const cur = bits[j]!;
        buf[used++] = ((cur - back2) >>> shift) & 0xff;
        back2 = back1;
        back1 = cur;
        if (used === buf.length) {
          yield buf.slice(0, used);
          used = 0;
        }
      }
    }
  }
  if (used) yield buf.slice(0, used);
}

/**
 * Read one back.
 *
 * Takes a byte stream — `fetch().body` through a `DecompressionStream` in the
 * browser, a gunzip stream in Node — and returns the performance. Frames are
 * consumed as they arrive; the only things held are the plan being assembled
 * and, at most, one partial line.
 *
 * `onHeader` fires as soon as the first line is out, before any of the body is
 * read, because the header carries things that are *about* the file rather
 * than part of the plan — when it was built, and where its dataset lives.
 */
export async function readCompiledPerformance(stream: ReadableStream<Uint8Array>, onHeader?: (h: PerfHeader) => void): Promise<CompiledPerformance> {
  requireLittleEndian();
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let header: PerfHeader | null = null;
  let trailer: PerfTrailer | null = null;
  const nodes: NodeGeom[] = [];
  const rawEdges: SerializedEdge[] = [];
  const threads: ThreadGeom[] = [];
  const rawEvents: SerializedEvent[] = [];
  const camera: CameraCue[] = [];
  const timeMap: Array<[UnixMs, number]> = [];
  const tempoMap: Array<[number, number]> = [];
  const activity: ActivityBucket[] = [];
  const eras: Era[] = [];
  const contributors: ContributorIdentity[] = [];
  const aggregates: AggregateSpan[] = [];
  const refs: RefRecord[] = [];
  const landmarks: Landmark[] = [];
  const transcript: string[] = [];

  /** The encoded geometry block, allocated once the marker declares its size. */
  let planes: Uint8Array | null = null;
  let binaryOffset = 0;
  let binaryLeft = 0;

  const handleLine = (line: string) => {
    if (!line) return;
    let obj: PerfHeader | PerfRecord | PerfBinaryMarker | PerfTrailer;
    try {
      obj = JSON.parse(line) as PerfHeader | PerfRecord | PerfBinaryMarker | PerfTrailer;
    } catch {
      // A file cut off mid-record ends in half a line, and the raw
      // `SyntaxError` from that says "Unterminated string at position 90",
      // which describes the parser rather than the file. Callers decide what
      // to do about a bad plan by catching one kind of error.
      throw new PerformanceFormatError('The compiled performance could not be read; the file may be truncated or corrupted.');
    }
    if (!header) {
      const h = obj as PerfHeader;
      if (h.format !== PERF_MAGIC) throw new PerformanceFormatError('Not a compiled GitTimeline performance.');
      if (h.schemaVersion !== PERF_SCHEMA_VERSION) throw new PerformanceFormatError(`Unsupported performance schema version ${String(h.schemaVersion)}; this build reads version ${PERF_SCHEMA_VERSION}.`);
      // A plan is only meaningful to the engine that wrote it: bump
      // `layoutVersion` or `choreographyVersion` and every shipped file
      // describes a show this build no longer produces. Refusing here is what
      // makes a stale artifact a rebuild rather than a wrong performance.
      if (!performanceMatchesEngine(h)) throw new PerformanceFormatError('This compiled performance was built by a different engine version and needs rebuilding.');
      header = h;
      onHeader?.(h);
      return;
    }
    const rec = obj as PerfRecord | PerfBinaryMarker | PerfTrailer;
    switch (rec.t) {
      case 'n': nodes.push(rec.v); return;
      case 'e': rawEdges.push(rec.v); return;
      case 't': threads.push(rec.v); return;
      case 'v': rawEvents.push(rec.v); return;
      case 'c': camera.push(rec.v); return;
      case 'm': timeMap.push(rec.v); return;
      case 'p': tempoMap.push(rec.v); return;
      case 'a': activity.push(rec.v); return;
      case 'r': eras.push(rec.v); return;
      case 'i': contributors.push(rec.v); return;
      case 'g': aggregates.push(rec.v); return;
      case 'f': refs.push(rec.v); return;
      case 'l': landmarks.push(rec.v); return;
      case 's': transcript.push(rec.v); return;
      case 'bin':
        if (rec.floats !== header.floats) throw new PerformanceFormatError('Geometry section disagrees with the header.');
        if (rec.codec !== 'd2s') throw new PerformanceFormatError(`Unknown geometry codec "${String(rec.codec)}".`);
        planes = new Uint8Array(rec.floats * 4);
        binaryLeft = planes.byteLength;
        return;
      case 'end':
        trailer = rec;
        return;
      default:
        // A record tag this build does not know is skipped rather than fatal,
        // so a file written by a newer builder still opens as far as it can.
        return;
    }
  };

  /**
   * Split on the newline *byte*.
   *
   * UTF-8 never encodes 0x0A as a continuation byte, so this is safe on text —
   * and unlike decoding first it leaves the binary run untouched, which is the
   * whole reason the container can carry both.
   */
  const consume = (buf: Uint8Array): Uint8Array => {
    let i = 0;
    while (i < buf.length) {
      if (binaryLeft > 0) {
        const take = Math.min(binaryLeft, buf.length - i);
        planes!.set(buf.subarray(i, i + take), binaryOffset);
        binaryOffset += take;
        binaryLeft -= take;
        i += take;
        continue;
      }
      const nl = buf.indexOf(0x0a, i);
      if (nl === -1) return buf.subarray(i);
      handleLine(decoder.decode(buf.subarray(i, nl)));
      i = nl + 1;
    }
    return EMPTY;
  };

  let carry: Uint8Array = EMPTY;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let buf = value;
    if (carry.length) {
      const joined = new Uint8Array(carry.length + value.length);
      joined.set(carry);
      joined.set(value, carry.length);
      buf = joined;
    }
    carry = consume(buf);
  }
  if (carry.length) handleLine(decoder.decode(carry).trim());

  const h = header as PerfHeader | null;
  if (!h) throw new PerformanceFormatError('Compiled performance has no header.');
  const tr = trailer as PerfTrailer | null;
  if (!tr) throw new PerformanceFormatError('Compiled performance is truncated: no trailer.');
  if (tr.contentHash !== perfContentHash(tr.planHash) || tr.planHash !== h.planHash) {
    throw new PerformanceFormatError('Compiled performance content hash does not match; the file may be corrupted or edited.');
  }
  // Cast for the same reason as the header above: the assignment happens
  // inside the line handler, which control-flow analysis cannot follow.
  const encoded = planes as Uint8Array | null;
  if (binaryLeft > 0 || !encoded) throw new PerformanceFormatError('Compiled performance is truncated: the geometry section is short.');
  const geometry = decodeGeometry(encoded, h.floats);

  const got: PerfCounts = {
    n: nodes.length, e: rawEdges.length, t: threads.length, v: rawEvents.length, c: camera.length,
    m: timeMap.length, p: tempoMap.length, a: activity.length, r: eras.length, i: contributors.length,
    g: aggregates.length, f: refs.length, l: landmarks.length, s: transcript.length,
  };
  for (const key of Object.keys(got) as Array<keyof PerfCounts>) {
    if (got[key] !== h.counts[key]) {
      throw new PerformanceFormatError(`Compiled performance is incomplete: ${got[key].toLocaleString('en-US')} of ${h.counts[key].toLocaleString('en-US')} "${key}" records.`);
    }
  }

  // An edge that carried all its points gets a window onto the shared block
  // rather than a copy of it: nothing mutates a compiled plan, and the
  // transfer-to-worker path — the one place a shared buffer would matter —
  // does not run for a precompiled performance. The regenerated forms allocate,
  // because their points were never in the block to point at.
  const waveform = geometry.subarray(0, h.waveform);
  let off = h.waveform;
  const take = (): number => {
    if (off >= geometry.length) throw new PerformanceFormatError('Geometry section is shorter than the edges that claim it.');
    return geometry[off++]!;
  };
  const edges: EdgeGeom[] = rawEdges.map((raw, i) => {
    const { g, ptsLen, length, ...rest } = raw;
    if (g === GEOM_RAW) {
      if (ptsLen === undefined || length === undefined) throw new PerformanceFormatError(`Edge ${i} carries its points but does not say how many.`);
      if (off + ptsLen > geometry.length) throw new PerformanceFormatError('Geometry section is shorter than the edges that claim it.');
      const pts = geometry.subarray(off, off + ptsLen);
      off += ptsLen;
      return { ...rest, pts, length };
    }
    const route = edgeRouteOf(rest, nodes);
    if (!route) throw new PerformanceFormatError(`Edge ${i} names a route that cannot be rebuilt from this plan.`);
    // `take` advances through the block once per sample the generator asks
    // for, so the lane form never has to be told how many values are its own.
    const made = runRoute(route, g === GEOM_LANE ? take : null);
    return { ...rest, pts: made.pts, length: round2(made.length) };
  });
  if (off !== geometry.length) throw new PerformanceFormatError('Geometry section length does not match the edges that claim it.');

  // Subjects are resolved here rather than as each event line arrives, because
  // the node records may not have been read yet when it did — the section order
  // in this file is chosen for what a failed read can report, not for this.
  const events: ChoreographyEvent[] = rawEvents.map((ev, i) => ({
    ...ev,
    subjectIds: ev.subjectIds.map((s) => {
      if (typeof s === 'string') return s;
      const nd = nodes[s];
      if (!nd) throw new PerformanceFormatError(`Event ${i} names node ${s}, which this plan does not have.`);
      return nd.sha;
    }),
  }));

  return {
    engine: h.engine,
    seed: h.seed,
    preset: h.preset,
    duration: h.duration,
    source: h.source,
    coverage: h.coverage,
    nodes,
    edges,
    threads,
    events,
    camera,
    timeMap,
    tempoMap,
    activity,
    waveform,
    eras,
    contributors,
    aggregates,
    refs,
    landmarks,
    transcript,
    bounds: h.bounds,
    planHash: h.planHash,
    stats: h.stats,
  };
}

/**
 * Hand back a stream of the file's actual bytes, compressed or not.
 *
 * `.gtperf.gz` is a gzip member served as a static file, and whether the
 * browser has already unwrapped it by the time `fetch` resolves depends on the
 * server: Vite's dev middleware sees the `.gz` suffix and sets
 * `Content-Encoding: gzip`, so the browser decodes it in transit and `res.body`
 * is plain bytes; GitHub Pages serves the same file as `application/gzip` with
 * no encoding header, so `res.body` is still compressed. The same build has to
 * open the same file in both places.
 *
 * Reading the header would be guessing at a convention. The first two bytes
 * are not a convention: 0x1f 0x8b is the gzip magic number, and a plan always
 * begins with `{`. So one chunk is taken, looked at, and put back.
 *
 * `parseArtifact` solves the same problem for datasets by sniffing a `Blob`;
 * this sniffs a stream instead, because buffering a whole plan into a `Blob`
 * to look at two bytes of it would give back the ceiling the format exists to
 * avoid.
 */
export async function gunzipIfNeeded(stream: ReadableStream<Uint8Array<ArrayBuffer>>): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
  const reader = stream.getReader();
  const first = await reader.read();
  const head = first.value ?? EMPTY;
  const compressed = head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
  const replayed = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      if (head.length) controller.enqueue(head);
      if (first.done) controller.close();
    },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });
  if (!compressed) return replayed;
  if (typeof DecompressionStream === 'undefined') throw new PerformanceFormatError('This browser cannot decompress gzip.');
  return replayed.pipeThrough(new DecompressionStream('gzip'));
}

/**
 * Undo the two transforms `binaryFrames` applied, in the opposite order.
 *
 * One pass, and one extra buffer the size of the block, which is freed as soon
 * as this returns. Doing it in place is not possible: the byte a value needs
 * is three quarters of the block away from where its own byte is being
 * written, so an in-place version would overwrite planes it has not read yet.
 */
function decodeGeometry(encoded: Uint8Array, floats: number): Float32Array {
  const buffer = new ArrayBuffer(floats * 4);
  const bits = new Uint32Array(buffer);
  const p1 = floats;
  const p2 = floats * 2;
  const p3 = floats * 3;
  for (let i = 0; i < floats; i++) {
    const delta = (encoded[i]! | (encoded[p1 + i]! << 8) | (encoded[p2 + i]! << 16) | (encoded[p3 + i]! << 24)) >>> 0;
    bits[i] = (delta + (i >= 2 ? bits[i - 2]! : 0)) >>> 0;
  }
  return new Float32Array(buffer);
}

/**
 * Does a shipped plan answer the question the viewer is actually asking?
 *
 * A precompiled performance is baked at one preset and one seed. Someone who
 * has chosen "extended", or whose system asks for reduced motion, or who has
 * pinned a duration, is asking for a different plan — and the honest response
 * is to compile that one rather than to play a different show and call it
 * theirs. The comparison is on the fields compilation actually reads.
 */
export function performanceMatchesRequest(h: { seed: string; preset: CompiledPerformance['preset'] }, seed: string, preset: CompiledPerformance['preset']): boolean {
  return (
    h.seed === seed &&
    h.preset.id === preset.id &&
    h.preset.version === preset.version &&
    h.preset.targetDuration === preset.targetDuration &&
    (h.preset.lengthBias ?? 1) === (preset.lengthBias ?? 1) &&
    h.preset.reducedMotion === preset.reducedMotion &&
    h.preset.aggregateAbove === preset.aggregateAbove
  );
}

/** The engine a plan was compiled by has to be the engine that will play it. */
export function performanceMatchesEngine(h: { engine: typeof ENGINE }): boolean {
  return (
    h.engine.modelSchemaVersion === ENGINE.modelSchemaVersion &&
    h.engine.analyzerVersion === ENGINE.analyzerVersion &&
    h.engine.layoutVersion === ENGINE.layoutVersion &&
    h.engine.choreographyVersion === ENGINE.choreographyVersion
  );
}

/** The `.gtperf` that would sit beside a given `.gittimeline.gz` catalog file. */
export function performanceFileFor(datasetFile: string): string {
  return datasetFile.replace(/\.gittimeline(\.gz)?$/, '') + PERF_EXTENSION;
}
