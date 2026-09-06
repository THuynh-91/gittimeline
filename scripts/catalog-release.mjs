import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

export const sha256 = data => createHash('sha256').update(data).digest('hex');
const equalEngine = (a, b) => Object.keys(b).every(k => a?.[k] === b[k]);

/** Resolve only real files inside the supplied directory, including symlink checks. */
export function safeFile(root, name) {
  if (!name || name.split('/').some(p => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(p) || p.includes('..'))) throw new Error(`Unsafe resource: ${name}`);
  const base = realpathSync(root), file = realpathSync(resolve(base, name));
  if (!file.startsWith(`${base}${sep}`) || !statSync(file).isFile()) throw new Error(`Resource outside catalog: ${name}`);
  return file;
}

/** Produce an allowlist, never a recursive upload of the working catalog. */
export function collectRelease(catalogDir, packageDir, engine, smokeRepo = null) {
  const input = JSON.parse(readFileSync(safeFile(catalogDir, 'index.json'), 'utf8'));
  if (!Array.isArray(input.entries) || !input.entries.length) throw new Error('No complete catalog listing.');
  const files = new Map(), entries = [], slugs = new Set();
  const add = (root, name, expected) => {
    const path = safeFile(root, name), size = statSync(path).size;
    if (size > 96 * 1024 * 1024) throw new Error(`Playback resource too large: ${name}`);
    const data = readFileSync(path), hash = sha256(data);
    if (expected && (size !== expected.bytes || hash !== expected.hash)) throw new Error(`Integrity mismatch: ${name}`);
    if (files.has(name) && files.get(name).hash !== hash) throw new Error(`Conflicting resource: ${name}`);
    files.set(name, { name, path, hash, bytes: size });
    return data;
  };
  const selected = smokeRepo ? input.entries.filter(e => e.slug === smokeRepo) : input.entries;
  if (!selected.length) throw new Error('Requested smoke-test repository is not in the catalog.');
  for (const entry of selected) {
    if (slugs.has(entry.slug)) throw new Error('Duplicate catalog entry.');
    slugs.add(entry.slug);
    if (!entry.file?.endsWith('.gittimeline.gz')) throw new Error('Invalid catalog identity.');
    const dir = entry.file.replace(/\.gittimeline\.gz$/, '.pages');
    const manifest = JSON.parse(add(packageDir, `${dir}/manifest.json`));
    const p = manifest.summary;
    if (manifest.format !== 'gittimeline-catalog' || manifest.version !== 1 || !equalEngine(p?.engine, engine)) throw new Error(`Rebuild required: ${entry.slug}`);
    if (`${p.source.owner}/${p.source.name}`.toLowerCase() !== entry.slug.toLowerCase()) throw new Error('Catalog source mismatch.');
    if (!Number.isFinite(p.duration) || p.duration <= 0) throw new Error('Invalid duration.');
    const index = JSON.parse(gunzipSync(add(packageDir, `${dir}/${manifest.index.file}`, manifest.index), { maxOutputLength: 32 * 1024 * 1024 }));
    if (!Array.isArray(index) || !index.length) throw new Error('Empty resource index.');
    for (const r of index) {
      if (!['time', 'geometry', 'detail'].includes(r.kind) || !Number.isFinite(r.min) || !Number.isFinite(r.max) || r.min > r.max || !Number.isFinite(r.decodedBytes) || r.decodedBytes <= 0 || r.decodedBytes > 96 * 1024 * 1024) throw new Error(`Invalid resource descriptor: ${r.file}`);
      const raw = gunzipSync(add(packageDir, `${dir}/${r.file}`, r), { maxOutputLength: 96 * 1024 * 1024 });
      const end = raw.indexOf(10);
      if (end < 0 || end > 1024 * 1024) throw new Error('Invalid performance header.');
      const header = JSON.parse(raw.subarray(0, end));
      if (header.format !== 'gittimeline-perf' || header.planHash !== p.planHash || !equalEngine(header.engine, engine)) throw new Error(`Mixed performance revisions: ${r.file}`);
    }
    let covered = 0;
    const times = index.filter(r => r.kind === 'time').sort((a,b) => a.min - b.min);
    for (const r of times) { if (r.min > covered) throw new Error(`Missing interval: ${entry.slug}`); covered = Math.max(covered, r.max); }
    if (covered < p.duration || !index.some(r => r.kind === 'geometry')) throw new Error(`Incomplete package: ${entry.slug}`);
    add(packageDir, `${dir}/${manifest.transcript}`);
    if (entry.logo) add(catalogDir, entry.logo);
    // Old openSeconds measured a monolith; do not advertise it as streaming latency.
    const packageBytes = [...files.values()].filter(f => f.name.startsWith(`${dir}/`)).reduce((n,f) => n+f.bytes,0);
    entries.push({ ...entry, plan: null, planBytes: packageBytes, packageBytes, packaged: true, openSeconds: null,
      durationSeconds: Math.round(p.duration), nodes: p.stats.commits-p.stats.aggregatedCommits,
      years: manifest.years.slice(0,-1).map(([year,t],i) => [year, Math.max(0,manifest.years[i+1][1]-t)]),
      planHash: p.planHash, engine: p.engine });
  }
  const listing = Buffer.from(JSON.stringify({ ...input, engine, entries, ...(smokeRepo ? { preview: true } : {}) }, null, 2));
  const ordered = [...files.values()].sort((a,b) => a.name.localeCompare(b.name));
  const revision = sha256(JSON.stringify(ordered.map(f => [f.name,f.hash])) + sha256(listing));
  return { revision, listing, files: ordered, entries: entries.length, bytes: ordered.reduce((n,f) => n+f.bytes, listing.length) };
}
