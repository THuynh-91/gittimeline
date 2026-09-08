import type { BranchActivity, CompiledPerformance } from './types';

/** Work in progress, not unmerged refs: dormant branches stop at their last work. */
export function branchActivityOf(p: CompiledPerformance): BranchActivity[] {
  if (p.branchOverview) return p.branchOverview;
  // A resident window cannot establish what exists elsewhere in the history.
  if (p.window) return [];
  return p.threads.filter(th => th.role !== 'primary' && th.nodeIdxs.length > 0 && th.end >= th.start)
    .map(th => ({ id: th.id, label: th.label || th.id, start: th.start, end: th.end }))
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/** Index once; playback and seeking prune intervals that have already ended. */
export class BranchActivityIndex {
  readonly rows: BranchActivity[];
  private maxEnd: Float64Array;
  constructor(rows: BranchActivity[]) {
    this.rows = rows.slice().sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    this.maxEnd = new Float64Array(this.rows.length);
    let end = -Infinity;
    for (let i = 0; i < this.rows.length; i++) this.maxEnd[i] = end = Math.max(end, this.rows[i]!.end);
  }
  at(t: number): BranchActivity[] {
    let lo = 0, hi = this.rows.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.rows[mid]!.start <= t) lo = mid + 1; else hi = mid; }
    const active: BranchActivity[] = [];
    for (let i = lo - 1; i >= 0 && this.maxEnd[i]! >= t; i--) if (this.rows[i]!.end >= t) active.push(this.rows[i]!);
    return active.reverse();
  }
}

/** Every branch belongs to exactly one row; groups never silently drop members. */
export function groupBranches(rows: BranchActivity[], capacity: number): BranchActivity[][] {
  const size = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(capacity))));
  const groups: BranchActivity[][] = [];
  for (let i = 0; i < rows.length; i += size) groups.push(rows.slice(i, i + size));
  return groups;
}
