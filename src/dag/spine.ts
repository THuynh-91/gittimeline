import type { Dataset } from '@/model/types';
import { firstParentChain, type GraphIndex } from './graph';

export type SpinePolicy =
  | 'default-branch-first-parent'
  | 'selected-ref-first-parent'
  | 'largest-current-branch'
  | 'highest-salience-tip'
  | 'derived-presentation-spine';

export interface Spine {
  /** Node ids oldest → newest. */
  ids: number[];
  policy: SpinePolicy;
  tipId: number;
  provenance: 'exact' | 'derived';
}

/**
 * The primary spine is the first-parent chain of the default branch tip.
 * Fallbacks are deterministic and their policy is recorded so the UI can
 * say which one was used.
 */
export function selectSpine(g: GraphIndex, ds: Dataset, presentation: Float64Array): Spine {
  const n = g.shas.length;
  if (n === 0) return { ids: [], policy: 'derived-presentation-spine', tipId: -1, provenance: 'derived' };

  const tryTip = (sha: string | null | undefined, policy: SpinePolicy): Spine | null => {
    if (!sha) return null;
    const id = g.index.get(sha);
    if (id === undefined) return null;
    return { ids: firstParentChain(g, id).reverse(), policy, tipId: id, provenance: 'exact' };
  };

  const selectedRef = ds.refs.find((r) => r.name === ds.source.selectedRef && r.kind === 'branch');
  const selected = tryTip(ds.source.selectedTipSha ?? selectedRef?.targetSha, 'selected-ref-first-parent');
  if (selected && ds.source.selectedRef && ds.source.selectedRef !== ds.source.defaultBranch) return selected;

  const defaultRef = ds.refs.find((r) => r.kind === 'branch' && r.name === ds.source.defaultBranch);
  const byDefault = tryTip(ds.source.selectedTipSha ?? defaultRef?.targetSha, 'default-branch-first-parent');
  if (byDefault) return byDefault;

  // Largest reachable first-parent history among current branches.
  let best: Spine | null = null;
  const branches = ds.refs.filter((r) => r.kind === 'branch').sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const b of branches) {
    const s = tryTip(b.targetSha, 'largest-current-branch');
    if (s && (!best || s.ids.length > best.ids.length)) best = s;
  }
  if (best) return best;

  // Highest-salience tip: newest commit with no children, longest chain wins ties.
  const tips: number[] = [];
  for (let i = 0; i < n; i++) if (g.children[i]!.length === 0) tips.push(i);
  tips.sort((a, b) => presentation[b]! - presentation[a]! || (g.shas[a]! < g.shas[b]! ? -1 : 1));
  if (tips.length) {
    const chains = tips.slice(0, 8).map((t) => ({ t, chain: firstParentChain(g, t) }));
    chains.sort((a, b) => b.chain.length - a.chain.length || presentation[b.t]! - presentation[a.t]!);
    const c = chains[0]!;
    return { ids: c.chain.reverse(), policy: 'highest-salience-tip', tipId: c.t, provenance: 'derived' };
  }
  const last = g.topo[g.topo.length - 1]!;
  return { ids: firstParentChain(g, last).reverse(), policy: 'derived-presentation-spine', tipId: last, provenance: 'derived' };
}
