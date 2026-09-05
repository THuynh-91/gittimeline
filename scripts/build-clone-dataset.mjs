/**
 * Build a dataset by cloning, not by asking.
 *
 *   node scripts/build-clone-dataset.mjs <owner/name> [--out DIR] [--max N]
 *
 * The GitHub REST API hands back a hundred commits per request. Linux has
 * 1,481,850 of them, which is 14,819 requests — hours of waiting and three
 * times an authenticated user's hourly allowance. A commits-only clone of the
 * same history takes about four minutes, and `git log` reads the whole graph
 * out of it in fourteen seconds:
 *
 *     git clone --bare --filter=tree:0    # commit objects, no file data
 *     git log --format=...                # 1.48M records
 *
 * `--filter=tree:0` is what makes this cheap: it asks the server for commit
 * objects and nothing else, so none of the source code is ever transferred.
 * The shape of the history is all this project ever needed.
 *
 * This runs in CI, not in anyone's browser, and the artifact it writes ships
 * as a static file — so opening a pre-mapped repository costs one download and
 * no API requests at all.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
if (!slug || !/^[\w.-]+\/[\w.-]+$/.test(slug)) {
  console.error('usage: node scripts/build-clone-dataset.mjs <owner/name> [--out DIR] [--max N] [--work DIR]');
  process.exit(2);
}
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const [owner, name] = slug.split('/');
const outDir = resolve(flag('out', 'public/catalog'));
const maxCommits = Number(flag('max', '0')) || 0;
const workDir = resolve(flag('work', join(tmpdir(), 'gittimeline-clones')));

const RS = 0x1e;
const SEP = String.fromCharCode(0x1f);
const bare = join(workDir, `${owner}-${name}.git`);

mkdirSync(workDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

/* ---------- 1. clone commits only ---------- */

if (!existsSync(bare)) {
  console.log(`cloning ${slug} (commits only)...`);
  const t0 = Date.now();
  const r = spawnSync('git', ['clone', '--bare', '--filter=tree:0', '--no-tags', `https://github.com/${slug}`, bare], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('clone failed');
    process.exit(1);
  }
  console.log(`cloned in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
} else {
  console.log(`reusing ${bare}`);
}

const git = (...a) => execFileSync('git', ['--git-dir', bare, ...a], { encoding: 'utf8', maxBuffer: 1 << 30 }).trim();
const head = git('rev-parse', 'HEAD');
let defaultBranch = 'master';
try {
  defaultBranch = git('symbolic-ref', '--short', 'HEAD').replace(/^origin\//, '');
} catch {
  /* a bare clone without a symbolic HEAD still has a tip */
}
const total = Number(git('rev-list', '--count', 'HEAD'));
console.log(`${slug}: ${total.toLocaleString('en-US')} commits, tip ${head.slice(0, 8)} on ${defaultBranch}`);

/* ---------- 2. read the graph ---------- */

// Newest-first, so a bounded build keeps a contiguous run ending at the tip —
// the same shape the API path produces when it runs out of budget. A hole in
// the middle would be a lie about the topology.
const logFile = join(workDir, `${owner}-${name}.raw`);
console.log('reading the commit graph...');
const t1 = Date.now();
const fd = openSync(logFile, 'w');
execFileSync(
  'git',
  ['--git-dir', bare, 'log', `--format=%H${SEP}%P${SEP}%an${SEP}%aE${SEP}%aI${SEP}%cI${SEP}%s%x1e`, ...(maxCommits ? ['-n', String(maxCommits)] : []), 'HEAD'],
  { stdio: ['ignore', fd, 'inherit'], maxBuffer: 1 << 30 },
);
console.log(`read in ${((Date.now() - t1) / 1000).toFixed(1)}s, ${(statSync(logFile).size / 1e6).toFixed(0)} MB`);

const raw = [];
{
  const dec = new TextDecoder();
  let buf = Buffer.alloc(0);
  for await (const chunk of createReadStream(logFile, { highWaterMark: 1 << 22 })) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    let start = 0;
    let idx;
    while ((idx = buf.indexOf(RS, start)) !== -1) {
      // `git log` writes a newline after every entry as well as our record
      // separator, so each record after the first arrives with a leading "\n"
      // welded onto the sha. Left in place it fails the sha check and the whole
      // history normalizes down to a single commit.
      const rec = dec.decode(buf.subarray(start, idx)).trim();
      start = idx + 1;
      if (!rec) continue;
      const f = rec.split(SEP);
      if (f.length < 7) continue;
      raw.push({
        sha: f[0],
        parents: f[1] ? f[1].split(' ').filter(Boolean) : [],
        message: f[6],
        author: { name: f[2], email: f[3], date: f[4] },
        committer: { name: f[2], email: f[3], date: f[5] },
        url: `https://github.com/${slug}/commit/${f[0]}`,
      });
    }
    buf = buf.subarray(start);
  }
}
console.log(`parsed ${raw.length.toLocaleString('en-US')} records`);

/* ---------- 3. tags, so releases show up ---------- */

