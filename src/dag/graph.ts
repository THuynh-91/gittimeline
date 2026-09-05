import type { CommitNode, Sha } from '@/model/types';

/**
 * Compact graph index over a commit list. SHAs are mapped to integer ids;
 * edges are derived only from each commit's parent list. Parents that are not
 * present in the dataset make the child a boundary node — they are never
 * invented as nodes.
 */
export interface GraphIndex {
  shas: Sha[];
  index: Map<Sha, number>;
  /** Known parents per node, preserving Git parent order. Unknown parents are omitted. */
  parents: Int32Array[];
  /** Parent index (0 = first parent) for each known parent, aligned with `parents`. */
  parentSlots: Int32Array[];
  /** First parent id, or -1 if the first parent is unknown or absent. */
  firstParent: Int32Array;
  children: number[][];
  roots: number[];
  boundaries: number[];
  /** Ids with every parent before every child; ties broken by presentation time then SHA. */
  topo: number[];
  unknownParentCount: number;
}

export function buildGraph(commits: CommitNode[]): GraphIndex {
  const n = commits.length;
  const shas = commits.map((c) => c.sha);
  const index = new Map<Sha, number>();
  shas.forEach((sha, i) => index.set(sha, i));

  const parents: Int32Array[] = new Array(n);
  const parentSlots: Int32Array[] = new Array(n);
  const firstParent = new Int32Array(n).fill(-1);
  const children: number[][] = Array.from({ length: n }, () => []);
  const roots: number[] = [];
  const boundaries: number[] = [];
  let unknownParentCount = 0;

  for (let i = 0; i < n; i++) {
    const c = commits[i]!;
    const known: number[] = [];
    const slots: number[] = [];
    let missing = false;
    c.parentShas.forEach((p, slot) => {
      const pid = index.get(p);
      if (pid === undefined) {
        missing = true;
        unknownParentCount++;
        return;
      }
      if (pid === i) return; // self-parent is malformed; ignore rather than loop
      known.push(pid);
      slots.push(slot);
      children[pid]!.push(i);
    });
    parents[i] = Int32Array.from(known);
    parentSlots[i] = Int32Array.from(slots);
    const fp = c.parentShas[0];
    firstParent[i] = fp !== undefined && index.has(fp) && index.get(fp) !== i ? index.get(fp)! : -1;
    if (c.parentShas.length === 0) roots.push(i);
    if (missing) boundaries.push(i);
  }

  // Kahn's algorithm with a deterministic priority (raw time, then sha).
  const rawTime = commits.map((c) => rawTimeOf(c));
  const indeg = new Int32Array(n);
  for (let i = 0; i < n; i++) indeg[i] = parents[i]!.length;
  const cmp = (a: number, b: number) => rawTime[a]! - rawTime[b]! || (shas[a]! < shas[b]! ? -1 : 1);
  const ready: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) ready.push(i);
  ready.sort(cmp);
  const topo: number[] = [];
  // A simple binary heap keeps this O(n log n) for large graphs.
  const heap = new Heap(cmp);
  for (const r of ready) heap.push(r);
  while (heap.size > 0) {
    const v = heap.pop();
    topo.push(v);
    for (const ch of children[v]!) {
      indeg[ch] = indeg[ch]! - 1;
      if (indeg[ch] === 0) heap.push(ch);
    }
  }
  if (topo.length !== n) {
    // A cycle can only come from malformed input; append leftovers in sha order so nothing is dropped.
    const seen = new Set(topo);
    const rest = [];
    for (let i = 0; i < n; i++) if (!seen.has(i)) rest.push(i);
    rest.sort((a, b) => (shas[a]! < shas[b]! ? -1 : 1));
    topo.push(...rest);
  }
  for (const ch of children) ch.sort((a, b) => rawTime[a]! - rawTime[b]! || (shas[a]! < shas[b]! ? -1 : 1));

  return { shas, index, parents, parentSlots, firstParent, children, roots, boundaries, topo, unknownParentCount };
}

/**
 * When a commit happened, from the two stamps Git records.
 *
 * The author date is the right one to prefer: it is when the work was written,
 * and an old patch applied today is honestly old. So a commit authored in 2010
 * and committed in 2020 reads as 2010, and that is deliberate.
 *
 * But a commit cannot have been authored *after* it was committed. The
 * committer stamp is written by the machine making the commit; the author
 * stamp travels with a patch and is the one people mistype. Where the author
 * date is the later of the two, it is the one that is wrong, and the earlier
 * of the pair is the only defensible reading.
 *
 * This is not a tidy-up. Linux commit a27ac38efd6d — "[ACPI] fix merge error
 * that broke CONFIG_ACPI_DEBUG=y build" — carries an author date of
 * 2019-04-05 against a committer date of 2005-07-12: a typo of one digit in
 * the year. Presentation time may only move forward, so that single stamp
 * dragged every one of the 1.4 million commits after it past 2019, and the
 * twelve-hour performance spent 6.9 of those hours inside the single calendar
 * year 2019 while 2006 through 2018 shared about two minutes between them.
 * Fourteen years of Linux had been folded into a point by one wrong character.
 *
 * It is rare, which is what makes it safe to act on: 143 commits of Linux's
 * 1,481,850 have an author date more than a day after their committer date,
 * and every other repository on the shelf is in single figures.
 */
