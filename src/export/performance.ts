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
 * The floats are laid out in one contiguous block — the waveform, then every
 * edge's polyline in index order — and each edge line carries the length of
 * its own slice. That keeps the header small: an index of 354,672 offsets
 * would have re-created the giant-string problem in the one line that has to
 * be read first.
 *
 * ## Why the geometry is not written as it sits in memory
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

export const PERF_SCHEMA_VERSION = 1;
export const PERF_MAGIC = 'gittimeline-perf';
/** Suffix the build writes and the loader looks for, next to the dataset. */
export const PERF_EXTENSION = '.gtperf.gz';

/**
 * How the dataset this plan came from can still be reached.
 *
 * The plan is enough to *watch* a history, but not to inspect one: commit
 * subjects, parent lists and GitHub links live in the dataset and nothing in a
 * compiled performance carries them. So the file records where its dataset is
 * and how big it is, and the loader decides — after the first frame is already
 * on screen — whether fetching it in the background is worth the bytes.
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

/** An edge minus its polyline, which travels in the binary section. */
export type SerializedEdge = Omit<EdgeGeom, 'pts'> & { ptsLen: number };

/**
 * One body line. The tag is first so a reader can dispatch on it without
 * parsing the payload twice, and single letters because there are up to
 * 600,000 of these in one file.
 */
export type PerfRecord =
  | { t: 'n'; v: NodeGeom }
  | { t: 'e'; v: SerializedEdge }
  | { t: 't'; v: ThreadGeom }
  | { t: 'v'; v: ChoreographyEvent }
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
 * Emit a compiled performance frame by frame.
 *
 * A generator of `string | Uint8Array` rather than a buffer, so the caller
 * decides where the frames go — a gzip stream on disk in CI — without either
 * side holding the whole file. Strings are UTF-8 lines; byte arrays are raw
 * payload and are never decoded.
 */
export function* streamCompiledPerformance(perf: CompiledPerformance, dataset: PerfDatasetRef | null = null): Generator<string | Uint8Array> {
  requireLittleEndian();
  let floats = perf.waveform.length;
  for (const e of perf.edges) floats += e.pts.length;

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
  for (const v of perf.events) yield `${JSON.stringify({ t: 'v', v })}\n`;
  for (const v of perf.camera) yield `${JSON.stringify({ t: 'c', v })}\n`;
  for (const v of perf.nodes) yield `${JSON.stringify({ t: 'n', v })}\n`;
  for (const e of perf.edges) {
    const { pts, ...rest } = e;
    const v: SerializedEdge = { ...rest, ptsLen: pts.length };
    yield `${JSON.stringify({ t: 'e', v })}\n`;
  }

  const marker: PerfBinaryMarker = { t: 'bin', floats, codec: 'd2s' };
  yield `${JSON.stringify(marker)}\n`;
  yield* binaryFrames(perf);

  const trailer: PerfTrailer = { t: 'end', planHash: perf.planHash, contentHash: perfContentHash(perf.planHash) };
  yield `${JSON.stringify(trailer)}\n`;
}

/** Every float in the block, in the order the reader will put them back. */
function* geometrySources(perf: CompiledPerformance): Generator<Float32Array> {
  yield perf.waveform;
  for (const e of perf.edges) yield e.pts;
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
function* binaryFrames(perf: CompiledPerformance): Generator<Uint8Array> {
  const buf = new Uint8Array(BINARY_CHUNK);
  let used = 0;
  for (let plane = 0; plane < 4; plane++) {
    const shift = plane * 8;
    // The two bit patterns two and one places back; both start at zero so the
    // first pair of values is written as-is.
    let back2 = 0;
    let back1 = 0;
    for (const src of geometrySources(perf)) {
      const bits = new Uint32Array(src.buffer, src.byteOffset, src.length);
      for (let i = 0; i < bits.length; i++) {
        const cur = bits[i]!;
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
  const events: ChoreographyEvent[] = [];
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
      case 'v': events.push(rec.v); return;
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
    n: nodes.length, e: rawEdges.length, t: threads.length, v: events.length, c: camera.length,
    m: timeMap.length, p: tempoMap.length, a: activity.length, r: eras.length, i: contributors.length,
    g: aggregates.length, f: refs.length, l: landmarks.length, s: transcript.length,
  };
  for (const key of Object.keys(got) as Array<keyof PerfCounts>) {
    if (got[key] !== h.counts[key]) {
      throw new PerformanceFormatError(`Compiled performance is incomplete: ${got[key].toLocaleString('en-US')} of ${h.counts[key].toLocaleString('en-US')} "${key}" records.`);
    }
  }

  // Hand each edge a window onto the shared block rather than a copy of it.
  // Rust's polylines are 45 MB; copying them would double that for the length
  // of the load and buy nothing, since nothing mutates a compiled plan and
  // the transfer-to-worker path — the one place a shared buffer would
  // matter — does not run for a precompiled performance.
  const waveform = geometry.subarray(0, h.waveform);
  let off = h.waveform;
  const edges: EdgeGeom[] = rawEdges.map((raw) => {
    const { ptsLen, ...rest } = raw;
    const pts = geometry.subarray(off, off + ptsLen);
    off += ptsLen;
    return { ...rest, pts };
  });
  if (off !== geometry.length) throw new PerformanceFormatError('Geometry section length does not match the edges that claim it.');

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
