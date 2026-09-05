import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompiledPerformance, EdgeGeom, PlaybackPreset } from '@/model/types';
import { planHashOf } from '@/model/hash';
import {
  geometryBreakdown,
  PERF_SCHEMA_VERSION,
  PerformanceFormatError,
  performanceFileFor,
  performanceMatchesRequest,
  readCompiledPerformance,
  streamCompiledPerformance,
} from '@/export/performance';
import { parseArtifact } from '@/export/artifact';
import { compilePerformance } from '@/choreography/compile';
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

/**
 * Compare two polylines the way the format now has to be right: value by
 * value, on the bit patterns, and the arc length beside them.
 *
 * Length matters as much as the points do. It is no longer carried in the file
 * for a regenerated edge — it comes back out of the generator with the points —
 * and it is what every body on stage travels along, so an edge whose points
 * came back perfectly and whose length did not would move at the wrong speed
 * for its whole journey.
 */
function expectSameEdge(got: EdgeGeom, want: EdgeGeom, where: string) {
  expect(got.pts, where).toBeInstanceOf(Float32Array);
  expect(got.pts.length, `${where} point count`).toBe(want.pts.length);
  const a = new Uint32Array(got.pts.buffer, got.pts.byteOffset, got.pts.length);
  const b = new Uint32Array(want.pts.buffer, want.pts.byteOffset, want.pts.length);
  for (let i = 0; i < b.length; i++) expect(a[i], `${where} value ${i}`).toBe(b[i]);
  expect(got.length, `${where} arc length`).toBe(want.length);
}

describe('.gtperf regenerated geometry', () => {
  it('rebuilds polylines rather than carrying them, across the whole corpus', () => {
    for (const fixture of [...FIXTURES, { id: 'demo', build: buildDemoDataset }]) {
      const perf = compile(fixture.build(), 'corpus');
      if (!perf.edges.length) continue;
      const geo = geometryBreakdown(perf);
      // Not "smaller" — *regenerated*. An edge that stopped matching its route
      // would still round-trip; it would just have quietly put every one of its
      // points back into the file, and nothing else in this suite would notice.
      expect(geo.raw, `${fixture.id} edges that had to carry their points`).toBe(0);
      expect(geo.curve + geo.flat + geo.lane, fixture.id).toBe(perf.edges.length);
      // The waveform is always 720 floats and always carried, which on a
      // nine-commit fixture is most of the block; the claim being made is
      // about the polylines, so it is measured on the polylines.
      expect(geo.floats - perf.waveform.length, `${fixture.id} polyline floats kept`).toBeLessThan((geo.ptsFloats - perf.waveform.length) * 0.5);
    }
  });

  it('returns every regenerated point and arc length exactly', async () => {
    // The octopus fixture is the awkward one: a boundary commit whose unloaded
    // parents fan out around it is the only route rebuilt from a parent slot
    // rather than from two node positions.
    for (const id of ['07-octopus-merge', '02-simple-split-merge', '01-linear']) {
      const perf = compile(FIXTURES.find((f) => f.id === id)!.build(), 'corpus');
      expect(geometryBreakdown(perf).raw, id).toBe(0);
      const back = await readCompiledPerformance(streamOf(bytesOf(perf)));
      expect(back.edges.length, id).toBe(perf.edges.length);
      perf.edges.forEach((edge, i) => expectSameEdge(back.edges[i]!, edge, `${id} edge ${i} (${edge.kind})`));
    }
  });

  it('carries the points of a polyline it cannot rebuild, rather than guessing', async () => {
    const perf = compile(buildDemoDataset(), 'shared');
    // A polyline no route would ever produce. The writer finds that out by
    // trying it, and falls back; the alternative — trusting the recipe and
    // regenerating something else — is the failure this whole design avoids.
    perf.edges[0]!.pts = Float32Array.from([1.5, -2.5, 3.5, -4.5, 5.5, -6.5]);
    perf.edges[0]!.length = 12.34;
    expect(geometryBreakdown(perf).raw).toBe(1);
    const back = await readCompiledPerformance(streamOf(bytesOf(perf)));
    expectSameEdge(back.edges[0]!, perf.edges[0]!, 'unrebuildable edge');
    expectSamePlan(perf, back);
  });

  it('puts back the subjects that travelled as node indices', async () => {
    const perf = compile(buildDemoDataset(), 'shared');
    const shas = new Set(perf.nodes.map((n) => n.sha));
    // Both kinds have to be present for this to mean anything: subjects that
    // name a node and are rewritten, and subjects that do not and are not.
    const all = perf.events.flatMap((e) => e.subjectIds);
    expect(all.some((s) => shas.has(s))).toBe(true);
    expect(all.some((s) => s !== '' && !shas.has(s))).toBe(true);
    const back = await readCompiledPerformance(streamOf(bytesOf(perf)));
    expect(back.events.map((e) => e.subjectIds)).toEqual(perf.events.map((e) => e.subjectIds));
  });

  it('refuses a plan written to an older schema', async () => {
    const perf = compile(buildDemoDataset(), 'shared');
    const bytes = bytesOf(perf);
    const nl = bytes.indexOf(0x0a);
    const header = new TextDecoder().decode(bytes.subarray(0, nl)).replace(`"schemaVersion":${PERF_SCHEMA_VERSION}`, '"schemaVersion":1');
    const patched = encoder.encode(header);
    const out = new Uint8Array(patched.length + (bytes.length - nl));
    out.set(patched);
    out.set(bytes.subarray(nl), patched.length);
    await expect(readCompiledPerformance(streamOf(out))).rejects.toThrow(/schema version 1/);
  });
});

