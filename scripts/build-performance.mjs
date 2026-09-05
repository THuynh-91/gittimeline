/**
 * Compile the catalog once, in CI, instead of once per visitor.
 *
 *   node --max-old-space-size=8192 scripts/build-performance.mjs [owner/name ...]
 *   node --max-old-space-size=8192 scripts/build-performance.mjs --all
 *
 * `build-clone-dataset.mjs` produces a `.gittimeline.gz` — raw commits. A
 * browser opening one then has to run `compilePerformance` on it, and that
 * compile *is* the wait: ripgrep 0.5s, React 2.0s, CPython 20s, VS Code 36s,
 * Kubernetes 142s, Rust 639s, and Linux and Chromium never finished at all.
 *
 * The compile is deterministic — the same dataset, preset and seed always
 * produce the same plan, which is what `planHash` exists to prove — so there
 * is no reason for it to happen in a browser at all. This runs it here and
 * writes the *result* as `<owner>-<name>.gtperf.gz` beside the dataset. The
 * browser then downloads a plan and plays it.
 *
 * Two things make that trustworthy rather than merely fast:
 *
 *  - The dataset is read back through `parseArtifact`, the same function the
 *    browser uses, so the input to compilation here is byte-for-byte the input
 *    it would have had there. A shortcut that read the ndjson directly would
 *    skip `buildDataset`, and the plan would then be a plan for a subtly
 *    different history.
 *  - Every file is re-read after it is written and the plan recomputed from
 *    what came back. If the round trip changed anything the fingerprint
 *    notices, the file is not kept.
 *
 * The cost of precompiling is that a plan is baked at one pace and one layout.
 * Change the choreography — `SECONDS_PER_NODE`, the aggregation budget, the
 * camera, anything that moves `ENGINE` — and every `.gtperf.gz` describes a
 * show this build no longer produces. The engine version is written into the
 * file and checked on load, so a stale plan is refused rather than played, but
 * refusing it means the catalog falls back to compiling in the browser until
 * this script is run again. Rebuild them in the same CI step that builds the
 * datasets.
 */
import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { basename, join, resolve } from 'node:path';
import { createServer } from 'vite';

const args = process.argv.slice(2);
/** Flags that take a value, so their value is never mistaken for a repository. */
const VALUED = new Set(['catalog', 'out', 'seed', 'length']);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const has = (n) => args.includes(`--${n}`);
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    if (VALUED.has(a.slice(2))) i++;
    continue;
  }
  positional.push(a);
}

const catalogDir = resolve(flag('catalog', 'public/catalog'));
const outDir = resolve(flag('out', catalogDir));
const force = has('force');
const slugs = positional;

if (!existsSync(catalogDir)) {
  console.error(`no catalog at ${catalogDir}`);
  process.exit(2);
}

const datasets = readdirSync(catalogDir)
  .filter((f) => f.endsWith('.gittimeline.gz'))
  .map((f) => ({ file: f, stem: f.replace(/\.gittimeline\.gz$/, ''), path: join(catalogDir, f) }))
  .filter((d) => !slugs.length || slugs.some((s) => d.stem.toLowerCase().includes(s.replace('/', '-').toLowerCase())))
  // Smallest first: a run that is going to run out of memory on Chromium
  // should still have written every file it could before it gets there.
  .sort((a, b) => statSync(a.path).size - statSync(b.path).size);

if (!datasets.length) {
  console.error(slugs.length ? `no catalog artifact matches ${slugs.join(', ')}` : 'no .gittimeline.gz files in the catalog');
  process.exit(2);
}

/* ---------- the app's own code, loaded through Vite ---------- */

// Same reasoning as the dataset builder: a second implementation of any of
// this would drift, and the drift would be invisible — the file would simply
// describe a different show.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'warn' });
const { parseArtifact } = await server.ssrLoadModule('/src/export/artifact.ts');
const { compilePerformance } = await server.ssrLoadModule('/src/choreography/compile.ts');
const { streamCompiledPerformance, readCompiledPerformance } = await server.ssrLoadModule('/src/export/performance.ts');
const { planHashOf } = await server.ssrLoadModule('/src/model/hash.ts');
const { DEFAULT_SETTINGS } = await server.ssrLoadModule('/src/app/store.ts');

