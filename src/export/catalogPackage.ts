import type { CompiledPerformance, EdgeGeom, NodeGeom } from '@/model/types';
import { performanceMatchesEngine } from './performance';

export const PACKAGE_VERSION = 1;
export const WINDOW_SECONDS = 30;
export const MAX_VIEW_WIDTH = 16000;
export interface Resource {
  file: string;
  hash: string;
  bytes: number;
  decodedBytes: number;
  kind: 'geometry' | 'time' | 'detail';
  min: number;
  max: number;
}
export interface CatalogManifest {
  format: 'gittimeline-catalog';
  version: number;
  summary: CompiledPerformance;
  index: { file: string; hash: string; bytes: number };
  years: Array<[number, number]>;
  highlights: Array<[number, number]>;
  transcript: string;
}

export function emptyPlan(p: CompiledPerformance): CompiledPerformance {
  return { ...p, nodes: [], edges: [], threads: [], events: [], camera: [], timeMap: [], tempoMap: [],
    activity: [], waveform: new Float32Array(), eras: [], contributors: [], aggregates: [], refs: [], landmarks: [], transcript: [] };
}

/** A projection of the original plan. Every route keeps its original points and timing. */
export function geometryPage(p: CompiledPerformance, nodes: NodeGeom[], edges: EdgeGeom[]): CompiledPerformance {
  const nodeIds = new Set(nodes.map(n => n.idx));
  for (const e of edges) { if (e.parent >= 0) nodeIds.add(e.parent); nodeIds.add(e.child); }
  const selected = [...nodeIds].sort((a, b) => a - b).map(i => p.nodes[i]!);
  const nodeMap = new Map(selected.map((n, i) => [n.idx, i]));
  const threadIds = [...new Set([...selected.map(n => n.threadIdx), ...edges.map(e => e.threadIdx)])].sort((a,b) => a-b);
  const threadMap = new Map(threadIds.map((n,i) => [n,i]));
  const contributorIds = [...new Set([...selected.map(n => n.contributorIdx), ...edges.flatMap(e => [e.contributorIdx,e.fromContributorIdx])])].filter(i=>i>=0).sort((a,b)=>a-b);
  const contributorMap = new Map(contributorIds.map((n,i)=>[n,i]));
  const aggregateIds = [...new Set(selected.flatMap(n => n.aggregateIdx == null ? [] : [n.aggregateIdx]))];
  const aggregateMap = new Map(aggregateIds.map((n,i)=>[n,i]));
  return { ...emptyPlan(p),
    nodes: selected.map((n,idx) => ({ ...n, idx, threadIdx: threadMap.get(n.threadIdx)!, contributorIdx: contributorMap.get(n.contributorIdx) ?? -1, aggregateIdx: n.aggregateIdx == null ? null : aggregateMap.get(n.aggregateIdx)! })),
    edges: edges.map(e => ({ ...e, parent: nodeMap.get(e.parent) ?? -1, child: nodeMap.get(e.child)!, threadIdx: threadMap.get(e.threadIdx)!, contributorIdx: contributorMap.get(e.contributorIdx) ?? -1, fromContributorIdx: contributorMap.get(e.fromContributorIdx) ?? -1 })),
    threads: threadIds.map((id,idx) => { const th=p.threads[id]!; return { ...th,idx,nodeIdxs: selected.flatMap(n=>n.threadIdx===id?[nodeMap.get(n.idx)!]:[]), baseNodeIdx: th.baseNodeIdx == null ? null : nodeMap.get(th.baseNodeIdx) ?? null, mergeNodeIdx: th.mergeNodeIdx == null ? null : nodeMap.get(th.mergeNodeIdx) ?? null }; }),
    contributors: contributorIds.map(i=>p.contributors[i]!),
    aggregates: aggregateIds.map(i=>({ ...p.aggregates[i]!, memberShas: [], contributorIds: [], expandable: false })),
  };
}

