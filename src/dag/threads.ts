import type { Dataset, ThreadAssignment } from '@/model/types';
import type { GraphIndex } from './graph';
import type { Spine } from './spine';

export interface ThreadResult {
  threads: ThreadAssignment[];
  /** Thread index per node id. */
  threadOf: Int32Array;
  /** Thread index → node ids (oldest → newest). */
  members: number[][];
  /** Node id → base node id (junction the thread peels from) or -1. */
  baseOf: Int32Array;
}

/**
 * Deterministic thread decomposition (spec §9.3):
 *  1. pin the primary spine;
 *  2. at each merge (in presentation order) walk unseen non-first-parent
 *     ancestry back to the nearest assigned junction → a "merged" thread;
 *  3. add unseen first-parent histories of current refs → "current" threads;
 *  4. cover any remaining commits from their newest tips → "auxiliary".
 * Every parent edge remains authoritative; threads are only a path cover
 * used for lanes and performers.
 */
export function assignThreads(g: GraphIndex, ds: Dataset, spine: Spine, presentation: Float64Array): ThreadResult {
  const n = g.shas.length;
  const threadOf = new Int32Array(n).fill(-1);
  const baseOf = new Int32Array(n).fill(-1);
  const members: number[][] = [];
  const meta: Array<{ role: ThreadAssignment['role']; base: number; merge: number }> = [];

  const refsByTarget = new Map<string, string[]>();
  for (const r of ds.refs) {
    const list = refsByTarget.get(r.targetSha) ?? [];
    list.push(r.id);
    refsByTarget.set(r.targetSha, list);
  }

  const newThread = (ids: number[], role: ThreadAssignment['role'], base: number, merge: number): number => {
    const t = members.length;
    members.push(ids);
    meta.push({ role, base, merge });
    for (const id of ids) threadOf[id] = t;
    if (ids.length) baseOf[ids[0]!] = base;
    return t;
  };

  // Walk first parents from `start` until an assigned commit; returns [oldest..newest], junction id.
  const walk = (start: number): { chain: number[]; base: number } => {
    const chain: number[] = [];
    let cur = start;
    const guard = new Set<number>();
    while (cur >= 0 && threadOf[cur] === -1 && !guard.has(cur)) {
      guard.add(cur);
      chain.push(cur);
      cur = g.firstParent[cur]!;
    }
    chain.reverse();
    return { chain, base: cur >= 0 && threadOf[cur] !== -1 ? cur : -1 };
  };

  const byTime = (a: number, b: number) => presentation[a]! - presentation[b]! || (g.shas[a]! < g.shas[b]! ? -1 : 1);

  // Worklist of merge commits whose extra parents may open new threads.
  const pending: number[] = [];
  const enqueueMerges = (ids: number[]) => {
    for (const id of ids) if (g.parents[id]!.length > 1) pending.push(id);
  };

  if (spine.ids.length) {
    newThread(spine.ids, 'primary', -1, -1);
    enqueueMerges(spine.ids);
  }

  const drain = () => {
    while (pending.length) {
      pending.sort(byTime);
      const m = pending.shift()!;
      const ps = g.parents[m]!;
      const slots = g.parentSlots[m]!;
      for (let k = 0; k < ps.length; k++) {
        if (slots[k] === 0) continue; // first parent is the thread continuation
        const p = ps[k]!;
        if (threadOf[p] !== -1) continue; // junction into an existing thread: secondary edge only
        const { chain, base } = walk(p);
        if (!chain.length) continue;
        newThread(chain, 'merged', base, m);
        enqueueMerges(chain);
      }
    }
  };
  drain();

  // Current refs not yet covered — branches first (default branch already is the spine), then tags.
  const refOrder = [...ds.refs].sort((a, b) => {
    const ka = a.kind === 'branch' ? 0 : 1;
    const kb = b.kind === 'branch' ? 0 : 1;
    return ka - kb || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  });
  for (const r of refOrder) {
    const id = g.index.get(r.targetSha);
    if (id === undefined || threadOf[id] !== -1) continue;
    const { chain, base } = walk(id);
    if (!chain.length) continue;
    newThread(chain, r.kind === 'branch' ? 'current' : 'auxiliary', base, -1);
    enqueueMerges(chain);
    drain();
  }

  // Anything still uncovered (e.g. commits fetched past a deleted ref): cover from newest tips.
  for (;;) {
    let tip = -1;
    for (let i = 0; i < n; i++) {
      if (threadOf[i] !== -1) continue;
      const hasUnassignedChild = g.children[i]!.some((c) => threadOf[c] === -1);
      if (hasUnassignedChild) continue;
      if (tip === -1 || byTime(i, tip) > 0) tip = i;
    }
    if (tip === -1) break;
    const { chain, base } = walk(tip);
    newThread(chain, 'auxiliary', base, -1);
    enqueueMerges(chain);
    drain();
  }

  const threads: ThreadAssignment[] = members.map((ids, t) => {
    const m = meta[t]!;
    const endSha = g.shas[ids[ids.length - 1]!]!;
    const knownRefIds = refsByTarget.get(endSha) ?? [];
    return {
      id: t === 0 && m.role === 'primary' ? 'main-line' : `thread-${String(t).padStart(2, '0')}`,
      commitShas: ids.map((id) => g.shas[id]!),
      startSha: g.shas[ids[0]!]!,
      endSha,
      baseSha: m.base >= 0 ? g.shas[m.base]! : null,
      mergeSha: m.merge >= 0 ? g.shas[m.merge]! : null,
      laneId: '',
      knownRefIds,
      role: m.role,
      provenance: 'derived',
    };
  });

  return { threads, threadOf, members, baseOf };
}
