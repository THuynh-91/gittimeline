import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { collectRelease, sha256 } from './catalog-release.mjs';

const engine={layoutVersion:5};
function fixture(t, change=()=>{}) {
  const root=mkdtempSync(join(tmpdir(),'gitdance-release-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'test-repo.pages'));
  const summary={engine,source:{owner:'test',name:'repo'},duration:30,planHash:'test-plan',stats:{commits:20,aggregatedCommits:10}};
  const page=gzipSync(JSON.stringify({format:'gittimeline-perf',engine,planHash:summary.planHash})+'\n');
  const resources=['geometry','time'].map((kind,i)=>({kind,file:`p${i}.bin`,hash:sha256(page),bytes:page.length,decodedBytes:1024,min:0,max:30}));
  const manifest={format:'gittimeline-catalog',version:1,summary,years:[[2020,0],[2021,30]],transcript:'transcript.txt.gz'};
  change({summary,resources,manifest});
  const index=gzipSync(JSON.stringify(resources));
  manifest.index={file:'resources.bin',hash:sha256(index),bytes:index.length};
  writeFileSync(join(root,'index.json'),JSON.stringify({entries:[{slug:'test/repo',file:'test-repo.gittimeline.gz'}]}));
  writeFileSync(join(root,'test-repo.pages/manifest.json'),JSON.stringify(manifest));
  writeFileSync(join(root,'test-repo.pages/resources.bin'),index);
  for(let i=0;i<2;i++)writeFileSync(join(root,`test-repo.pages/p${i}.bin`),page);
  writeFileSync(join(root,'test-repo.pages/transcript.txt.gz'),gzipSync('test'));
  writeFileSync(join(root,'test-repo.gittimeline.gz'),'raw rebuild input');
  writeFileSync(join(root,'test-repo.gtperf.gz'),'duplicate plan');
  writeFileSync(join(root,'test-repo.pages/stale.bin'),'unreferenced generation');
  return root;
}
test('allowlist excludes raw inputs, monoliths and stale pages; revision is deterministic',t=>{
  const root=fixture(t), a=collectRelease(root,root,engine), b=collectRelease(root,root,engine);
  assert.equal(a.files.length,5);assert.equal(a.revision,b.revision);
  assert.ok(a.files.every(f=>!f.name.includes('stale')&&!f.name.endsWith('.gtperf.gz')&&!f.name.endsWith('.gittimeline.gz')));
  assert.equal(JSON.parse(a.listing).entries[0].openSeconds,null);
});
test('refuses stale engines',t=>{const root=fixture(t,({summary})=>{summary.engine={layoutVersion:4};});assert.throws(()=>collectRelease(root,root,engine),/Rebuild required/);});
test('refuses corrupted pages',t=>{const root=fixture(t);writeFileSync(join(root,'test-repo.pages/p0.bin'),'corrupted');assert.throws(()=>collectRelease(root,root,engine),/Integrity mismatch/);});
test('refuses missing time intervals',t=>{const root=fixture(t,({resources})=>{resources[1].min=5;});assert.throws(()=>collectRelease(root,root,engine),/Missing interval/);});
test('refuses traversal',t=>{const root=fixture(t,({manifest})=>{manifest.transcript='../outside';});assert.throws(()=>collectRelease(root,root,engine),/Unsafe resource/);});
test('refuses mixed plan identities',t=>{const root=fixture(t,({summary})=>{summary.planHash='different';});assert.throws(()=>collectRelease(root,root,engine),/Mixed performance revisions/);});
test('smoke shelves are marked as previews and cannot masquerade as complete releases',t=>{const root=fixture(t);const r=collectRelease(root,root,engine,'test/repo');assert.equal(JSON.parse(r.listing).preview,true);assert.throws(()=>collectRelease(root,root,engine,'missing/repo'),/not in the catalog/);});
