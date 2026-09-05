import type { CompiledPerformance } from '@/model/types';
import type { CatalogManifest } from '@/export/catalogPackage';

export interface WindowRequest { t: number; x?: number; width?: number }
export interface PerformanceSource {
  prepare(request: WindowRequest): Promise<CompiledPerformance>;
  dispose(): void;
}
export class MemoryPerformanceSource implements PerformanceSource {
  constructor(readonly performance: CompiledPerformance) {}
  prepare(): Promise<CompiledPerformance> { return Promise.resolve(this.performance); }
  dispose() { /* Owned by the compiler client. */ }
}
export class CatalogSource implements PerformanceSource {
  readonly worker = new Worker(new URL('../workers/catalog.worker.ts',import.meta.url),{type:'module'});
  private serial=0;
  private pending=new Map<number,{resolve:(p:CompiledPerformance)=>void;reject:(e:Error)=>void}>();
  constructor(readonly url:string, readonly manifest:CatalogManifest) {
    this.worker.onmessage=({data}:{data:{id:number;perf?:CompiledPerformance;error?:string}})=>{
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
  dispose() { this.worker.terminate();for(const p of this.pending.values())p.reject(new DOMException('History closed','AbortError'));this.pending.clear(); }
}
