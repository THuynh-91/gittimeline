// Release metadata gate for deployment; browser tests remain required before promotion.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const base=new URL(process.env.VITE_CATALOG_BASE);
assert.equal(base.protocol,'https:');
assert.ok(!base.username&&!base.password&&!base.search&&!base.hash);
assert.match(base.pathname,/\/releases\/[a-f0-9]{64}\/$/);
assert.ok(!existsSync('dist/catalog'),'Remote build still contains a local catalog');
const get=async(file)=>{
  const r=await fetch(new URL(file,base),{headers:{Origin:'https://thuynh-91.github.io'},signal:AbortSignal.timeout(15000)});
  assert.equal(r.status,200,`${file} is unavailable`);
  assert.equal(r.headers.get('access-control-allow-origin'),'https://thuynh-91.github.io');
  return r.json();
};
const server=await createServer({configFile:false,resolve:{alias:{'@':resolve('src')}},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom',logLevel:'error'});
try {
  const {validateManifest}=await server.ssrLoadModule('/src/export/catalogPackage.ts');
  const index=await get('index.json');assert.ok(index.entries?.length);assert.ok(!index.preview,'A smoke-test shelf cannot be promoted to production.');
  for(const entry of index.entries) {
    assert.match(entry.file,/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.gittimeline\.gz$/);
    assert.ok(!entry.file.includes('..'));
    const m=await get(entry.file.replace(/\.gittimeline\.gz$/,'.pages/manifest.json'));
    validateManifest(m);assert.equal(m.summary.planHash,entry.planHash);
  }
  console.log(`PASS: ${index.entries.length} remote entries match this engine; dist contains no catalog.`);
} finally {await server.close();}
