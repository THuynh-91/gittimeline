import { useRef } from 'preact/hooks';
import { store, updateSettings } from './store';
import { seek, selectNode, focusContributor } from './controller';
import type { CompiledPerformance } from '@/model/types';

/**
 * The commit ledger: the work as it is written. Each commit that lands prints
 * here with its author's signature colour, subject and short SHA, then recedes
 * as newer work arrives.
 *
 * It sits across the top by default, where it reads as a feed without covering
 * the stage. Drag it to either side and it docks there instead, which suits a
 * tall window or a viewer who wants the middle of the screen clear.
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
  const dock = store.settings.value.railDock;
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  if (!perf || !perf.nodes.length) return null;
  if (store.panel.value !== 'none' && dock === 'right') return null;

  const last = landedIndex(perf, t);
  if (last < 0) return null;
  const items = [];
  for (let i = last; i >= 0 && items.length < COUNT; i--) items.push(perf.nodes[i]!);

  const onDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 24) d.moved = true;
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    // Snap to whichever edge the ledger was dragged toward.
    const nearTop = e.clientY < window.innerHeight * 0.45;
    const next = nearTop ? 'top' : e.clientX > window.innerWidth / 2 ? 'right' : 'left';
    updateSettings({ railDock: next });
  };

  return (
    <aside
      class={`rail dock-${dock}`}
      data-testid="commit-rail"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => (drag.current = null)}
      title="Drag to move this to the top or either side"
    >
      {items.map((nd, i) => {
        const c = perf.contributors[nd.contributorIdx];
        const fresh = t - nd.impact < 0.55;
        return (
          <button
            type="button"
            tabIndex={-1}
            key={nd.sha}
            class={`rail-item${fresh ? ' fresh' : ''}${nd.isMerge ? ' merge' : ''}`}
            style={`--i:${i};--c:${c?.color ?? '#9aa4b2'}`}
            onClick={() => {
              if (drag.current?.moved) return;
              seek(nd.impact);
              selectNode(nd.idx);
            }}
            onDblClick={() => focusContributor(c?.id ?? null)}
          >
            <span class="rail-sha">{nd.sha.slice(0, 7)}</span>
            <span class="rail-msg">{messageFor(perf, nd.idx)}</span>
            <span class="rail-who">
              <i class={`swatch ${c?.glyph ?? 'orb'}`} style={`background:${c?.color};color:${c?.color}`} />
              {c?.displayName ?? 'Anonymous author'}
              {nd.tagLabels.length > 0 && <em class="rail-tag">{nd.tagLabels[0]}</em>}
              {nd.isMerge && <em class="rail-kind">{nd.parentCount > 2 ? `octopus · ${nd.parentCount}` : `merge · ${nd.mergeVolume}`}</em>}
              {nd.kind === 'boundary' && <em class="rail-kind warn">not loaded</em>}
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
