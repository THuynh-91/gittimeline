/**
 * Time each compile stage on a real dataset, in Node, where a profiler can
 * actually be attached and a stall is a number rather than a spinner.
 */
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createServer } from 'vite';

const path = process.argv[2];

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { buildDataset } = await server.ssrLoadModule('/src/model/dataset.ts');
const { compilePerformance } = await server.ssrLoadModule('/src/choreography/compile.ts');

// Read the streamed artifact back the same way the browser does.
const commits = [];
const refs = [];
const contributors = [];
let header = null;

await new Promise((resolve, reject) => {
  let tail = '';
  const src = createReadStream(path).pipe(createGunzip());
  src.on('data', (chunk) => {
    tail += chunk.toString('utf8');
    let nl = tail.indexOf('\n');
    while (nl !== -1) {
      const line = tail.slice(0, nl);
      tail = tail.slice(nl + 1);
      nl = tail.indexOf('\n');
      if (!line) continue;
      const o = JSON.parse(line);
      if (!header) { header = o; continue; }
      if (o.t === 'c') commits.push(o.v);
      else if (o.t === 'r') refs.push(o.v);
      else if (o.t === 'p') contributors.push(o.v);
    }
  });
  src.on('end', resolve);
  src.on('error', reject);
});
console.log(`read ${commits.length.toLocaleString('en-US')} commits`);

const t0 = Date.now();
const dataset = buildDataset(
  header.source,
  commits.map((c) => ({
    sha: c.sha,
    parents: c.parentShas ?? [],
    message: c.messageSubject ?? '',
    author: { key: c.authorIdentityId, date: c.authoredAtRaw },
    committer: c.committerIdentityId ? { key: c.committerIdentityId, date: c.committedAtRaw } : null,
    url: c.githubUrl ?? null,
  })),
  refs.map((r) => ({ kind: r.kind, name: r.name, targetSha: r.targetSha, sourceUrl: r.sourceUrl })),
  {},
);
console.log(`normalized in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

let last = Date.now();
const stages = [];
const perf = compilePerformance(
  dataset,
  { preset: { id: 'natural', version: 1, targetDuration: 0, reducedMotion: false, aggregateAbove: 0 }, seed: 'profile' },
  (stage) => {
    const now = Date.now();
    stages.push({ stage, sinceLast: +((now - last) / 1000).toFixed(2) });
    console.log(`  -> ${stage.padEnd(10)} previous stage took ${((now - last) / 1000).toFixed(2)}s`);
    last = now;
  },
);
console.log(`\nnodes ${perf.nodes.length.toLocaleString('en-US')}  edges ${perf.edges.length.toLocaleString('en-US')}  threads ${perf.threads.length.toLocaleString('en-US')}  duration ${(perf.duration / 60).toFixed(1)} min`);
await server.close();
