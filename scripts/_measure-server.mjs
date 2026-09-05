/**
 * Scratch static server for catalog measurement. Delete when the run is done.
 *
 * Serves the production bundle from `.measure-dist` and everything under
 * `public/` live, so a `.gtperf.gz` written by the plan builder while this is
 * running is picked up on the next click rather than at the next build.
 *
 *   node scripts/_measure-server.mjs [port]
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.argv[2] ?? 4290);
const roots = [resolve('.measure-dist'), resolve('public')];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.gz': 'application/octet-stream',
};

const find = (urlPath) => {
  // `normalize` collapses `..` before it is joined, so nothing outside a root
  // can be addressed however the request is spelled.
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^[\\/]+/, '');
  for (const root of roots) {
    const p = join(root, rel);
    if (p.startsWith(root) && existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
};

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const file = find(path === '/' ? 'index.html' : path) ?? join(roots[0], 'index.html');
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`measure server on http://localhost:${port}`));