/**
 * The plan a visitor who has changed nothing is asking for.
 *
 * `presetFromSettings` in the controller builds this from the live settings,
 * and it cannot be imported here because the module it lives in constructs a
 * renderer and an audio graph on load. So the parts that come from settings
 * are read from `DEFAULT_SETTINGS`, and the four constants the controller
 * writes literally are repeated below.
 *
 * If they ever disagree the result is a miss, not a lie: the loader compares
 * the preset baked into the file against the one it wants and compiles from
 * the dataset when they differ. The catalog would get slow again, visibly,
 * rather than quietly playing the wrong show.
 */
const seed = flag('seed', DEFAULT_SETTINGS.seed);
const LENGTH_BIAS = { brief: 0.62, natural: 1, extended: 1.55 };
const preset = {
  id: 'cinematic',
  version: 1,
  targetDuration: 0,
  lengthBias: LENGTH_BIAS[flag('length', DEFAULT_SETTINGS.lengthMode)],
  reducedMotion: has('reduced-motion') || DEFAULT_SETTINGS.reducedMotion,
  aggregateAbove: 900,
};
console.log(`preset ${JSON.stringify(preset)} seed "${seed}"\n`);

const secs = (t) => `${((Date.now() - t) / 1000).toFixed(1)}s`;
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const results = [];

for (const ds of datasets) {
  const out = join(outDir, `${ds.stem}.gtperf.gz`);
  const datasetBytes = statSync(ds.path).size;
  if (existsSync(out) && !force) {
    console.log(`${ds.stem}: exists, skipping (--force to rebuild)`);
    continue;
  }
  const rec = { stem: ds.stem, datasetBytes };
  const t0 = Date.now();
  try {
    /* ---------- 1. read the dataset exactly as the browser would ---------- */

    process.stdout.write(`${ds.stem}: reading ${mb(datasetBytes)}... `);
    const blob = new Blob([readFileSync(ds.path)]);
    const tRead = Date.now();
    const { dataset } = await parseArtifact(blob);
    rec.commits = dataset.commits.length;
    process.stdout.write(`${dataset.commits.length.toLocaleString('en-US')} commits in ${secs(tRead)}\n`);

    /* ---------- 2. compile ---------- */

    const tCompile = Date.now();
    let lastStage = '';
    const perf = compilePerformance(dataset, { preset, seed }, (stage) => {
      if (stage !== lastStage) {
        lastStage = stage;
        process.stdout.write(`  ${stage}${stage === 'done' ? '\n' : '... '}`);
      }
    });
    rec.compileMs = Date.now() - tCompile;
    rec.nodes = perf.nodes.length;
    rec.edges = perf.edges.length;
    rec.duration = perf.duration;
    rec.planHash = perf.planHash;
    console.log(`  compiled in ${(rec.compileMs / 1000).toFixed(1)}s: ${perf.nodes.length.toLocaleString('en-US')} nodes, ${perf.edges.length.toLocaleString('en-US')} edges, ${Math.round(perf.duration / 60)} min`);

    /* ---------- 3. write the plan ---------- */

    const datasetRef = { file: ds.file, bytes: datasetBytes, contentHash: dataset.contentHash, commits: dataset.commits.length };
    const tWrite = Date.now();
    const written = await writePerformance(out, perf, datasetRef);
    rec.bytes = statSync(out).size;
    rec.uncompressed = written.uncompressed;
    console.log(`  wrote ${mb(rec.bytes)} (${mb(written.uncompressed)} raw, ${mb(written.binary)} of it geometry) in ${secs(tWrite)}`);

    /* ---------- 4. read it back and prove it is the same plan ---------- */

    // The whole feature rests on this line. A precompiled performance is only
    // legitimate if it is the plan the browser would have computed, and the
    // fingerprint recomputed from what came off disk is the only thing that
    // actually establishes that.
    const tVerify = Date.now();
    const back = await readCompiledPerformance(gunzipStream(out));
    if (back.planHash !== perf.planHash) throw new Error(`carried plan hash changed: ${back.planHash} != ${perf.planHash}`);
    const recomputed = planHashOf(back);
    if (recomputed !== planHashOf(perf)) throw new Error(`round-tripped plan hashes to ${recomputed}, not ${planHashOf(perf)}`);
    if (back.nodes.length !== perf.nodes.length || back.edges.length !== perf.edges.length) throw new Error('round trip lost records');
    let ptsChecked = 0;
    for (let i = 0; i < perf.edges.length; i++) {
      const a = perf.edges[i].pts;
      const b = back.edges[i].pts;
      if (a.length !== b.length) throw new Error(`edge ${i} polyline length changed`);
      for (let k = 0; k < a.length; k++) {
        if (!Object.is(a[k], b[k])) throw new Error(`edge ${i} point ${k} changed: ${a[k]} != ${b[k]}`);
        ptsChecked++;
      }
    }
    console.log(`  verified in ${secs(tVerify)}: plan hash ${perf.planHash.slice(0, 16)}, ${ptsChecked.toLocaleString('en-US')} points identical`);
    rec.ok = true;

    /* ---------- 5. a sidecar of facts, beside the dataset's own ---------- */

    writeFileSync(out.replace(/\.gtperf\.gz$/, '.perf.json'), `${JSON.stringify({
      file: basename(out),
      dataset: ds.file,
      bytes: rec.bytes,
      datasetBytes,
      commits: rec.commits,
      nodes: rec.nodes,
      edges: rec.edges,
      durationSeconds: Math.round(perf.duration),
      compileSeconds: Math.round(rec.compileMs / 1000),
      planHash: perf.planHash,
      seed,
      preset,
      engine: perf.engine,
      builtAt: new Date().toISOString(),
    }, null, 2)}\n`);
  } catch (err) {
    rec.ok = false;
    rec.error = err instanceof Error ? err.message : String(err);
    console.log(`  FAILED after ${secs(t0)}: ${rec.error}`);
  }
  results.push(rec);
}

