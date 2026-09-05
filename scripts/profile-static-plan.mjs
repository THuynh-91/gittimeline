import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { readCompiledPerformance } = await server.ssrLoadModule('/src/export/performance.ts');
  for (const slug of process.argv.slice(2)) {
    const started = performance.now();
    const p = await readCompiledPerformance(Readable.toWeb(createReadStream(`public/catalog/${slug.replace('/', '-')}.gtperf.gz`).pipe(createGunzip())));
    const bounds = p.edges.map(e => {
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < e.pts.length; i += 2) { min = Math.min(min, e.pts[i]); max = Math.max(max, e.pts[i]); }
      return [min, max];
    });
    const samples = [0, .05, .4, .8, .99].map(f => {
      const t = p.duration * f;
      const cue = p.camera.find(c => c.time >= t) ?? p.camera.at(-1);
      const lo = cue.x - 6000, hi = cue.x + 6000;
      let edges = 0, floats = 0, maxFloats = 0;
      p.edges.forEach((e, i) => { if (bounds[i][1] >= lo && bounds[i][0] <= hi) { edges++; floats += e.pts.length; maxFloats = Math.max(maxFloats, e.pts.length); } });
      return { t, x: cue.x, nodes: p.nodes.filter(n => n.x >= lo && n.x <= hi).length, edges, geometryMB: floats * 4 / 1e6, maxRouteMB: maxFloats * 4 / 1e6 };
    });
    console.log(JSON.stringify({ slug, decodeSeconds: (performance.now() - started) / 1000, bounds: p.bounds, samples, metadataMB: Object.fromEntries(['aggregates', 'timeMap', 'camera', 'events', 'contributors', 'threads'].map(k => [k, Buffer.byteLength(JSON.stringify(p[k])) / 1e6])) }));
  }
} finally { await server.close(); }
