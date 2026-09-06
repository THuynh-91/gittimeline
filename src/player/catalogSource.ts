import type { CompiledPerformance } from '@/model/types';
import type { CatalogManifest } from '@/export/catalogPackage';

export interface WindowRequest { t: number; x?: number; width?: number }
export interface PerformanceSource {
  prepare(request: WindowRequest): Promise<CompiledPerformance>;
  /**
   * Fetch and decode what a future request will need, and keep nothing.
   *
   * Playback stops while a window is prepared, because the frame loop skips
   * `render` when the plan does not cover the playhead. Measured on Kubernetes
   * that was one short stop every three or four seconds — the stutter that was
   * reported. Warming ahead moves the download off the critical path: the real
   * request arrives to find its pages already decoded in the worker's cache.
   *
   * Best effort by definition. It resolves whether or not it succeeded, and
   * never rejects, because nobody is waiting on it.
   */
  warm?(request: WindowRequest): Promise<void>;
  dispose(): void;
}
export class MemoryPerformanceSource implements PerformanceSource {
  constructor(readonly performance: CompiledPerformance) {}
  prepare(): Promise<CompiledPerformance> { return Promise.resolve(this.performance); }
  warm(): Promise<void> { return Promise.resolve(); }
  dispose() { /* Owned by the compiler client. */ }
}
export class CatalogSource implements PerformanceSource {
  readonly worker = new Worker(new URL('../workers/catalog.worker.ts',import.meta.url),{type:'module'});
  private serial=0;
  private pending=new Map<number,{resolve:(p:CompiledPerformance)=>void;reject:(e:Error)=>void}>();
  /** Speculative requests, which resolve either way and never reject. */
  private warming=new Map<number,()=>void>();
  constructor(readonly url:string, readonly manifest:CatalogManifest) {
    this.worker.onmessage=({data}:{data:{id:number;perf?:CompiledPerformance;error?:string;warmed?:boolean}})=>{
      const warm=this.warming.get(data.id);
      if(warm){this.warming.delete(data.id);warm();return;}
      const pending=this.pending.get(data.id);if(!pending)return;
      this.pending.delete(data.id);
      if(data.perf)pending.resolve(data.perf);else pending.reject(new Error(data.error ?? 'Could not prepare this interval.'));
    };
    this.worker.onerror=()=>{for(const p of this.pending.values())p.reject(new Error('The history decoder stopped. Reopen this history to retry.'));this.pending.clear();};
  }
  prepare(request:WindowRequest):Promise<CompiledPerformance> {
    for(const p of this.pending.values())p.reject(new DOMException('Superseded seek','AbortError'));
    this.pending.clear();
    const id=++this.serial;
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,url:this.url,manifest:this.manifest,request});});
  }
  warm(request:WindowRequest):Promise<void> {
    // Not cleared like `pending`: a warm request is not superseded by the next
    // one arriving here, only by the worker choosing to abandon it.
    const id=++this.serial;
    return new Promise((resolve)=>{
      this.warming.set(id,resolve);
      this.worker.postMessage({id,url:this.url,manifest:this.manifest,request,warm:true});
    });
  }
  dispose() {
    this.worker.terminate();
    for(const p of this.pending.values())p.reject(new DOMException('History closed','AbortError'));
    this.pending.clear();
    for(const done of this.warming.values())done();
    this.warming.clear();
  }
}
