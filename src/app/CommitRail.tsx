import { store } from './store';
import { seek, selectNode, focusContributor } from './controller';
import type { CompiledPerformance } from '@/model/types';

/**
 * The commit ledger: the notes as they are written. Each commit that lands on
 * the stage prints here with its author's signature colour, subject and short
 * SHA, then recedes as newer work arrives. It is the readable counterpart to
 * the motion, and it doubles as a quick way to jump back to a moment.
 */
const COUNT = 6;

function landedIndex(perf: CompiledPerformance, t: number): number {
  const nodes = perf.nodes;
  let lo = -1;
  let hi = nodes.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid]!.impact <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function CommitRail() {
  const perf = store.perf.value;
  const t = store.time.value;
  if (!perf || !perf.nodes.length) return null;
  if (store.panel.value !== 'none') return null;

  const last = landedIndex(perf, t);
  if (last < 0) return null;
  const items = [];
  for (let i = last; i >= 0 && items.length < COUNT; i--) items.push(perf.nodes[i]!);

  return (
    <aside class="rail" aria-hidden="true" data-testid="commit-rail">
      {items.map((nd, i) => {
        const c = perf.contributors[nd.contributorIdx];
        const age = t - nd.impact;
        const fresh = age < 0.55;
        const message = messageFor(perf, nd.idx);
        return (
          <button
            type="button"
            tabIndex={-1}
            key={nd.sha}
            class={`rail-item${fresh ? ' fresh' : ''}${nd.isMerge ? ' merge' : ''}`}
            style={`--i:${i};--c:${c?.color ?? '#9aa4b2'}`}
            onClick={() => {
              seek(nd.impact);
              selectNode(nd.idx);
            }}
            onDblClick={() => focusContributor(c?.id ?? null)}
          >
            <span class="rail-sha">{nd.sha.slice(0, 7)}</span>
            <span class="rail-msg">{message}</span>
            <span class="rail-who">
              <i class={`swatch ${c?.glyph ?? 'orb'}`} style={`background:${c?.color};color:${c?.color}`} />
              {c?.displayName ?? 'Anonymous author'}
              {nd.tagLabels.length > 0 && <em class="rail-tag">{nd.tagLabels[0]}</em>}
              {nd.isMerge && <em class="rail-kind">{nd.parentCount > 2 ? `octopus · ${nd.parentCount} parents` : 'merge'}</em>}
              {nd.kind === 'boundary' && <em class="rail-kind warn">history not loaded</em>}
            </span>
          </button>
        );
      })}
    </aside>
  );
}

// Subject lookup is memoized per dataset: the rail re-renders many times a second.
let subjectCache: { hash: string; map: Map<string, string> } | null = null;
function messageFor(perf: CompiledPerformance, nodeIdx: number): string {
  const ds = store.dataset.value;
  if (!ds) return '';
  if (!subjectCache || subjectCache.hash !== ds.contentHash) {
    subjectCache = { hash: ds.contentHash, map: new Map(ds.commits.map((c) => [c.sha, c.messageSubject])) };
  }
  return subjectCache.map.get(perf.nodes[nodeIdx]!.sha) || '(no message)';
}