// Tags arrive in a second fetch rather than with the clone. `--no-tags` on the
// clone is deliberate — pulling every tag's history alongside the branch is a
// large part of what makes a naive clone slow — but it left every pre-fetched
// repository with no releases at all, which is one of the things the
// visualization is supposed to show.
//
// The filter has to be repeated on the fetch. Without it, git tries to repack
// local links against objects a partial clone does not have and dies with
// "BUG: should_include_obj should only be called on existing objects". With
// it, React's 174 tags arrive in 1.4 seconds.
try {
  execFileSync('git', ['--git-dir', bare, 'fetch', '--filter=tree:0', '--no-write-fetch-head', 'origin', 'refs/tags/*:refs/tags/*'], { stdio: 'ignore' });
} catch {
  /* a repository with no tags, or a fetch that failed: neither is fatal */
}

const rawRefs = [{ kind: 'branch', name: defaultBranch, targetSha: head, sourceUrl: `https://github.com/${slug}/tree/${defaultBranch}` }];
try {
  const known = new Set(raw.map((r) => r.sha.toLowerCase()));
  for (const line of git('for-each-ref', '--format=%(refname:short) %(objectname) %(*objectname)', 'refs/tags').split('\n')) {
    const [tag, obj, deref] = line.trim().split(' ');
    const target = (deref || obj || '').toLowerCase();
    if (!tag || !known.has(target)) continue;
    rawRefs.push({ kind: 'tag', name: tag, targetSha: target, sourceUrl: `https://github.com/${slug}/releases/tag/${tag}` });
  }
} catch {
  /* a repository with no tags is not an error */
}
console.log(`${rawRefs.length - 1} tags land on commits we have`);

/* ---------- 4. normalize through the app's own code ---------- */

// Loaded through Vite so the artifact is built by exactly the same normalizer
// the browser uses. A second implementation here would drift, and the drift
// would be invisible: the artifact would simply describe a different history.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'warn' });
const { buildDataset } = await server.ssrLoadModule('/src/model/dataset.ts');

const source = {
  provider: 'github',
  owner,
  name,
  canonicalUrl: `https://github.com/${slug}`,
  apiUrl: `https://api.github.com/repos/${slug}`,
  defaultBranch,
  selectedRef: defaultBranch,
  selectedTipSha: head.toLowerCase(),
  fetchedAt: new Date().toISOString(),
};

console.log('normalizing...');
const t2 = Date.now();
const dataset = buildDataset(source, raw, rawRefs, { reportedCommitCount: total, truncated: raw.length < total });
const { streamArtifact } = await server.ssrLoadModule('/src/export/stream.ts');
await server.close();
console.log(`normalized ${dataset.commits.length.toLocaleString('en-US')} commits in ${((Date.now() - t2) / 1000).toFixed(1)}s`);
if (dataset.commits.length < raw.length) {
  console.log(`  NOTE: the normalizer capped this at ${dataset.commits.length.toLocaleString('en-US')} (LIMITS.maxCommits)`);
}

/* ---------- 5. write the artifact ---------- */

// Written a line at a time rather than as one document. `JSON.stringify` on a
// whole large history throws `RangeError: Invalid string length` — Linux is
// about 600 MB of JSON and a JavaScript string tops out near 512 MB — so LLVM,
// Linux and Chromium all failed exactly here, having normalized perfectly.
// Appending costs nothing and has no ceiling: the largest string built below is
// one commit.
const file = join(outDir, `${owner}-${name}.gittimeline.gz`);
const gzip = createGzip({ level: 9 });
const sink = createWriteStream(file);
const finished = new Promise((res, rej) => {
  sink.on('finish', res);
  sink.on('error', rej);
  gzip.on('error', rej);
});
gzip.pipe(sink);

let uncompressed = 0;
let lines = 0;
for (const line of streamArtifact(dataset)) {
  uncompressed += Buffer.byteLength(line);
  lines++;
  // Respect back-pressure, or a history this size buffers gigabytes in memory
  // to avoid a ceiling it has just escaped.
  if (!gzip.write(line)) await new Promise((r) => gzip.once('drain', r));
}
gzip.end();
await finished;
const gzBytes = statSync(file).size;

// A sidecar of facts, written by the thing that actually knows them.
// The catalog index used to be assembled by loading every artifact in a
// browser and reading the numbers back off the page, which meant a repository
// too large to open in ninety seconds was also a repository absent from the
// catalog — the two have nothing to do with each other. The counts come from
// here; the thumbnail is a separate, optional step that may fail on its own.
writeFileSync(file.replace(/\.gittimeline\.gz$/, '.meta.json'), `${JSON.stringify({
  slug,
  file: `${owner}-${name}.gittimeline.gz`,
  bytes: gzBytes,
  commits: dataset.commits.length,
  merges: dataset.commits.reduce((n, c) => n + (c.flags.isMerge ? 1 : 0), 0),
  contributors: dataset.contributors.length,
  refs: dataset.refs.length,
  coverage: dataset.coverage.completeness,
  reportedCommitCount: total,
  tipSha: head.toLowerCase(),
  builtAt: new Date().toISOString(),
}, null, 2)}
`);

console.log(`\n${file}`);
console.log(`  ${lines.toLocaleString('en-US')} lines, ${(uncompressed / 1e6).toFixed(1)} MB ndjson -> ${(gzBytes / 1e6).toFixed(1)} MB gzipped`);
console.log(`  ${dataset.commits.length.toLocaleString('en-US')} commits, ${dataset.contributors.length.toLocaleString('en-US')} contributors, ${dataset.refs.length} refs`);
console.log(`  coverage: ${dataset.coverage.summary}`);
