import { useRef } from 'preact/hooks';
import { store, updateSettings } from './store';
import { seek, selectNode, focusContributor } from './controller';
import type { CompiledPerformance, NodeGeom } from '@/model/types';

/**
 * The commit ledger: the work as it is written. Each commit that lands prints
 * here with its author's signature colour, subject and short SHA, then recedes
 * as newer work arrives.
 *
 * It sits across the top by default, where it reads as a feed without covering
 * the stage. Drag it to either side and it docks there instead, which suits a
 * tall window or a viewer who wants the middle of the screen clear.
 *
 * **The feed is rate-limited, and says so.** Simply printing the most recent
 * commits means that on a busy stretch the whole rail turns over several times
 * a second, and text that is replaced faster than it can be read is not a
 * ledger, it is a flicker. So a new entry is admitted at most every DWELL
 * seconds of performance time, and when commits land faster than that the ones
 * that went by are counted on the entry that replaced them rather than being
 * quietly dropped. Nothing is hidden; it is just legible.
 */
const COUNT = 5;
/** Performance seconds an entry is guaranteed before it can be pushed down. */
const DWELL = 0.5;

interface Entry {
  node: NodeGeom;
  /** Performance time this entry was admitted to the feed. */
  at: number;
  /** Commits that landed between the previous entry and this one. */
  skipped: number;
}

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
  const feed = useRef<{ hash: string; at: number; cursor: number; entries: Entry[] }>({ hash: '', at: -1, cursor: -1, entries: [] });

  if (!perf || !perf.nodes.length) return null;
  if (store.panel.value !== 'none' && dock === 'right') return null;

  const last = landedIndex(perf, t);
  if (last < 0) return null;
  const items = advanceFeed(feed, perf, t, last);
  if (!items.length) return null;

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
      {[...items].reverse().map((entry, i) => {
        const nd = entry.node;
        const c = perf.contributors[nd.contributorIdx];
        const fresh = t - entry.at < 0.55;
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
            <span class="rail-sha">
              {nd.sha.slice(0, 7)}
              {entry.skipped > 0 && <em class="rail-skipped">+{entry.skipped} more</em>}
            </span>
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

/**
 * Advance the feed to time `t`, admitting at most one entry per DWELL.
 *
 * Seeking backwards, looping and loading a new performance all rebuild it from
 * scratch, so the ledger never shows work that has not landed yet.
 */
function advanceFeed(
  ref: { current: { hash: string; at: number; cursor: number; entries: Entry[] } },
  perf: CompiledPerformance,
  t: number,
  last: number,
): Entry[] {
  const f = ref.current;
  if (f.hash !== perf.planHash || last < f.cursor || t < f.at) {
    // Rebuild: take the most recent commits, spaced by their own landings.
    const entries: Entry[] = [];
    let i = last;
    let cutoff = Infinity;
    while (i >= 0 && entries.length < COUNT) {
      const nd = perf.nodes[i]!;
      if (nd.impact <= cutoff) {
        entries.unshift({ node: nd, at: nd.impact, skipped: 0 });
        cutoff = nd.impact - DWELL;
      }
      i--;
    }
    ref.current = { hash: perf.planHash, at: entries.length ? entries[entries.length - 1]!.at : t, cursor: last, entries };
    return ref.current.entries;
  }
  if (last > f.cursor && t - f.at >= DWELL) {
    const skipped = last - f.cursor - 1;
    f.entries = [...f.entries, { node: perf.nodes[last]!, at: t, skipped }].slice(-COUNT);
    f.at = t;
    f.cursor = last;
  }
  return f.entries;
}

// Subject lookup is memoized per dataset: the rail re-renders many times a second.
let subjectCache: { hash: string; map: Map<string, string> } | null = null;

/**
 * What this row says.
 *
 * The plan carries the subject on the node, which is the only reason the
 * ledger has words in it on a large history: the dataset those subjects used
 * to come from is too big to fetch back for anything above eight megabytes,
 * and those are exactly the histories somebody sits and watches. Every row
 * read "(no message)" for hours.
 *
 * The dataset is still consulted when it is there, because it is the more
 * complete record and a plan built before the subject existed has none.
 */
function messageFor(perf: CompiledPerformance, nodeIdx: number): string {
  const node = perf.nodes[nodeIdx]!;
  if (node.subject) return node.subject;
  const ds = store.dataset.value;
  if (!ds) return '';
  if (!subjectCache || subjectCache.hash !== ds.contentHash) {
    subjectCache = { hash: ds.contentHash, map: new Map(ds.commits.map((c) => [c.sha, c.messageSubject])) };
  }
  return subjectCache.map.get(node.sha) || '(no message)';
}
