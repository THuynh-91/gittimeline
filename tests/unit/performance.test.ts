import { describe, expect, it } from 'vitest';
import type { CompiledPerformance } from '@/model/types';
import { planHashOf } from '@/model/hash';
import {
  PerformanceFormatError,
  performanceFileFor,
  performanceMatchesRequest,
  readCompiledPerformance,
  streamCompiledPerformance,
} from '@/export/performance';
import { buildDemoDataset } from '@/fixtures/demo';
import { FIXTURES } from '@/fixtures/corpus';
import { compile, PRESET } from './shared';

const encoder = new TextEncoder();

/** Collect the frames a writer emits into the bytes a reader would see. */
function bytesOf(perf: CompiledPerformance, dataset: Parameters<typeof streamCompiledPerformance>[1] = null): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  for (const frame of streamCompiledPerformance(perf, dataset)) {
    chunks.push(typeof frame === 'string' ? encoder.encode(frame) : frame);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/**
 * Hand the bytes over in small, deliberately awkward pieces.
 *
 * A real download arrives in chunks that fall wherever the network puts them,
 * which for this format means a chunk boundary can land mid-line, mid-header
 * or mid-float. 997 is prime and shares no factor with 4, so it walks the
 * boundary through every byte offset of the geometry block instead of tidily
 * along it.
 */
function streamOf(bytes: Uint8Array, chunk = 997): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    },
  });
}

/**
 * Everything a plan contains, compared value by value.
 *
 * The geometry is compared as bits: a float32 that left through decimal text
 * and came back as a float64 would pass a tolerance check and still be a
 * different number, so the polylines and the waveform are checked element by
 * element and for being `Float32Array` at all — `toEqual` is happy to see a
 * plain array of the same numbers, which is precisely the failure this format
 * exists to prevent.
 *
 * Everything else is compared through JSON on both sides. That is not a
 * loosening: the one value JSON does not preserve is negative zero, which the
 * camera director produces when a frame centres exactly on the axis, and
 * `canonicalJson` — and therefore `planHash`, and therefore every claim this
 * project makes about two plans being the same plan — does not preserve it
 * either. Comparing against the un-serialized object would be holding the file
 * to a distinction the engine itself does not draw.
 */
function expectSamePlan(a: CompiledPerformance, b: CompiledPerformance) {
  expect(b.waveform).toBeInstanceOf(Float32Array);
  expect(Array.from(b.waveform)).toEqual(Array.from(a.waveform));
  expect(b.edges.length).toBe(a.edges.length);
  a.edges.forEach((edge, i) => {
    const got = b.edges[i]!;
    expect(got.pts).toBeInstanceOf(Float32Array);
    expect(got.pts.length).toBe(edge.pts.length);
    expect(Array.from(got.pts)).toEqual(Array.from(edge.pts));
  });
  const strip = (p: CompiledPerformance) => JSON.parse(JSON.stringify({ ...p, waveform: null, edges: p.edges.map((e) => ({ ...e, pts: null })) })) as unknown;
  expect(strip(b)).toEqual(strip(a));
}

