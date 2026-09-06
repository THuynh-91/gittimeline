import { assembleWindow, safeResource, validateManifest, MAX_VIEW_WIDTH, type CatalogManifest, type Resource } from '@/export/catalogPackage';
import { gunzipIfNeeded, readCompiledPerformance } from '@/export/performance';
import { sampleCamera } from '@/choreography/camera';
import type { CompiledPerformance } from '@/model/types';
import type { WindowRequest } from '@/player/catalogSource';

const MAX_RESIDENT=96*1024*1024;
let abort:AbortController|null=null;
let index:Resource[]|null=null;
const cache=new Map<string,{p:CompiledPerformance;bytes:number}>();
let resident=0;

async function checkedBytes(url:string,hash:string,max:number,signal:AbortSignal):Promise<Uint8Array> {
  const res=await fetch(url,{signal});if(!res.ok||!res.body)throw new Error(`History resource unavailable (${res.status}). Retry this interval.`);
  const reader=res.body.getReader(),parts:Uint8Array[]=[];let length=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max)throw new Error('History resource exceeds its declared size.');parts.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(length);let off=0;for(const p of parts){bytes.set(p,off);off+=p.length;}
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==hash)throw new Error('History resource failed its integrity check. Reload to check for an updated catalog.');
  return bytes;
}
async function page(r:Resource,base:string,signal:AbortSignal):Promise<CompiledPerformance> {
  const found=cache.get(r.file);if(found){cache.delete(r.file);cache.set(r.file,found);return found.p;}
  if(r.decodedBytes>MAX_RESIDENT||!Number.isFinite(r.decodedBytes))throw new Error('This history page exceeds the memory budget.');
  const bytes=await checkedBytes(new URL(safeResource(r.file),base).href,r.hash,r.bytes,signal);
  const stream=await gunzipIfNeeded(new Blob([bytes as BlobPart]).stream());
  let decoded=0;
  const limited=stream.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(value,c){decoded+=value.byteLength;if(decoded>MAX_RESIDENT)throw new Error('Decoded history exceeds memory budget.');c.enqueue(value);}}));
  const p=await readCompiledPerformance(limited);
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  while(resident+r.decodedBytes>MAX_RESIDENT&&cache.size){const key=cache.keys().next().value!;resident-=cache.get(key)!.bytes;cache.delete(key);}
  cache.set(r.file,{p,bytes:r.decodedBytes});resident+=r.decodedBytes;
  return p;
}
self.onmessage=async({data}:{data:{id:number;url:string;manifest:CatalogManifest;request:WindowRequest}})=>{
  abort?.abort();const active=new AbortController();abort=active;
  const {id,url,manifest,request}=data;
  try {
    validateManifest(manifest);
    const base=new URL('.',url).href;
    if(!index){const bytes=await checkedBytes(new URL(safeResource(manifest.index.file),base).href,manifest.index.hash,manifest.index.bytes,active.signal);const decoded=await gunzipIfNeeded(new Blob([bytes as BlobPart]).stream());index=JSON.parse(await new Response(decoded).text()) as Resource[];}
    const time=index.filter(r=>r.kind==='time'&&r.min<=request.t&&r.max>=request.t);
    if(!time.length)throw new Error('This interval is missing from the catalog.');
    const clocks=await Promise.all(time.map(r=>page(r,base,active.signal)));
    // Deduped by time before sampling. Time pages overlap by eight seconds so
    // that a seek near a boundary still finds its neighbours, which means two
    // pages can carry the same cue — and `sampleCamera` reads its grid step
    // from the first two entries, so a repeated timestamp makes that step zero
    // and every lookup lands on the last cue in the array. `assembleWindow`
    // already dedupes for the plan it hands back; this is the same guard for
    // the one sample taken here.
    const camera=sampleCamera([...new Map(clocks.flatMap(p=>p.camera).map(c=>[c.time,c])).values()].sort((a,b)=>a.time-b.time),request.t);
    const width=Math.min(MAX_VIEW_WIDTH,Math.max(6000,request.width??6000));
    const x=request.x??camera.x, min=x-width, max=x+width;
    const geometry=index.filter(r=>r.kind==='geometry'&&r.max>=min&&r.min<=max);
    const required=[...time,...geometry].reduce((n,r)=>n+r.decodedBytes,0);
    if(required>MAX_RESIDENT)throw new Error('This view contains too much detail. Zoom in and retry.');
    const pages=[...clocks];
    for(let i=0;i<geometry.length;i+=6)pages.push(...await Promise.all(geometry.slice(i,i+6).map(r=>page(r,base,active.signal))));
    if(active.signal.aborted)return;
    const perf=assembleWindow(manifest.summary,pages);
    perf.window={key:`${id}:${manifest.summary.planHash}`,start:Math.min(...time.map(r=>r.min)),end:Math.max(...time.map(r=>r.max)),minX:min,maxX:max,residentBytes:resident+required,manifestUrl:url};
    // Transfer private copies. Cached resource buffers must remain valid for subsequent seeks.
    for(const e of perf.edges)e.pts=e.pts.slice();
    const buffers=perf.edges.map(e=>e.pts.buffer as ArrayBuffer);buffers.push(perf.waveform.buffer as ArrayBuffer);
    self.postMessage({id,perf},buffers);
  }catch(error){if(!active.signal.aborted)self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