export function rawTimeOf(c: CommitNode): number {
  const authored = c.authoredAtRaw ? Date.parse(c.authoredAtRaw) : NaN;
  const committed = c.committedAtRaw ? Date.parse(c.committedAtRaw) : NaN;
  if (Number.isFinite(authored) && Number.isFinite(committed)) return Math.min(authored, committed);
  if (Number.isFinite(authored)) return authored;
  if (Number.isFinite(committed)) return committed;
  return NaN;
}

/** Ancestor set of `start` restricted to first-parent walking. */
export function firstParentChain(g: GraphIndex, start: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  let cur = start;
  while (cur >= 0 && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = g.firstParent[cur]!;
  }
  return out;
}

/** Full ancestor set (all parents). Bounded breadth-first walk. */
export function ancestorsOf(g: GraphIndex, start: number, limit = Infinity): Set<number> {
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length && seen.size < limit) {
    const v = stack.pop()!;
    for (const p of g.parents[v]!) {
      if (!seen.has(p)) {
        seen.add(p);
        stack.push(p);
      }
    }
  }
  return seen;
}

/** Commits reachable from `from` that are not ancestors of `exclude` (the unique side history of a merge). */
export function uniqueAncestry(g: GraphIndex, from: number, excludeFrom: number, limit = 5000): number[] {
  return new UniqueAncestryWalker(g).walk(from, excludeFrom, limit);
}

/**
 * Reusable bounded ancestry walker for merge analysis.
 *
 * A Set is convenient for a single query, but compilation asks the same kind
 * of question for every merge. Allocating and hashing thousands of Sets made
 * this pass dominate large repositories. Generation-stamped typed arrays give
 * the traversal identical membership semantics with no per-query clearing or
 * hash allocation.
 */
export class UniqueAncestryWalker {
  private excluded: Uint32Array;
  private seen: Uint32Array;
  private stack: Int32Array;
  private generation = 0;

  constructor(private g: GraphIndex) {
    this.excluded = new Uint32Array(g.shas.length);
    this.seen = new Uint32Array(g.shas.length);
    let edgeCount = 0;
    for (const parents of g.parents) edgeCount += parents.length;
    this.stack = new Int32Array(edgeCount + 1);
  }

  walk(from: number, excludeFrom: number, limit = 5000): number[] {
    this.generation++;
    if (this.generation === 0xffff_ffff) {
      this.excluded.fill(0);
      this.seen.fill(0);
      this.generation = 1;
    }
    const mark = this.generation;
    const excludeLimit = limit * 4;
    let top = 0;
    this.stack[top++] = excludeFrom;
    this.excluded[excludeFrom] = mark;
    let excludedCount = 1;
    // Match ancestorsOf's bounded DFS exactly: the bound is checked between
    // nodes, while every parent of the current node is still admitted.
    while (top && excludedCount < excludeLimit) {
      const v = this.stack[--top]!;
      const parents = this.g.parents[v]!;
      for (let i = 0; i < parents.length; i++) {
        const parent = parents[i]!;
        if (this.excluded[parent] === mark) continue;
        this.excluded[parent] = mark;
        excludedCount++;
        this.stack[top++] = parent;
      }
    }

    const out: number[] = [];
    top = 0;
    this.stack[top++] = from;
    while (top && out.length < limit) {
      const v = this.stack[--top]!;
      if (this.seen[v] === mark || this.excluded[v] === mark) continue;
      this.seen[v] = mark;
      out.push(v);
      const parents = this.g.parents[v]!;
      for (let i = 0; i < parents.length; i++) this.stack[top++] = parents[i]!;
    }
    return out;
  }
}

class Heap {
  private a: number[] = [];
  constructor(private cmp: (x: number, y: number) => number) {}
  get size() {
    return this.a.length;
  }
  push(v: number) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cmp(a[i]!, a[p]!) >= 0) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.cmp(a[l]!, a[m]!) < 0) m = l;
        if (r < a.length && this.cmp(a[r]!, a[m]!) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}
