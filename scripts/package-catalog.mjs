import { createReadStream, createWriteStream, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i=args.indexOf(`--${name}`); return i<0?fallback:args[i+1]; };
const catalogDir=flag('catalog','public/catalog');
const outputDir=flag('out',catalogDir);
const slugs=[];
for(let i=0;i<args.length;i++) { if(args[i]==='--catalog'||args[i]==='--out'){i++;continue;} slugs.push(args[i]); }
if(!slugs.length) throw new Error('Specify repository slugs to package.');

// Resources are gzip inside, but they are deliberately NOT named `.gz`.
//
// A static server that sees `.gz` sets `Content-Encoding: gzip`, and the
// browser then transparently decompresses before the fetch is observed. The
// worker verifies a SHA-256 and a declared byte length over what it receives,
// so transparent decoding breaks both: the length overruns the declared
// compressed size and the digest is of different bytes. Measured against
// `vite preview`, every page fetch failed with "History resource exceeds its
// declared size."
//
// An opaque extension keeps the transfer byte-exact everywhere, which is what
// integrity checking requires. Nothing is lost: the payload is already
// compressed, so there was no second compression to gain. `gunzipIfNeeded`
// recognises the content by its magic bytes, not by its name.
// Only load TypeScript here; UI plugins and file watchers are not needed for
// offline packaging and can contend with a concurrently running compiler.
const server=await createServer({configFile:false,resolve:{alias:{'@':resolve('src')}},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom',logLevel:'error'});
try {
  const {readCompiledPerformance,streamCompiledPerformance}=await server.ssrLoadModule('/src/export/performance.ts');
  const {emptyPlan,geometryPage,highlightsOf,PACKAGE_VERSION,WINDOW_SECONDS}=await server.ssrLoadModule('/src/export/catalogPackage.ts');
  const {mapMonotone}=await server.ssrLoadModule('/src/choreography/clock.ts');
  const {characterOf,registerFor}=await server.ssrLoadModule('/src/audio/score.ts');
  for(const slug of slugs) {
    const stem=slug.replace('/','-');
    const p=await readCompiledPerformance(Readable.toWeb(createReadStream(join(catalogDir,`${stem}.gtperf.gz`)).pipe(createGunzip())));
    const dir=join(outputDir,`${stem}.pages`); mkdirSync(dir,{recursive:true});
    const resources=[]; let serial=0;
    const save=async(plan,kind,min,max)=>{
      serial++;
      // A page is bounded, unlike the complete plan. Batch its small frames
      // before compression instead of thousands of asynchronous tiny writes.
      const frames=[];let rawBytes=0;
      for(const frame of streamCompiledPerformance(plan)) {
        const bytes=Buffer.from(frame);rawBytes+=bytes.length;
        if(rawBytes>64*1024*1024)throw new Error('Split this page: encoded size exceeds 64 MiB.');
        frames.push(bytes);
      }
      const data=gzipSync(Buffer.concat(frames,rawBytes)), hash=createHash('sha256').update(data).digest('hex');
      const stableFile=`${hash}.gtperf.bin`;writeFileSync(`${dir}/${stableFile}`,data);
      // Payload identity is checked on every fetch; the immutable release directory is selected by its manifest.
      resources.push({file:stableFile,hash,bytes:data.length,decodedBytes:Buffer.byteLength(JSON.stringify({...plan,edges:plan.edges.map(e=>({...e,pts:[]}))}))*2+plan.edges.reduce((n,e)=>n+e.pts.byteLength,0),kind,min,max});
      if(serial%1000===0)console.log(`${slug}: ${serial} pages packaged`);
    };
    const nodeOrder=[...p.nodes].sort((a,b)=>a.x-b.x);
    for(let i=0;i<nodeOrder.length;i+=256) {
      const ns=nodeOrder.slice(i,i+256); await save(geometryPage(p,ns,[]),'geometry',ns[0].x,ns.at(-1).x);
    }
    // Group routes by span before position. Long branches cannot inflate every short-route page's bounding box.
    const levels=new Map();
    for(const e of p.edges) {
      let min=Infinity,max=-Infinity; for(let i=0;i<e.pts.length;i+=2){min=Math.min(min,e.pts[i]);max=Math.max(max,e.pts[i]);}
      const level=Math.ceil(Math.log2(Math.max(1,max-min)));
      if(!levels.has(level)) levels.set(level,[]); levels.get(level).push({e,min,max});
    }
    for(const level of [...levels.keys()].sort((a,b)=>a-b)) {
      const list=levels.get(level).sort((a,b)=>a.min-b.min||a.e.idx-b.e.idx);
      for(let i=0;i<list.length;i+=64){const block=list.slice(i,i+64);await save(geometryPage(p,[],block.map(v=>v.e)),'geometry',Math.min(...block.map(v=>v.min)),Math.max(...block.map(v=>v.max)));}
    }
    // Linear cursors avoid rescanning millions of events for each time page.
    const events=[...p.events].sort((a,b)=>a.performanceImpact-b.performanceImpact);
    let ei=0,ci=0,mi=0,ti=0;
    for(let start=0;start<p.duration;start+=WINDOW_SECONDS) {
      const end=Math.min(p.duration,start+WINDOW_SECONDS), lo=Math.max(0,start-8),hi=end+8;
      while(ei<events.length&&events[ei].performanceImpact<lo) ei++;
      let ee=ei;while(ee<events.length&&events[ee].performanceImpact<=hi) ee++;
      while(ci+1<p.camera.length&&p.camera[ci+1].time<lo) ci++;
      let ce=ci;while(ce<p.camera.length&&p.camera[ce].time<=hi)ce++;
      while(mi+1<p.timeMap.length&&p.timeMap[mi+1][1]<lo)mi++;
      let me=mi;while(me<p.timeMap.length&&p.timeMap[me][1]<=hi)me++;
      while(ti+1<p.tempoMap.length&&p.tempoMap[ti+1][0]<lo)ti++;
      let te=ti;while(te<p.tempoMap.length&&p.tempoMap[te][0]<=hi)te++;
      await save({...emptyPlan(p),events:events.slice(ei,ee),camera:p.camera.slice(ci,ce+1),timeMap:p.timeMap.slice(mi,me+1),tempoMap:p.tempoMap.slice(ti,te+1)},'time',start,end);
    }
    const years=[];
    const first=new Date(p.timeMap[0][0]).getUTCFullYear(), last=new Date(p.timeMap.at(-1)[0]).getUTCFullYear();
    for(let y=first;y<=last+1;y++) years.push([y,mapMonotone(p.timeMap,Date.UTC(y,0,1))]);
    const summary={...emptyPlan(p),soundtrack:registerFor(characterOf(p)),waveform:Array.from(p.waveform.filter((_,i)=>i%Math.max(1,Math.ceil(p.waveform.length/512))===0)),timeMap:years.map(([y,t])=>[Date.UTC(y,0,1),t]),eras:p.eras,landmarks:p.landmarks.filter(l=>l.kind==='tag'||l.kind==='era').slice(0,128)};
    summary.timeMap=[[...p.timeMap[0]],...summary.timeMap.filter(v=>v[0]>p.timeMap[0][0]&&v[0]<p.timeMap.at(-1)[0]),[...p.timeMap.at(-1)]];
    const index=gzipSync(JSON.stringify(resources));const indexHash=createHash('sha256').update(index).digest('hex');const indexFile=`${indexHash}.json.bin`;writeFileSync(`${dir}/${indexFile}`,index);
    writeFileSync(`${dir}/transcript.txt.gz`,gzipSync(p.transcript.join('\n')));
    // Exact aggregate membership is an explicit separate download, never needed to draw a ribbon.
    await pipeline(Readable.from((function*(){for(const a of p.aggregates)yield JSON.stringify(a)+'\n';})()),createGzip(),createWriteStream(`${dir}/aggregates.ndjson.gz`));
    const manifest={format:'gittimeline-catalog',version:PACKAGE_VERSION,summary,index:{file:indexFile,hash:indexHash,bytes:index.length},years,highlights:highlightsOf(p),transcript:'transcript.txt.gz'};
    writeFileSync(`${dir}/manifest.json`,JSON.stringify(manifest));
    console.log(JSON.stringify({slug,pages:resources.length,manifestBytes:statSync(`${dir}/manifest.json`).size,indexBytes:index.length,bytes:resources.reduce((n,r)=>n+r.bytes,0),maxDecoded:Math.max(...resources.map(r=>r.decodedBytes))}));
  }
} finally {await server.close();}