/** Merge independent pages, translating every local reference through stable identities. */
export function assembleWindow(summary: CompiledPerformance, pages: CompiledPerformance[]): CompiledPerformance {
  const out = { ...summary, waveform: Float32Array.from(summary.waveform), nodes: [], edges: [], threads: [], contributors: [], aggregates: [], events: [], camera: [], timeMap: [], tempoMap: [] } as CompiledPerformance;
  const nodes = new Map<string, number>(), threads = new Map<string, number>(), people = new Map<string,number>(), aggregates = new Map<string,number>();
  for (const p of pages) {
    for (const c of p.contributors) if (!people.has(c.id)) { people.set(c.id,out.contributors.length); out.contributors.push(c); }
    for (const a of p.aggregates) if (!aggregates.has(a.id)) { aggregates.set(a.id,out.aggregates.length); out.aggregates.push(a); }
    for (const th of p.threads) if (!threads.has(th.id)) { threads.set(th.id,out.threads.length); out.threads.push({ ...th,idx:out.threads.length,nodeIdxs:[],baseNodeIdx:null,mergeNodeIdx:null }); }
  }
  const allNodes = new Map<string,{ n: NodeGeom; p: CompiledPerformance }>();
  for (const p of pages) for (const n of p.nodes) allNodes.set(n.sha,{n,p});
  for (const {n,p} of [...allNodes.values()].sort((a,b)=>a.n.impact-b.n.impact || a.n.sha.localeCompare(b.n.sha))) {
    const idx=out.nodes.length; nodes.set(n.sha,idx);
    out.nodes.push({ ...n,idx,threadIdx:threads.get(p.threads[n.threadIdx]!.id)!,contributorIdx:people.get(p.contributors[n.contributorIdx]?.id ?? '') ?? -1,aggregateIdx:n.aggregateIdx==null?null:aggregates.get(p.aggregates[n.aggregateIdx]!.id)! });
  }
  const edgeIds=new Set<number>();
  for (const p of pages) {
    for (const e of p.edges) if (!edgeIds.has(e.idx)) {
      edgeIds.add(e.idx);
      out.edges.push({ ...e,parent:e.parent<0?-1:nodes.get(p.nodes[e.parent]!.sha)!,child:nodes.get(p.nodes[e.child]!.sha)!,threadIdx:threads.get(p.threads[e.threadIdx]!.id)!,contributorIdx:people.get(p.contributors[e.contributorIdx]?.id ?? '') ?? -1,fromContributorIdx:people.get(p.contributors[e.fromContributorIdx]?.id ?? '') ?? -1 });
    }
    for(const th of p.threads) {
      const dest=out.threads[threads.get(th.id)!]!;
      if(th.baseNodeIdx!=null) dest.baseNodeIdx=nodes.get(p.nodes[th.baseNodeIdx]!.sha) ?? null;
      if(th.mergeNodeIdx!=null) dest.mergeNodeIdx=nodes.get(p.nodes[th.mergeNodeIdx]!.sha) ?? null;
    }
  }
  for(const n of out.nodes) out.threads[n.threadIdx]!.nodeIdxs.push(n.idx);
  out.edges.sort((a,b)=>a.start-b.start || a.idx-b.idx);
  out.events=[...new Map(pages.flatMap(p=>p.events).map(e=>[e.id,e])).values()].sort((a,b)=>a.performanceImpact-b.performanceImpact);
  out.camera=[...new Map(pages.flatMap(p=>p.camera).map(c=>[c.time,c])).values()].sort((a,b)=>a.time-b.time);
  for (const k of ['timeMap','tempoMap'] as const) out[k]=[...new Map([...summary[k],...pages.flatMap(p=>p[k])].map(v=>[v[0],v])).values()].sort((a,b)=>a[0]-b[0]);
  return out;
}

export function validateManifest(m: CatalogManifest): void {
  if(m.format!=='gittimeline-catalog'||m.version!==PACKAGE_VERSION||!performanceMatchesEngine(m.summary)) throw new Error('This history needs a compatible catalog release.');
  if(!Number.isFinite(m.summary.duration)||m.summary.duration<=0) throw new Error('Invalid history duration.');
  safeResource(m.index.file);
}
export function safeResource(file:string):string {
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file)||file.includes('..')) throw new Error('Invalid catalog resource path.');
  return file;
}

export function highlightsOf(p:CompiledPerformance):Array<[number,number]> {
  const chosen:Array<[number,number]>=[];
  const events=p.events.filter(e=>['MAJOR_MERGE','OCTOPUS_MERGE','TAG_LANDMARK','DIVERGENCE','ERA_TRANSITION'].includes(e.type)).sort((a,b)=>b.salience-a.salience||a.performanceImpact-b.performanceImpact);
  for(const e of events) {
    const range:[number,number]=[Math.max(0,e.performanceImpact-4),Math.min(p.duration,e.performanceImpact+6)];
    if(chosen.every(([a,b])=>range[1]+2<a||range[0]>b+2)) chosen.push(range);
    if(chosen.length===6) break;
  }
  return chosen.sort((a,b)=>a[0]-b[0]);
}