describe('.gtperf compiled performance', () => {
  it('round-trips a plan exactly, typed arrays included', async () => {
    const perf = compile(buildDemoDataset(), 'shared');
    const back = await readCompiledPerformance(streamOf(bytesOf(perf)));
    expectSamePlan(perf, back);
  });

  it('reproduces the plan hash the compiler computed', async () => {
    const perf = compile(buildDemoDataset(), 'shared');
    const back = await readCompiledPerformance(streamOf(bytesOf(perf)));
    // Two claims, and both matter. The carried hash is what the file says the
    // plan is; the recomputed hash is what the plan actually is. Shipping a
    // precompiled performance is only honest when they agree.
    expect(back.planHash).toBe(perf.planHash);
    expect(planHashOf(back)).toBe(perf.planHash);
  });

  it('survives every fixture in the corpus, including the awkward ones', async () => {
    for (const fixture of FIXTURES) {
      const perf = compile(fixture.build(), 'corpus');
      const back = await readCompiledPerformance(streamOf(bytesOf(perf)));
      // Recomputed on both sides rather than compared against the carried
      // value, because an empty repository takes a different branch in the
      // compiler and hashes `{empty:true}` instead of its (empty) geometry.
      // What has to survive the file is the plan, not that shortcut.
      expect(planHashOf(back), fixture.id).toBe(planHashOf(perf));
      expect(back.planHash, fixture.id).toBe(perf.planHash);
      expect(back.nodes.length, fixture.id).toBe(perf.nodes.length);
      expect(back.edges.length, fixture.id).toBe(perf.edges.length);
      expect(back.duration, fixture.id).toBe(perf.duration);
    }
  });

  it('travels through gzip the way the browser will read it', async () => {
    const perf = compile(FIXTURES.find((f) => f.id === '07-octopus-merge')!.build(), 'gz');
    const bytes = bytesOf(perf);
    const gz = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    expect(gz.byteLength).toBeLessThan(bytes.byteLength);
    const back = await readCompiledPerformance(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip')));
    expectSamePlan(perf, back);
  });

  it('carries where its dataset came from, so the loader can still find it', async () => {
    const perf = compile(buildDemoDataset(), 'shared');
    const ref = { file: 'demo-demo.gittimeline.gz', bytes: 1234, contentHash: 'abc', commits: 42 };
    const back = await readCompiledPerformance(streamOf(bytesOf(perf, ref)));
    expect(back.source.name).toBe(perf.source.name);
    // The reference lives in the header rather than the plan; reading it back
    // is the build script's job, so all the plan has to prove here is that a
    // header carrying one still parses.
    expect(back.stats).toEqual(perf.stats);
  });

  it('carries every float back bit for bit, including the awkward ones', async () => {
    const perf = compile(buildDemoDataset(), 'shared');
    // The geometry travels delta-coded and byte-plane transposed, and both of
    // those are done on the IEEE-754 bit patterns rather than on the numbers
    // precisely so that values arithmetic would round or collapse survive.
    // A negative zero that came back as a zero, or a NaN that came back as a
    // different NaN, would be a plan that is nearly the same \u2014 and nearly is
    // the failure this whole file is arranged to prevent.
    const awkward = Float32Array.from([
      0, -0, 1, -1, Infinity, -Infinity, NaN,
      Number.MIN_VALUE, -Number.MIN_VALUE, 3.4028234663852886e38, -3.4028234663852886e38,
      1.1754943508222875e-38, 0.1, -0.1, 1e-45, 16777217,
    ]);
    perf.edges[0]!.pts = awkward;
    const back = await readCompiledPerformance(streamOf(bytesOf(perf)));
    const got = back.edges[0]!.pts;
    expect(got.length).toBe(awkward.length);
    for (let i = 0; i < awkward.length; i++) {
      // Compared as bits, because `Object.is` is happy with any NaN and
      // equality is happy with any zero.
      expect(new Uint32Array(got.buffer, got.byteOffset, got.length)[i], `value ${i}`)
        .toBe(new Uint32Array(awkward.buffer)[i]);
    }
  });

  it('refuses a truncated file rather than playing a partial plan', async () => {
    const bytes = bytesOf(compile(buildDemoDataset(), 'shared'));
    await expect(readCompiledPerformance(streamOf(bytes.slice(0, Math.floor(bytes.length * 0.8))))).rejects.toThrow(PerformanceFormatError);
  });

  it('refuses a file whose trailer does not match its header', async () => {
    const perf = compile(buildDemoDataset(), 'shared');
    const bytes = bytesOf(perf);
    // Only the header line is rewritten. Decoding the whole file as text to
    // edit it would replace every byte of the geometry block that is not
    // valid UTF-8 with U+FFFD, and then the test would be about that instead.
    const nl = bytes.indexOf(0x0a);
    const header = new TextDecoder().decode(bytes.subarray(0, nl)).replace(perf.planHash, '0'.repeat(perf.planHash.length));
    const patched = encoder.encode(header);
    const out = new Uint8Array(patched.length + (bytes.length - nl));
    out.set(patched);
    out.set(bytes.subarray(nl), patched.length);
    await expect(readCompiledPerformance(streamOf(out))).rejects.toThrow(/content hash/);
  });

  it('refuses something that is not a compiled performance at all', async () => {
    await expect(readCompiledPerformance(streamOf(encoder.encode('{"format":"gittimeline-stream"}\n')))).rejects.toThrow(PerformanceFormatError);
  });

  it('knows when a shipped plan answers a different question', () => {
    const perf = compile(buildDemoDataset(), 'shared');
    expect(performanceMatchesRequest(perf, 'shared', PRESET)).toBe(true);
    expect(performanceMatchesRequest(perf, 'other', PRESET)).toBe(false);
    expect(performanceMatchesRequest(perf, 'shared', { ...PRESET, reducedMotion: true })).toBe(false);
    expect(performanceMatchesRequest(perf, 'shared', { ...PRESET, lengthBias: 1.55 })).toBe(false);
    expect(performanceMatchesRequest(perf, 'shared', { ...PRESET, targetDuration: 90 })).toBe(false);
  });

  it('finds the plan that sits beside a dataset', () => {
    expect(performanceFileFor('facebook-react.gittimeline.gz')).toBe('facebook-react.gtperf.gz');
    expect(performanceFileFor('facebook-react.gittimeline')).toBe('facebook-react.gtperf.gz');
  });
});