await server.close();

console.log('\n--- summary ---');
for (const r of results) {
  if (!r.ok) {
    console.log(`${r.stem.padEnd(26)} FAILED  ${r.error}`);
    continue;
  }
  const ratio = (r.bytes / r.datasetBytes).toFixed(2);
  console.log(
    `${r.stem.padEnd(26)} ${mb(r.datasetBytes).padStart(9)} dataset -> ${mb(r.bytes).padStart(9)} plan  (x${ratio})  ` +
      `${String(r.nodes).padStart(7)} nodes  ${(r.compileMs / 1000).toFixed(0)}s compile saved`,
  );
}
if (results.some((r) => !r.ok)) process.exitCode = 1;

/* ---------- helpers ---------- */

/**
 * Write the framed stream into a gzip member.
 *
 * The generator yields text lines and raw byte frames; both go to the same
 * stream, and back-pressure is respected on every write because a plan the
 * size of Rust's would otherwise buffer a hundred megabytes in memory waiting
 * for the compressor.
 */
async function writePerformance(path, perf, datasetRef) {
  const gzip = createGzip({ level: 9 });
  const sink = createWriteStream(path);
  const finished = new Promise((res, rej) => {
    sink.on('finish', res);
    sink.on('error', rej);
    gzip.on('error', rej);
  });
  gzip.pipe(sink);
  let uncompressed = 0;
  let binary = 0;
  for (const frame of streamCompiledPerformance(perf, datasetRef)) {
    const bytes = typeof frame === 'string' ? Buffer.byteLength(frame) : frame.byteLength;
    uncompressed += bytes;
    if (typeof frame !== 'string') binary += bytes;
    if (!gzip.write(frame)) await new Promise((r) => gzip.once('drain', r));
  }
  gzip.end();
  await finished;
  return { uncompressed, binary };
}

/** The file as the browser sees it: gunzipped bytes in a web `ReadableStream`. */
function gunzipStream(path) {
  return Readable.toWeb(createReadStream(path, { highWaterMark: 1 << 20 })).pipeThrough(new DecompressionStream('gzip'));
}