/**
 * The claim, on a history somebody actually has.
 *
 * Every other test here compiles a fixture and reads back what it just wrote,
 * in one process. That proves the format round-trips. It does not prove the
 * thing the catalog actually rests on: that the file sitting in
 * `public/catalog` — written by a separate build, from a real repository — is
 * the plan this build would compute if it opened the dataset beside it.
 *
 * `public/catalog` is generated and gitignored, so this cannot be a hard
 * requirement of the suite; it runs when a catalog is there and reports itself
 * skipped when it is not. `scripts/build-performance.mjs` makes the same
 * comparison on every file it writes and refuses to keep one that fails, which
 * is where the guarantee lives for the files that ship.
 */
const REAL = 'public/catalog/BurntSushi-ripgrep';
const haveReal = existsSync(`${REAL}.gittimeline.gz`) && existsSync(`${REAL}.gtperf.gz`) && existsSync(`${REAL}.perf.json`);

describe.skipIf(!haveReal)('.gtperf against a real history', () => {
  it('loads to the plan hash the browser would have compiled', async () => {
    // The sidecar rather than a repeat of the build's constants: a plan
    // compiled at a different preset is a different plan, and hard-coding one
    // here would turn a preset mismatch into a confusing failure instead of a
    // correct one.
    const sidecar = JSON.parse(readFileSync(`${REAL}.perf.json`, 'utf8')) as { seed: string; preset: PlaybackPreset; planHash: string };
    const bytesOfFile = (name: string) => new Uint8Array(readFileSync(name));
    const { dataset } = await parseArtifact(new Blob([bytesOfFile(`${REAL}.gittimeline.gz`)]));
    const fresh = compilePerformance(dataset, { preset: sidecar.preset, seed: sidecar.seed });
    const shipped = await readCompiledPerformance(new Blob([bytesOfFile(`${REAL}.gtperf.gz`)]).stream().pipeThrough(new DecompressionStream('gzip')));

    expect(shipped.planHash).toBe(fresh.planHash);
    expect(planHashOf(shipped)).toBe(planHashOf(fresh));
    expect(shipped.planHash).toBe(sidecar.planHash);
    expect(shipped.edges.length).toBe(fresh.edges.length);
    fresh.edges.forEach((edge, i) => expectSameEdge(shipped.edges[i]!, edge, `ripgrep edge ${i} (${edge.kind})`));
    expectSamePlan(fresh, shipped);
  });
});
