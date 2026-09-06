// Read-only infrastructure smoke test. No Cloudflare credentials required.
// node scripts/check-catalog-host.mjs [https://catalog.example.com]
import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';

const base = process.argv[2] ?? 'https://gitdance-data.cruxpack.io';
const url = new URL('health/setup-v1.json', `${base.replace(/\/$/, '')}/`);
const origins = ['https://thuynh-91.github.io', 'http://localhost:5173'];
let cacheHit = false;
for (const origin of origins) {
  const response = await fetch(url, { headers: { Origin: origin }, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await response.json(), {
    service: 'gitdance-catalog', schema: 1, purpose: 'public storage connectivity test',
  });
  const cache = response.headers.get('cf-cache-status');
  cacheHit ||= cache === 'HIT';
  console.log(`GET ${origin}: 200, expected JSON and CORS; cache=${cache}`);
}
const head = await fetch(url, { method: 'HEAD', headers: { Origin: origins[0] }, signal: AbortSignal.timeout(15000) });
assert.equal(head.status, 200);
assert.equal(head.headers.get('access-control-allow-origin'), origins[0]);
console.log('HEAD: 200, expected CORS');

const other = await fetch(url, { headers: { Origin: 'https://unrelated.example' }, signal: AbortSignal.timeout(15000) });
assert.equal(other.status, 200); // Public objects are not protected by CORS.
assert.equal(other.headers.get('access-control-allow-origin'), null);
await other.arrayBuffer();
console.log('Unlisted origin: public GET works, browser CORS access is not granted');

const preflight = await fetch(url, {
  method: 'OPTIONS',
  headers: { Origin: origins[0], 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' },
  signal: AbortSignal.timeout(15000),
});
assert.ok(preflight.ok, `Preflight returned ${preflight.status}`);
assert.equal(preflight.headers.get('access-control-allow-origin'), origins[0]);
assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /GET/);
assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /range/i);
console.log('Range request preflight: allowed');
const binary = await fetch(new URL('health/transport-v1.bin', `${base.replace(/\/$/, '')}/`), {
  headers: { Origin: origins[0] }, signal: AbortSignal.timeout(15000),
});
assert.equal(binary.status, 200);
assert.equal(binary.headers.get('content-encoding'), null);
assert.equal(binary.headers.get('access-control-allow-origin'), origins[0]);
const compressed=Buffer.from(await binary.arrayBuffer());
const fixture='GitDance byte-exact compressed transport test v1';
assert.deepEqual(compressed,gzipSync(fixture));
assert.equal(gunzipSync(compressed).toString(),fixture);
cacheHit ||= binary.headers.get('cf-cache-status') === 'HIT';
console.log(`Compressed binary: byte-preserving transport; cache=${binary.headers.get('cf-cache-status')}`);
console.log('PASS: public HTTPS and CORS. This does not test catalog playback.');
if (!cacheHit) console.warn('CDN cache HIT not observed. Cache configuration/propagation still needs verification.');
