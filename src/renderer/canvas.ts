import type { AggregateSpan, CameraCue, ChoreographyEvent, CompiledPerformance, EdgeGeom, NodeGeom, ThreadGeom } from '@/model/types';
import { sampleCamera } from '@/choreography/camera';
import { describeAggregate } from '@/analysis/aggregate';
import { pointAt, headingAt } from '@/layout/paths';
import { hash01 } from '@/model/prng';
import { mixHex, rgba } from '@/model/color';
import { LANE_GAP } from '@/layout/layout';
import { GLYPH_PATHS, PALETTE, threadTint } from './palette';

/**
 * Canvas2D stage renderer. Every visible quantity is a pure function of the
 * performance time `t` (plus the compiled plan), so seeking, pausing and
 * capture are exact and side-effect free. Layers back to front:
 * atmosphere → settled paths → spine → active trajectories → nodes →
 * bodies (performers/pulses) → impact effects → labels.
 */
export type Quality = 'full' | 'reduced' | 'minimal';

export interface RenderSettings {
  reducedMotion: boolean;
  noFlash: boolean;
  highContrast: boolean;
  quality: Quality;
  labels: 'minimal' | 'landmarks' | 'all';
  contributorFocus: string | null;
  selectedNode: number | null;
  hoverNode: number | null;
  selectedThread: number | null;
  showGlyphs: boolean;
  showSpineLabel: boolean;
  /** Screen-space safe insets (top chrome, bottom timeline). */
  safe: { top: number; bottom: number; left: number; right: number };
}

export interface ManualCamera {
  x: number;
  y: number;
  scale: number;
}

export interface Pick {
  node: NodeGeom | null;
  aggregateEdge: EdgeGeom | null;
}

interface ViewTransform {
  scale: number;
  ox: number;
  oy: number;
  rotation: number;
  cx: number;
  cy: number;
}

const HEAVY = new Set(['MERGE_IMPACT', 'MAJOR_MERGE', 'OCTOPUS_MERGE']);
const EDGE_BUCKET_WIDTH = 640;
const MAX_EDGE_BUCKET_SPAN = 48;

/**
 * Per-frame stopwatch, off by default and free when off.
 *
 * A stage with three hundred thousand commits on it is slow for a reason, and
 * the reason is never the one you would have guessed: twice in one day the
 * obvious candidate turned out to cost nothing and a loop nobody suspected
 * turned out to cost everything. So the renderer carries its own scales. Turn
 * `enabled` on, run some frames, read `ms` and `counts`, and optimise the line
 * the numbers name rather than the line the intuition does.
 */
export const renderProfile = {
  enabled: false,
  frames: 0,
  ms: {
    total: 0,
    background: 0,
    camera: 0,
    settledEdges: 0,
    activeEdges: 0,
    nodes: 0,
    bodies: 0,
    effects: 0,
    tips: 0,
    glow: 0,
    labels: 0,
    lblThreads: 0,
    lblMerges: 0,
    lblTags: 0,
    lblAggs: 0,
    lblRest: 0,
  },
  counts: {
    edgesConsidered: 0,
    edgesWalked: 0,
    edgesDrawn: 0,
    edgesActive: 0,
    nodesWalked: 0,
    nodesDrawn: 0,
    cacheRedraws: 0,
    rescuedCues: 0,
  },
  /** The last frame's world window, so a surprising count can be explained. */
  view: { scale: 0, x0: 0, x1: 0, y0: 0, y1: 0 },
  reset() {
    this.frames = 0;
    for (const k of Object.keys(this.ms) as Array<keyof typeof this.ms>) this.ms[k] = 0;
    for (const k of Object.keys(this.counts) as Array<keyof typeof this.counts>) this.counts[k] = 0;
  },
};

/**
 * Twenty commits converging must look unmistakably bigger than two. Volume is
 * the count of commits unique to the merged side(s), so this grows with the
 * real weight of the work rather than with a normalized score.
 */
function volumeScale(volume: number): number {
  // Deliberately starts well below one. A merge that absorbs a commit or two is
  // a tap; only real convergence earns a wall of light. Previously every merge
  // got a headline effect, which made the big ones mean nothing.
  return 0.42 + Math.min(2.3, Math.log2(1 + Math.max(0, volume)) * 0.44);
}

/**
 * Stars in the backdrop.
 *
 * Ninety, which is what has always been drawn. The field was allocated for 280
 * on the theory that "a starfield is mostly faint" and that depth comes from
 * most points being barely there — but only the first ninety were ever given a
 * position, so that idea has never actually been on screen. Raising this to
 * 280 would implement it; it would also be a change to the picture, and this
 * constant exists so the decision is made once and in the open rather than by
 * two loops quietly disagreeing about how many stars there are.
 */
const DUST_COUNT = 90;
/**
 * The least room two neighbouring branches may be given on screen.
 *
 * Twenty-six, because each line carries a glow a few pixels wide on both
 * sides; below about twenty they stop reading as two lines and start reading
 * as one thick one.
 */
const MIN_LANE_PX = 26;


export class StageRenderer {
  private ctx: CanvasRenderingContext2D;
  private glow: HTMLCanvasElement;
  private glowCtx: CanvasRenderingContext2D;
  private perf: CompiledPerformance | null = null;
  private edgeBounds: Float32Array = new Float32Array(0);
  private edgeBuckets: number[][] = [];
  private edgeBucketOrigin = 0;
  private longEdges: number[] = [];
  /**
   * The long edges, grouped by how long they are.
   *
   * `longEdges` is the exact fallback for edges too wide to bucket, and it was
   * scanned in full on every frame. That is a fixed cost that has nothing to
   * do with what is on screen, and it showed: measured on Linux it took
   * 1.9-2.6 ms a frame and did not move between one minute and eleven hours in,
   * while the number of edges it selected stayed at fourteen to eighteen. It
   * was the largest single pass at every depth sampled.
   *
   * An edge overlaps the view only if its left end is no further right than
   * the view's right edge, and its right end no further left than the view's
   * left edge. The second condition is the awkward one, because an edge can
   * start arbitrarily far to the left and still reach into view — so a list
   * sorted by left end cannot be entered at `x0`. Grouping by span fixes that:
   * within a group nothing is wider than `maxSpan`, so nothing starting before
   * `x0 - maxSpan` can reach `x0`, and each group can be entered by binary
   * search and walked until its left ends pass `x1`.
   *
   * Groups are powers of two, so there are about thirty of them however large
   * the history is, and the widest branch in the repository no longer decides
   * where the scan for a short one begins. The candidate set is identical --
   * this is the same bounds test, reached sooner.
   */
  private longLevels: Array<{ idx: Int32Array; minX: Float64Array; maxSpan: number }> = [];
  private edgeSeen = new Uint32Array(0);
  private edgeGeneration = 0;
  private edgeCandidates: number[] = [];
  private impactEvents: ChoreographyEvent[] = [];
  private aggregateByNode: Array<AggregateSpan | null> = [];
  private aggregateEdges: EdgeGeom[] = [];
  private unknownEdges: EdgeGeom[] = [];
  private mergeLabelNodes: NodeGeom[] = [];
  private taggedNodes: NodeGeom[] = [];
  private labelThreads: ThreadGeom[] = [];
  private tipThreads: ThreadGeom[] = [];
  private nodesByX = new Int32Array(0);
  private width = 1;
  private height = 1;
  private dpr = 1;
  private view: ViewTransform = { scale: 1, ox: 0, oy: 0, rotation: 0, cx: 0, cy: 0 };
  private smoothedPunch = 1;
  private lastT = -1;
  private nodeBySha = new Map<string, NodeGeom>();
  private tints: string[] = [];
  private dust: Float32Array;
  private lastCue: CameraCue | null = null;
  private sweepX = -Infinity;
  /**
   * The slice of the world worth putting on the path, in world x.
   *
   * Set once a frame from the camera and read by `drawPolyline`. Off-screen
   * segments are skipped rather than emitted, which is what stops a thread's
   * drawing cost being a function of how long it has been alive.
   */
  /** Positions of `aggregateEdges` within `perf.edges`, for `edgeBounds`. */
  private aggregateEdgePos: number[] = [];
  /**
   * Aggregate ribbons ordered by where they start in the world, so the ones
   * on screen can be found instead of filtered for.
   *
   * Rejecting each caption cheaply was not enough. Eleven hours into Linux the
   * loop ran 71,571 times a frame, rejected 71,516 as off-screen and drew 26 —
   * and *that*, at about 145 ns an iteration, was 10.4 ms, over half the
   * frame. The cost was never the work per ribbon; it was that there were
   * 71,571 of them to say no to, and one more every time another second of
   * history went by.
   */
  private aggByMinX: Int32Array = new Int32Array(0);
  private aggMinX: Float64Array = new Float64Array(0);
  /**
   * The ribbons, grouped by how wide they are, each group holding positions
   * into `aggByMinX` rather than ribbons.
   *
   * Same trouble as `longLevels`, one floor up. The caption walk starts at
   * `worldLeft - aggWidestSpan`, and `aggWidestSpan` is the widest ribbon in
   * the entire history — so a single very wide one drags the start of the walk
   * back to nearly zero and the loop runs to the right edge of the view over
   * tens of thousands of entries to place a handful of captions. Measured on
   * Linux at 1.8-2.7 ms a frame from half an hour in.
   *
   * Grouping bounds the reach per group by that group's own widest member. It
   * also makes the "too narrow to caption" test free: a whole group whose
   * widest ribbon is under the threshold can be skipped, where today every one
   * of its members is fetched and `continue`d one at a time.
   *
   * Positions, not ribbons, because `place()` is order-dependent — the first
   * caption to claim a piece of the stage keeps it. Collecting positions and
   * sorting them restores the exact global order the single walk had.
   */
  private aggLevels: Array<{ pos: Int32Array; minX: Float64Array; maxSpan: number }> = [];
  /** Scratch for the above, reused so a per-frame pass allocates nothing. */
  private aggPicked: number[] = [];
  /**
   * Where the main line's nameplate was drawn last frame, for measurement.
   *
   * The plate cannot be photographed on a history of any size — the stage is a
   * `desynchronized` canvas and screenshotting one above about forty thousand
   * nodes hangs — so the way to check that it is holding still is to read the
   * number it was drawn at.
   */
  private mainLabelAt: { x: number; y: number } | null = null;
  get spineLabel(): { x: number; y: number } | null {
    return this.mainLabelAt;
  }
  /** How much of each spark's comet to draw this frame; see the body loop. */
  private bodyDetail = 1;
  /** How much of each thread's energy trail to draw this frame; see the body loop. */
  private edgeDetail = 1;
  private clipX0 = -Infinity;
  private clipX1 = Infinity;
  /** Held framing while the plan's own cues are unusable; null when they are not. */
  private rescueView: { cx: number; cy: number; w: number; h: number } | null = null;
  private frameCounter = 0;
  private tmp = { x: 0, y: 0 };
  private tmp2 = { x: 0, y: 0 };
  /** Node indices in landing order, so the shop window can grow a bounding box. */
  private byImpact = new Int32Array(0);
  private landedPtr = 0;
  private landedT = -1;
  /** Empty until a node lands: an all-zero box would drag the bounds to the origin. */
  private landed = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  private shopView: { cx: number; cy: number; scale: number } | null = null;

  settings: RenderSettings = {
    reducedMotion: false,
    noFlash: false,
    highContrast: false,
    quality: 'full',
    labels: 'landmarks',
    contributorFocus: null,
    selectedNode: null,
    hoverNode: null,
    selectedThread: null,
    showGlyphs: true,
    showSpineLabel: true,
    safe: { top: 56, bottom: 150, left: 24, right: 24 },
  };
  manual: ManualCamera | null = null;
  /**
   * A zoom the viewer chose, held while the director still follows the action.
   * Zooming out and pressing the camera button locks that wider view instead of
   * snapping back to the framing the compiler picked.
   */
  zoomLock: number | null = null;
  /** Dim factor for the gallery/landing state (0..1). */
  attenuation = 1;
  /**
   * Shop-window framing: frame the history that has been drawn, not the front
   * of the work.
   *
   * The director points the camera at whatever is happening now, which is the
   * right answer while somebody is watching a performance and the wrong one
   * behind a form. Everything that has already happened lies off to the left,
   * so the half of the screen the camera is aimed at is the half nothing has
   * reached yet — the landing page ended up as one thin line in a corner of an
   * otherwise black page. Here the camera takes the last few seconds of work,
   * overscans it and keeps the front of it four fifths of the way across, so
   * drawn history reaches every edge and stays the same size however long the
   * path behind it gets.
   */
  shopWindow = false;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.glow = document.createElement('canvas');
    this.glowCtx = this.glow.getContext('2d')!;
    // One count, used by both the allocation and the loop that fills it.
    //
    // They disagreed. The array was sized for 280 stars, 90 were filled, and
    // the draw loop ran all 280 — so 190 times a frame it read a size of zero,
    // computed a negative alpha, built the string "rgba(206,216,236,-0.020)"
    // for the canvas to parse and discard, and filled a rectangle of no area.
    // Pure waste, and about 11,400 dead strings a second of it, on the one
    // pass that runs whatever else is on screen.
    //
    // Held at what is actually drawn today rather than what the comment below
    // wanted, because the two are not the same picture and which one to ship
    // is not a performance question. See the note in TASKS.md.
    this.dust = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      this.dust[i * 3] = hash01(`dust:x:${i}`);
      this.dust[i * 3 + 1] = hash01(`dust:y:${i}`);
      // Cubed, so the distribution is heavily weighted to the small end: a few
      // hundred pinpricks, a dozen with any real size to them.
      const r = hash01(`dust:s:${i}`);
      this.dust[i * 3 + 2] = 0.35 + r * r * r * 2.2;
    }
    this.resize();
  }

  setPerformance(p: CompiledPerformance | null, at = 0) {
    this.perf = p;
    this.lastT = -1;
    this.nodeBySha.clear();
    this.aggregateByNode = [];
    this.aggregateEdges = [];
    this.unknownEdges = [];
    this.mergeLabelNodes = [];
    this.taggedNodes = [];
    this.labelThreads = [];
    this.tipThreads = [];
    this.nodesByX = new Int32Array(0);
    this.edgeBuckets = [];
    this.longEdges = [];
    this.longLevels = [];
    this.edgeSeen = new Uint32Array(0);
    this.edgeCandidates.length = 0;
    if (!p) return;
    for (const nd of p.nodes) this.nodeBySha.set(nd.sha, nd);
    this.tints = p.threads.map((t) => threadTint(t.side, t.lane, this.settings.highContrast));
    this.impactEvents = p.events.filter((e) => HEAVY.has(e.type) || e.type === 'DIVERGENCE' || e.type === 'TAG_LANDMARK' || e.type === 'REPO_BIRTH' || e.type === 'MULTI_ROOT_REVEAL' || e.type === 'REPO_PRESENT');
    this.aggregateByNode = new Array<AggregateSpan | null>(p.nodes.length).fill(null);
    for (const aggregate of p.aggregates) {
      const exit = this.nodeBySha.get(aggregate.boundaryShas[1]!);
      if (exit) this.aggregateByNode[exit.idx] = aggregate;
    }
    // Kept with their positions in `p.edges`, because that — not `edge.idx` —
    // is what indexes `edgeBounds`. Assuming the two agree is the kind of thing
    // that silently reads someone else's rectangle.
    this.aggregateEdges = [];
    this.aggregateEdgePos = [];
    this.aggLevels = [];
    p.edges.forEach((edge, i) => {
      if (edge.kind !== 'aggregate') return;
      this.aggregateEdges.push(edge);
      this.aggregateEdgePos.push(i);
    });
    this.unknownEdges = p.edges.filter((edge) => edge.kind === 'unknown');
    this.mergeLabelNodes = p.nodes.filter((node) => node.isMerge && node.mergeVolume >= 6);
    this.taggedNodes = p.nodes.filter((node) => node.tagLabels.length > 0);
    const nameAnonymousThreads = p.stats.threads <= 40;
    this.labelThreads = p.threads.filter((thread) => thread.role !== 'primary' && (!!thread.label || nameAnonymousThreads));
    this.tipThreads = p.threads.filter((thread) => thread.ending === 'tip');
    this.edgeBounds = new Float32Array(p.edges.length * 4);
    this.edgeBucketOrigin = Math.floor(p.bounds.minX / EDGE_BUCKET_WIDTH) * EDGE_BUCKET_WIDTH;
    const bucketCount = Math.max(1, Math.ceil((p.bounds.maxX - this.edgeBucketOrigin) / EDGE_BUCKET_WIDTH) + 1);
    this.edgeBuckets = Array.from({ length: bucketCount }, () => []);
    this.edgeSeen = new Uint32Array(p.edges.length);
    p.edges.forEach((e, i) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < e.pts.length; k += 2) {
        const x = e.pts[k]!;
        const y = e.pts[k + 1]!;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      this.edgeBounds[i * 4] = x0 - 12;
      this.edgeBounds[i * 4 + 1] = y0 - 12;
      this.edgeBounds[i * 4 + 2] = x1 + 12;
      this.edgeBounds[i * 4 + 3] = y1 + 12;
      const firstBucket = Math.max(0, Math.floor((x0 - 12 - this.edgeBucketOrigin) / EDGE_BUCKET_WIDTH));
      const lastBucket = Math.min(bucketCount - 1, Math.floor((x1 + 12 - this.edgeBucketOrigin) / EDGE_BUCKET_WIDTH));
      // A long-lived branch can cross most of a million-pixel history. Copying
      // its index into every bucket turns a compact spatial index into millions
      // of entries. Keep those rare edges in one exact fallback list instead.
      if (lastBucket - firstBucket > MAX_EDGE_BUCKET_SPAN) this.longEdges.push(i);
      else for (let bucket = firstBucket; bucket <= lastBucket; bucket++) this.edgeBuckets[bucket]!.push(i);
    });
    // Long edges by span, then by left end. Same placement requirement as the
    // ribbon index below: `edgeBounds` has to be full before any of it is read.
    this.longLevels = [];
    if (this.longEdges.length) {
      const byLevel = new Map<number, number[]>();
      for (const edge of this.longEdges) {
        const b4 = edge * 4;
        const span = this.edgeBounds[b4 + 2]! - this.edgeBounds[b4]!;
        const level = Math.ceil(Math.log2(Math.max(1, span)));
        const list = byLevel.get(level);
        if (list) list.push(edge);
        else byLevel.set(level, [edge]);
      }
      for (const list of byLevel.values()) {
        list.sort((m, n) => this.edgeBounds[m * 4]! - this.edgeBounds[n * 4]!);
        let maxSpan = 0;
        for (const edge of list) {
          const b4 = edge * 4;
          const span = this.edgeBounds[b4 + 2]! - this.edgeBounds[b4]!;
          if (span > maxSpan) maxSpan = span;
        }
        // The real widest in this group, not the power of two that named it:
        // 2^L would start every walk further left than it has to.
        this.longLevels.push({ idx: Int32Array.from(list), minX: Float64Array.from(list, (e) => this.edgeBounds[e * 4]!), maxSpan });
      }
    }
    // Ribbons by world x, built once. It has to come after the loop that fills
    // `edgeBounds`, not before it — built too early every span reads zero, the
    // search finds nothing, and the captions quietly stop appearing.
    {
      const order = this.aggregateEdgePos.map((_, k) => k);
      order.sort((a, b) => this.edgeBounds[this.aggregateEdgePos[a]! * 4]! - this.edgeBounds[this.aggregateEdgePos[b]! * 4]!);
      this.aggByMinX = Int32Array.from(order);
      this.aggMinX = Float64Array.from(order, (k) => this.edgeBounds[this.aggregateEdgePos[k]! * 4]!);
      const byLevel = new Map<number, number[]>();
      for (let oi = 0; oi < this.aggByMinX.length; oi++) {
        const eb = this.aggregateEdgePos[this.aggByMinX[oi]!]! * 4;
        const span = this.edgeBounds[eb + 2]! - this.edgeBounds[eb]!;
        const level = Math.ceil(Math.log2(Math.max(1, span)));
        const list = byLevel.get(level);
        if (list) list.push(oi);
        else byLevel.set(level, [oi]);
      }
      this.aggLevels = [];
      for (const list of byLevel.values()) {
        // Already ascending: `oi` was walked in order.
        let maxSpan = 0;
        for (const oi of list) {
          const eb = this.aggregateEdgePos[this.aggByMinX[oi]!]! * 4;
          const span = this.edgeBounds[eb + 2]! - this.edgeBounds[eb]!;
          if (span > maxSpan) maxSpan = span;
        }
        this.aggLevels.push({ pos: Int32Array.from(list), minX: Float64Array.from(list, (oi) => this.aggMinX[oi]!), maxSpan });
      }
    }
    const order = new Int32Array(p.nodes.length);
    for (let i = 0; i < order.length; i++) order[i] = i;
    order.sort((a, b) => p.nodes[a]!.impact - p.nodes[b]!.impact);
    this.byImpact = order;
    const byX = new Int32Array(p.nodes.length);
    for (let i = 0; i < byX.length; i++) byX[i] = i;
    byX.sort((a, b) => p.nodes[a]!.x - p.nodes[b]!.x || a - b);
    this.nodesByX = byX;
    this.resetLanded();
    this.mainLabelAt = null;
    this.shopView = null;
    const first = p.camera.length ? sampleCamera(p.camera,at) : null;
    if (first) {
      this.lastCue = first;
      this.applyCamera(first, 0, at);
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dprCap = this.settings.quality === 'full' ? 2 : this.settings.quality === 'reduced' ? 1.5 : 1;
    this.dpr = Math.min(dprCap, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.glow.width = Math.max(1, Math.round(this.canvas.width / 2));
    this.glow.height = Math.max(1, Math.round(this.canvas.height / 2));
  }

  get camera(): CameraCue | null {
    return this.lastCue;
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    const v = this.view;
    const dx = x - v.cx;
    const dy = y - v.cy;
    const cos = Math.cos(v.rotation);
    const sin = Math.sin(v.rotation);
    return { x: v.ox + (dx * cos - dy * sin) * v.scale, y: v.oy + (dx * sin + dy * cos) * v.scale };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const v = this.view;
    const dx = (sx - v.ox) / v.scale;
    const dy = (sy - v.oy) / v.scale;
    const cos = Math.cos(-v.rotation);
    const sin = Math.sin(-v.rotation);
    return { x: v.cx + dx * cos - dy * sin, y: v.cy + dx * sin + dy * cos };
  }

  /** Current view for manual camera continuity. */
  currentManual(): ManualCamera {
    return { x: this.view.cx, y: this.view.cy, scale: this.view.scale };
  }

  /**
   * The world rectangle currently on screen. Panning controls need to know how
   * much of the picture a viewer can see, not just where the camera is: at the
   * end of a performance that is the difference between a slider that scrolls
   * and one that has nothing left to scroll through.
   */
  viewport(): { cx: number; cy: number; scale: number; worldW: number; worldH: number } {
    const s = this.settings.safe;
    const safeW = Math.max(80, this.width - s.left - s.right);
    const safeH = Math.max(80, this.height - s.top - s.bottom);
    return {
      cx: this.view.cx,
      cy: this.view.cy,
      scale: this.view.scale,
      worldW: safeW / Math.max(1e-6, this.view.scale),
      worldH: safeH / Math.max(1e-6, this.view.scale),
    };
  }

  pick(sx: number, sy: number, t: number): Pick {
    const p = this.perf;
    if (!p) return { node: null, aggregateEdge: null };
    let best: NodeGeom | null = null;
    let bestD = 14;
    for (const nd of p.nodes) {
      if (nd.impact > t) continue;
      const s = this.worldToScreen(nd.x, nd.y);
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < bestD) {
        bestD = d;
        best = nd;
      }
    }
    if (best) return { node: best, aggregateEdge: null };
    for (const e of p.edges) {
      if (e.kind !== 'aggregate' || e.start > t) continue;
      const m = pointAt(e.pts, 0.5, this.tmp);
      const s = this.worldToScreen(m.x, m.y);
      if (Math.hypot(s.x - sx, s.y - sy) < 16) return { node: null, aggregateEdge: e };
    }
    return { node: null, aggregateEdge: null };
  }

  private resetLanded() {
    this.landedPtr = 0;
    this.landedT = -1;
    this.landed = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  }

  /**
   * The rectangle the work of the last few seconds occupies.
   *
   * Not everything drawn: everything *recent*. Framing the whole of what has
   * landed works on a short history and fails on a long one, because the box
   * only ever grows — a seventy-second path ends up an inch of hairlines while
   * the camera keeps retreating to hold onto commits from a minute ago. A
   * trailing window is scale-free: it is as wide as the work is fast and as
   * tall as the number of threads currently open, so the framing follows the
   * density of the history rather than its length.
   *
   * The head pointer advances with the clock and only the tail is rescanned,
   * so the cost is the size of the window rather than the size of the history,
   * and the scan is bounded in case a history lands hundreds of commits a
   * second.
   */
  private recentBounds(t: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const p = this.perf;
    if (!p) return null;
    if (t < this.landedT) this.resetLanded();
    this.landedT = t;
    while (this.landedPtr < this.byImpact.length && p.nodes[this.byImpact[this.landedPtr]!]!.impact <= t) this.landedPtr++;
    if (this.landedPtr === 0) return null;
    const b = this.landed;
    b.minX = Infinity;
    b.minY = Infinity;
    b.maxX = -Infinity;
    b.maxY = -Infinity;
    const floor = Math.max(0, this.landedPtr - 500);
    const since = t - 9;
    for (let i = this.landedPtr - 1; i >= floor; i--) {
      const nd = p.nodes[this.byImpact[i]!]!;
      // Always take a few, so a quiet stretch with nothing recent still has a
      // box rather than falling back to the director's framing mid-page.
      if (nd.impact < since && this.landedPtr - i > 8) break;
      if (nd.x < b.minX) b.minX = nd.x;
      if (nd.x > b.maxX) b.maxX = nd.x;
      if (nd.y < b.minY) b.minY = nd.y;
      if (nd.y > b.maxY) b.maxY = nd.y;
    }
    return b;
  }

  /**
   * Frame what has been drawn so far, filling the canvas rather than fitting
   * inside it.
   *
   * A history is many times wider than it is tall, so framing one whole
   * letterboxes it into a thin band across the middle with black above and
   * below. Covering instead — the larger of the two fit ratios — crops the
   * older end and puts real work in every corner, which is what a shop window
   * is for. The newest arrivals sit four fifths of the way across: far enough
   * from the edge that their halos are not clipped, close enough that the
   * space in front of them — where nothing has happened yet — is a fifth of
   * the frame rather than half of it, which is what the director's framing
   * left there.
   *
   * The zoom is clamped at both ends, and the floor is the one that matters.
   * A long history keeps growing sideways, so a camera that always frames
   * everything drawn keeps pulling back: by the end of a seventy-second path
   * the picture had shrunk to hairlines a pixel wide. Past the floor the
   * camera stops widening and travels instead, which keeps threads the same
   * legible size however much history is behind them. The ceiling is the
   * opposite case — a history that has only just begun, blown up into three
   * enormous circles.
   */
  private applyShopWindow(t: number, dtReal: number): boolean {
    const b = this.recentBounds(t);
    if (!b) return false;
    const safeW = Math.max(80, this.width);
    const safeH = Math.max(80, this.height);
    const bh = Math.max(200, b.maxY - b.minY);
    // Fill the height, not the box.
    //
    // Fitting the whole recent-work box inside the frame letterboxes it, and
    // measuring the result made that unarguable: ink per horizontal twelfth of
    // the canvas came out [0,0,0,0, 8.1, 5.5, 6.2, 5.0, 0,0,0,0]. Not dim at
    // the edges — *zero*. Two thirds of the page was empty because a history
    // is far wider than it is tall, so fitting both axes is really fitting the
    // width and letting the height fall where it may.
    //
    // A history running off the left and right edges is what a history looks
    // like; there is always more of it in both directions. Running out of
    // picture vertically is just a void. So the vertical axis is what gets
    // filled, with a margin, and the horizontal is allowed to overflow.
    // Air around the work, not a picture pressed against the glass.
    //
    // Filling the height edge to edge fixed the letterboxing but overcorrected:
    // threads ran off all four sides, so there was nowhere to see a thread
    // arrive from or watch one leave, and behind a page of copy there was
    // nowhere for the eye to rest. Two thirds of the height leaves roughly a
    // sixth of the frame as margin above and below — enough to anticipate what
    // is coming rather than only see what has arrived.
    const vertical = (safeH * 0.64) / bh;
    // Bounded at both ends: a moment with three lanes open would otherwise be
    // magnified until three strokes fill the screen, and one with fourteen
    // would retreat until they are hairlines.
    const scale = Math.min(Math.max(vertical, 0.45), 1.9);
    const winW = safeW / scale;
    // Clear of the right border by this much, in screen pixels rather than a
    // share of the frame, because it is the halo of one spark that has to fit
    // and that is the same size at every zoom.
    //
    // Eighty rather than the fifty asked for, because the front is read one
    // frame late: a body can travel a good twenty-five pixels between the
    // draw that reports it and the frame that acts on it. At sixty the worst
    // case measured 35px of clearance; at eighty the worst case is comfortably
    // the other side of fifty and the median sits inside the range wanted.
    const FRONT_MARGIN = 80;
    const front = Math.max(b.maxX, Number.isFinite(this.frontPrev) ? this.frontPrev : -Infinity);
    const target = {
      // Far enough left that the front of the work clears the right border.
      //
      // This used to place the newest *landed* commit four fifths of the way
      // across and trust the remaining fifth to hold whatever was in flight in
      // front of it. It did not: measured over forty frames of the landing,
      // something was past the right border on twenty-six of them, by as much
      // as 76px, and not one frame had so much as 50px of clearance. A shop
      // window with the goods hanging out of it.
      //
      // So the front is measured rather than assumed — `frontWorldX`, the
      // rightmost point any body was actually drawn at — and the camera is
      // placed to leave it a fixed margin of real pixels. `b.maxX` stays in as
      // the floor for the moment nothing is travelling at all.
      //
      // The rest of what was written here still holds and is why the margin is
      // a margin and not a bigger fraction: ink by twelfth of the frame runs
      // 4.9 5.2 5.5 5.7 6.1 6.2 6.4 5.6 4.7 3.9 2.7 1.7, which looks like a
      // camera standing ahead of its subject and is not. Closing the gap to a
      // twentieth raised the right third's coverage from 0.57 of the left's to
      // 0.93 and put 99% of the travelling bodies off the edge. The right of
      // this frame is meant to be sparse. It is where the work is arriving.
      //
      // It looks like spare room. Mean ink coverage by twelfth of the frame
      // runs 4.9 5.2 5.5 5.7 6.1 6.2 6.4 5.6 4.7 3.9 2.7 1.7 — a picture that
      // peaks two thirds across and thins towards the right edge, which reads
      // as a camera standing ahead of its subject. It is not. `recentBounds`
      // measures commits that have *landed*, and the comets travelling toward
      // commits that have not are all in front of it: at this framing a third
      // of everything in flight is already within 40px of the right edge.
      // Closing the gap to a twentieth raised the right-hand third's coverage
      // from 0.57 of the left's to 0.93 and put 99% of the travelling bodies
      // off the edge, up to 294px past it — the picture gets fuller and the
      // live half of it goes missing. The right of this frame is meant to be
      // sparse. It is where the work is arriving.
      cx: Math.max(b.maxX + winW * 0.2, front + FRONT_MARGIN / scale) - winW / 2,
      cy: (b.minY + b.maxY) / 2,
      scale,
    };
    // Nodes land in steps, so an unsmoothed box snaps sideways every arrival.
    // A slow follow turns that into a drift; `dtReal` is zero on a seek, which
    // is exactly when the framing should cut rather than glide.
    // Slower than the director's follow. Behind a page of copy, movement in
    // the corner of the eye is the whole cost and none of the benefit: the
    // picture only has to look alive, not keep up. At 2.4 the frame chased
    // every arrival and the page felt busy in a way nobody could point at.
    const k = dtReal > 0 ? 1 - Math.exp(-dtReal * 0.9) : 1;
    const v = this.shopView ?? target;
    this.shopView = {
      cx: v.cx + (target.cx - v.cx) * k,
      cy: v.cy + (target.cy - v.cy) * k,
      scale: v.scale + (target.scale - v.scale) * k,
    };
    // The margin is a floor, not a target.
    //
    // Aiming the smoothed follow at it was not enough: this follow is
    // deliberately slow — a page being read cannot have the corner of its eye
    // twitching — so the target moved and the view trailed, and the work got
    // out anyway. Measured, 23 frames in 40 still had something past the
    // border. So the drift stays gentle in the direction that does not matter
    // and is overruled outright in the direction that does. The camera may lag
    // behind the work; it may not let the work leave the frame.
    const floorCx = front + FRONT_MARGIN / this.shopView.scale - safeW / this.shopView.scale / 2;
    if (this.shopView.cx < floorCx) this.shopView.cx = floorCx;
    // No punch at all. A merge landing hard is the right instinct on a stage
    // being watched and the wrong one behind a form being read: the page moved
    // under the reader for a reason they could not see, which is the precise
    // description of "overstimulating".
    const punch = 1;
    this.view = { scale: this.shopView.scale * punch, ox: safeW / 2, oy: safeH / 2, rotation: 0, cx: this.shopView.cx, cy: this.shopView.cy };
    return true;
  }

  /**
   * Is this cue a rectangle?
   *
   * It is not a rhetorical question. The director plans its shots by
   * integrating a critically damped spring at a step that stretches with the
   * length of the performance, and past a certain length that integration is
   * unstable: on a twelve-hour history the fourth keyframe already carries a
   * non-finite width, and the centre reaches 1e305 shortly after. The renderer
   * then computes `min(safeW / w, safeH / h)` — infinity — and culls the entire
   * history against a viewport that is a point at the far end of the number
   * line. Every measurement of "why is this slow" on such a plan is really a
   * measurement of a blank screen.
   *
   * Believing a cue that is not a rectangle is the one thing worse than not
   * having one, so the test is deliberately narrow: finite centre, positive
   * finite extents, and a centre somewhere near the work. Anything a sound
   * plan produces passes untouched, so this costs four comparisons a frame and
   * changes nothing about a history whose camera converged.
   */
  private usableCue(cue: CameraCue): boolean {
    if (!Number.isFinite(cue.x) || !Number.isFinite(cue.y)) return false;
    if (!(cue.w > 0) || !(cue.h > 0) || !Number.isFinite(cue.w) || !Number.isFinite(cue.h)) return false;
    const p = this.perf;
    if (!p) return true;
    const span = Math.max(1, p.bounds.maxX - p.bounds.minX);
    return cue.x >= p.bounds.minX - span && cue.x <= p.bounds.maxX + span;
  }

  /**
   * Where to point when the plan cannot say.
   *
   * The closing tableau is the whole picture, which the plan's own bounds
   * describe exactly. Everywhere else it is the work of the last few seconds —
   * the same trailing window the shop window uses, for the same reason: it is
   * scale-free, so it follows the density of the history rather than its
   * length. Smoothed, because the box steps as commits land, and cut rather
   * than glided when `dtReal` is zero, which is what a seek looks like.
   */
  private rescueCue(cue: CameraCue, t: number, dtReal: number): CameraCue {
    const p = this.perf!;
    const b = cue.state === 'tableau' ? null : this.recentBounds(t);
    const box = b ?? p.bounds;
    const target = {
      cx: (box.minX + box.maxX) / 2,
      cy: (box.minY + box.maxY) / 2,
      w: Math.max(900, (box.maxX - box.minX) * 1.2 + 260),
      h: Math.max(480, (box.maxY - box.minY) * 1.3 + 180),
    };
    const k = dtReal > 0 ? 1 - Math.exp(-dtReal * 2.4) : 1;
    const v = this.rescueView ?? target;
    this.rescueView = {
      cx: v.cx + (target.cx - v.cx) * k,
      cy: v.cy + (target.cy - v.cy) * k,
      w: v.w + (target.w - v.w) * k,
      h: v.h + (target.h - v.h) * k,
    };
    const r = this.rescueView;
    return { ...cue, x: r.cx, y: r.cy, w: r.w, h: r.h, rotation: 0, punch: 1 };
  }

  private applyCamera(planned: CameraCue, dtReal: number, t: number) {
    const s = this.settings.safe;
    const safeW = Math.max(80, this.width - s.left - s.right);
    const safeH = Math.max(80, this.height - s.top - s.bottom);
    if (this.manual) {
      if(this.perf?.window)this.manual.scale=Math.max(this.manual.scale,safeW/16000);
      this.view = { scale: this.manual.scale, ox: s.left + safeW / 2, oy: s.top + safeH / 2, rotation: 0, cx: this.manual.x, cy: this.manual.y };
      return;
    }
    const sound = this.usableCue(planned);
    if (sound) this.rescueView = null;
    const cue = sound ? planned : this.rescueCue(planned, t, dtReal);
    if (renderProfile.enabled && !sound) renderProfile.counts.rescuedCues++;
    const targetPunch = this.settings.reducedMotion ? 1 : cue.punch;
    const k = dtReal > 0 ? 1 - Math.exp(-dtReal * 14) : 1;
    this.smoothedPunch += (targetPunch - this.smoothedPunch) * k;
    if (this.shopWindow && this.applyShopWindow(t, dtReal)) return;
    const fit = Math.min(safeW / cue.w, safeH / cue.h);
    // Never so far out that two lanes become one line.
    //
    // Branches sit `LANE_GAP` apart in world units, and the camera fits the
    // box the work occupies — so the more branches are open, the further it
    // pulls back and the fewer screen pixels that gap becomes. Measured on
    // Kubernetes at the same moment: 34.6px between lanes in a 1920x1080
    // window, 27.4px at 1440x900, and **16.4px** in a 1855x620 one. Add each
    // line's glow to that and neighbouring lanes fuse into a single bright
    // band — which is what a viewer reported twice, once as branches drawn on
    // the main line and once as branches running past it. Neither was true;
    // nothing is drawn at the spine's height beyond its tip. They were its
    // neighbours, too close to tell apart.
    //
    // Note that widening `LANE_GAP` cannot fix this: a wider gap makes a
    // proportionally taller box, `fit` shrinks by the same factor, and the
    // picture comes out pixel-for-pixel identical. The only lever is the zoom,
    // so this is a floor on it — past this point the camera stops widening and
    // simply shows fewer lanes, which is the same trade the horizontal floor
    // already makes for length.
    //
    // A tableau is exempt. That shot exists to show the whole shape at once
    // and is the one place a hairline picture is the point.
    const laneFloor = cue.state === 'tableau' ? 0 : MIN_LANE_PX / LANE_GAP;
    const scale = Math.max(this.perf?.window?safeW/16000:0,(this.zoomLock ?? fit) * this.smoothedPunch, this.zoomLock != null ? 0 : laneFloor);
    this.view = {
      scale,
      ox: s.left + safeW / 2,
      oy: s.top + safeH / 2,
      rotation: this.settings.reducedMotion ? 0 : cue.rotation,
      cx: cue.x,
      cy: cue.y,
    };
    // The head of the main line is kept between three fifths and seven tenths
    // of the way across.
    //
    // The director composes a shot around the phrase it is playing, and that
    // is frequently nowhere near the end of the spine: measured on a seek into
    // CPython, every travelling body sat about five thousand pixels off the
    // left of the frame, and on Kubernetes a fifth of them were off the left
    // edge deep into the performance. The main line is the thing everything
    // else is described relative to, so losing it is not a framing choice.
    //
    // A band and not a fixed column, so the director still composes freely
    // whenever the head is already somewhere sensible; the camera only moves
    // when the head would otherwise leave the band, and then only far enough
    // to bring it back to the near edge. Applied after the cue so the shot's
    // scale, rotation and vertical framing are untouched — this is a
    // horizontal correction and nothing else.
    const head = this.spineTip(t);
    if (head && this.view.scale > 0) {
      const lo = this.width * 0.6;
      const hi = this.width * 0.7;
      const sx = this.worldToScreen(head.x, head.y).x;
      if (sx < lo || sx > hi) this.view.cx += (sx - (sx < lo ? lo : hi)) / this.view.scale;
    }
  }

  /**
   * The far end of the main line *as drawn*, which is not the last commit on it.
   *
   * An edge is revealed up to `travelU`, so at any moment the spine is drawn
   * some way past the newest commit that has landed — it is mid-stroke toward
   * the next one. Placing the nameplate against the last landed commit
   * therefore put it behind the visible end of the line, by however far the
   * current stroke had got: it reads as the label trailing the line rather
   * than leading it, and on a fast history the gap is most of the distance
   * between two commits.
   *
   * So this interpolates between the head and the commit after it by how much
   * of that stroke has been drawn. The spine is laid out flat and evenly in x,
   * so the eased reveal and the linear interpolation differ by a pixel or two
   * at most — far less than the tens of pixels of error being corrected.
   */
  private spineTip(t: number): { x: number; y: number } | null {
    const p = this.perf;
    const spine = p?.threads[0];
    const head = this.spineHead(t);
    if (!p || !spine || !head) return null;
    if (this.tipFrame === this.frameCounter && this.tipAt === t) return this.tipPos;
    let next: NodeGeom | null = null;
    if (this.headIdx >= 0 && this.headIdx + 1 < spine.nodeIdxs.length) next = p.nodes[spine.nodeIdxs[this.headIdx + 1]!]!;
    let x = head.x;
    let y = head.y;
    if (next && next.impact > head.impact) {
      const f = Math.max(0, Math.min(1, (t - head.impact) / (next.impact - head.impact)));
      x = head.x + (next.x - head.x) * f;
      y = head.y + (next.y - head.y) * f;
    }
    this.tipFrame = this.frameCounter;
    this.tipAt = t;
    this.tipPos = { x, y };
    return this.tipPos;
  }
  private tipFrame = -1;
  private tipAt = NaN;
  private tipPos: { x: number; y: number } | null = null;

  /**
   * The newest commit on the main line that has landed.
   *
   * Binary search, because the spine can be a third of a million commits, and
   * cached for the frame because both the camera and the nameplate want it.
   */
  private spineHead(t: number): NodeGeom | null {
    const p = this.perf;
    const spine = p?.threads[0];
    if (!p || !spine || !spine.nodeIdxs.length) return null;
    if (this.headFrame === this.frameCounter && this.headAt === t) return this.headNode;
    let lo = 0;
    let hi = spine.nodeIdxs.length - 1;
    let at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (p.nodes[spine.nodeIdxs[mid]!]!.impact <= t) {
        at = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    this.headFrame = this.frameCounter;
    this.headAt = t;
    this.headIdx = at;
    this.headNode = at >= 0 ? p.nodes[spine.nodeIdxs[at]!]! : null;
    return this.headNode;
  }
  /**
   * The rightmost point any body was drawn at last frame, in world units.
   *
   * Read one frame late on purpose: the framing needs to know where the front
   * of the work is before it draws, and the only thing that knows is the draw.
   * A frame of lag on a camera that is already smoothed is invisible.
   */
  private frontWorldX = -Infinity;
  private frontPrev = -Infinity;
  private headIdx = -1;
  private headFrame = -1;
  private headAt = NaN;
  private headNode: NodeGeom | null = null;

  /**
   * Edges touching the current horizontal view, in the compiler's draw order.
   * Returning null deliberately selects the straight full scan when a tableau
   * covers most of the history; merging buckets would cost more in that case.
   */
  private visibleEdgeIndices(x0: number, x1: number): number[] | null {
    if (!this.edgeBuckets.length) return null;
    const first = Math.max(0, Math.floor((x0 - this.edgeBucketOrigin) / EDGE_BUCKET_WIDTH));
    const last = Math.min(this.edgeBuckets.length - 1, Math.floor((x1 - this.edgeBucketOrigin) / EDGE_BUCKET_WIDTH));
    if (last < first || last - first + 1 > this.edgeBuckets.length / 2) return null;
    this.edgeGeneration++;
    if (this.edgeGeneration === 0xffff_ffff) {
      this.edgeSeen.fill(0);
      this.edgeGeneration = 1;
    }
    const mark = this.edgeGeneration;
    const candidates = this.edgeCandidates;
    candidates.length = 0;
    // Edges too long to bucket usefully, filtered by the same bounds test the
    // draw loop would apply a moment later. Taking them all was cheap to write
    // and expensive to run: Linux has about 109,000 of them, so every frame
    // built a 109,000-entry array and then *sorted* it, to draw thirteen
    // edges. Rejecting them here changes nothing about what is drawn.
    //
    // Reached through `longLevels` rather than scanned. Each group holds
    // nothing wider than its own `maxSpan`, so the first edge that can reach
    // `x0` is the first whose left end is at or past `x0 - maxSpan`, and the
    // walk ends as soon as left ends pass `x1`. Same test, same survivors.
    for (const level of this.longLevels) {
      const minX = level.minX;
      const lo0 = x0 - level.maxSpan;
      let lo = 0;
      let hi = minX.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (minX[mid]! < lo0) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < minX.length && minX[i]! <= x1; i++) {
        const edge = level.idx[i]!;
        if (this.edgeBounds[edge * 4 + 2]! < x0) continue;
        this.edgeSeen[edge] = mark;
        candidates.push(edge);
      }
    }
    for (let bucket = first; bucket <= last; bucket++) {
      for (const edge of this.edgeBuckets[bucket]!) {
        if (this.edgeSeen[edge] === mark) continue;
        this.edgeSeen[edge] = mark;
        candidates.push(edge);
      }
    }
    candidates.sort((a, b) => a - b);
    return candidates;
  }

  render(t: number, dtReal: number) {
    const ctx = this.ctx;
    const p = this.perf;
    this.frameCounter++;
    this.frontPrev = this.frontWorldX;
    this.frontWorldX = -Infinity;
    const prof = renderProfile.enabled ? renderProfile : null;
    let mark = prof ? performance.now() : 0;
    const started = mark;
    const lap = (k: keyof typeof renderProfile.ms) => {
      if (!prof) return;
      const n = performance.now();
      prof.ms[k] += n - mark;
      mark = n;
    };
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(t);
    lap('background');
    if (!p) {
      this.drawEmptyStage(t);
      return;
    }
    const cue = sampleCamera(p.camera, t);
    this.lastCue = cue;
    this.applyCamera(cue, this.lastT < 0 || Math.abs(t - this.lastT) > 1 ? 0 : dtReal, t);
    this.lastT = t;
    lap('camera');
    if (p.nodes.length === 0) {
      this.drawEmptyStage(t);
      return;
    }

    const v = this.view;
    ctx.save();
    ctx.translate(v.ox, v.oy);
    ctx.rotate(v.rotation);
    ctx.scale(v.scale, v.scale);
    ctx.translate(-v.cx, -v.cy);

    // Visible world rect (with margin) for culling.
    const inv = 1 / v.scale;
    const halfW = (this.width * inv) / 2 + 80;
    const halfH = (this.height * inv) / 2 + 80;
    const vx0 = v.cx - halfW, vx1 = v.cx + halfW, vy0 = v.cy - halfH, vy1 = v.cy + halfH;
    if (prof) prof.view = { scale: v.scale, x0: vx0, x1: vx1, y0: vy0, y1: vy1 };
    // Padded by a fifth: the camera can be rolled, so an axis-aligned world box
    // is an approximation, and a stroke has width. Too generous costs a few
    // comparisons; too tight clips a line somebody can see.
    const clipPad = (vx1 - vx0) * 0.2;
    this.clipX0 = vx0 - clipPad;
    this.clipX1 = vx1 + clipPad;

    const useGlow = this.settings.quality === 'full' && !this.settings.reducedMotion;
    const glow = this.glowCtx;
    if (useGlow) {
      glow.setTransform(1, 0, 0, 1, 0, 0);
      glow.clearRect(0, 0, this.glow.width, this.glow.height);
      const gs = this.dpr / 2;
      glow.setTransform(gs, 0, 0, gs, 0, 0);
      glow.translate(v.ox, v.oy);
      glow.rotate(v.rotation);
      glow.scale(v.scale, v.scale);
      glow.translate(-v.cx, -v.cy);
    }

    // Where the history-sweep light is right now: a slow pass over everything
    // that has already been drawn, repeating every twelve seconds.
    if (!this.settings.reducedMotion && p.nodes.length) {
      const span = Math.max(400, vx1 - p.bounds.minX + 400);
      this.sweepX = p.bounds.minX + ((t * 260) % span);
    } else this.sweepX = -Infinity;

    const ripples = this.activeRipples(t);
    const focus = this.settings.contributorFocus;
    const focusIdx = focus ? p.contributors.findIndex((c) => c.id === focus) : -1;
    const dimForFocus = focusIdx >= 0 ? 0.28 : 1;
    const hc = this.settings.highContrast;
    const ivory = hc ? PALETTE.highContrast.ivory : PALETTE.ivory;
    const slate = hc ? PALETTE.highContrast.slate : PALETTE.slate;

    // --- Edges ---
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const edges = p.edges;
    const activeEdges: EdgeGeom[] = [];
    const visibleEdges = this.visibleEdgeIndices(vx0, vx1);
    const edgeCount = visibleEdges?.length ?? edges.length;
    let edgesWalked = 0;
    for (let at = 0; at < edgeCount; at++) {
      const i = visibleEdges ? visibleEdges[at]! : at;
      const e = edges[i]!;
      edgesWalked++;
      if (e.start > t) {
        if (e.start > t + 3) {
          // edges are sorted by start: everything after is in the future
          break;
        }
        continue;
      }
      const b = i * 4;
      if (this.edgeBounds[b + 2]! < vx0 || this.edgeBounds[b]! > vx1 || this.edgeBounds[b + 3]! < vy0 || this.edgeBounds[b + 1]! > vy1) continue;
      if (e.end > t) {
        activeEdges.push(e);
        continue;
      }
      this.drawSettledEdge(ctx, e, t, ivory, slate, dimForFocus, focusIdx);
      if (prof) prof.counts.edgesDrawn++;
    }
    if (prof) {
      prof.counts.edgesConsidered += edgeCount;
      prof.counts.edgesWalked += edgesWalked;
      prof.counts.edgesActive += activeEdges.length;
    }
    lap('settledEdges');
    for (const e of activeEdges) this.drawActiveEdge(ctx, useGlow ? glow : null, e, t, ivory, slate, focusIdx);
    lap('activeEdges');

    // --- Nodes ---
    const nodes = p.nodes;
    let nodeLo = 0;
    let nodeHi = this.nodesByX.length;
    while (nodeLo < nodeHi) {
      const mid = (nodeLo + nodeHi) >> 1;
      if (nodes[this.nodesByX[mid]!]!.x < vx0) nodeLo = mid + 1;
      else nodeHi = mid;
    }
    let nodesWalked = 0;
    let nodesDrawn = 0;
    for (let at = nodeLo; at < this.nodesByX.length; at++) {
      const nd = nodes[this.nodesByX[at]!]!;
      if (nd.x > vx1) break;
      nodesWalked++;
      if (nd.impact > t + 0.001) continue;
      if (nd.y < vy0 || nd.y > vy1) continue;
      nodesDrawn++;
      this.drawNode(ctx, useGlow ? glow : null, nd, t, ripples, ivory, slate, focusIdx);
    }
    if (prof) {
      prof.counts.nodesWalked += nodesWalked;
      prof.counts.nodesDrawn += nodesDrawn;
    }
    lap('nodes');

    // --- Bodies ---
    //
    // How much comet each spark gets, decided once for the frame by how many
    // of them there are.
    //
    // A body is the most expensive thing on the stage: an eleven-point comet
    // trail, a halo, two glyphs, and — on a ribbon — up to twenty-four tick
    // marks, each of those a curve evaluation and a fill of its own. That is
    // fine at forty bodies and ruinous at three hundred and fifty, which is
    // where Linux peaks six hours in: measured at 13.64 ms of a 22.56 ms
    // frame, sixty per cent of it, and by far the largest single cost in the
    // renderer.
    //
    // It is also detail nobody can see at that density. Three hundred sparks
    // share the stage with a few pixels each; an eleven-point tail on a
    // three-pixel dot is not legible, it is just eleven fills. So the trail
    // shortens as the stage fills and lengthens again when it empties — which
    // is the same instinct as drawing less of what is far away, applied to
    // "far away" meaning "crowded".
    //
    // The thresholds are in bodies, not in milliseconds, so the picture is a
    // function of the history rather than of the machine: the same repository
    // looks the same on a fast laptop and a slow one, which matters for a
    // thing whose whole claim is that it shows you the repository.
    const liveBodies = activeEdges.length;
    this.bodyDetail = liveBodies <= 60 ? 1 : liveBodies <= 160 ? 0.55 : liveBodies <= 320 ? 0.3 : 0.15;
    // The same idea for the threads themselves, and it turned out to matter
    // more than the sparks did. Skipping the active-edge pass entirely took the
    // frame interval from 31.8 ms to 16.6 ms with no dropped frames, while
    // skipping bodies or settled edges changed nothing measurable — so this is
    // where the time on the *graphics card* goes, as opposed to the time in
    // JavaScript, which was already inside budget.
    //
    // Per edge, per frame, it was building a `createLinearGradient` object,
    // stroking a wide translucent path under `lighter` compositing, and
    // stroking it again into the glow layer. Two hundred and forty of those is
    // a lot of overdraw for a trail that, at this density, is a few pixels of
    // colour on a line already drawn.
    this.edgeDetail = liveBodies <= 60 ? 1 : liveBodies <= 160 ? 0.5 : 0.25;
    for (const e of activeEdges) this.drawBody(ctx, useGlow ? glow : null, e, t, focusIdx);
    lap('bodies');

    // --- Impact effects ---
    this.drawEffects(ctx, useGlow ? glow : null, t, ivory);
    lap('effects');

    // --- Live tip beacons ---
    //
    // A pulsing ring on every branch that never merged, which is exactly the
    // right emphasis on a stage somebody is reading and one more circle
    // behind a form. It also pulses, so it is the only thing on the landing
    // page moving in place rather than travelling — which is what makes the
    // eye keep returning to it.
    for (const th of this.shopWindow ? [] : this.tipThreads) {
      if (th.end > t) continue;
      const last = nodes[th.nodeIdxs[th.nodeIdxs.length - 1]!];
      if (!last || last.x < vx0 || last.x > vx1) continue;
      const pulse = this.settings.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.2 + last.idx);
      ctx.beginPath();
      ctx.arc(last.x, last.y, 7 + pulse * 3, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(last.isSpine ? ivory : PALETTE.accent, 0.25 + pulse * 0.25);
      ctx.lineWidth = 1.2 / Math.sqrt(v.scale);
      ctx.stroke();
    }

    ctx.restore();
    lap('tips');

    if (useGlow) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = 'blur(6px)';
      ctx.globalAlpha = this.settings.noFlash ? 0.55 : 0.85;
      ctx.drawImage(this.glow, 0, 0, this.glow.width, this.glow.height, 0, 0, this.canvas.width, this.canvas.height);
      if (this.shopWindow) {
        // A second, wider pass of the same light, so the picture reads as one
        // scene rather than a scatter of bright strokes. It was twice this
        // strength and the page paid for it: a background that wins the
        // attention it is competing for has stopped being a background. This
        // spreads light already drawn and claims nothing new.
        ctx.filter = 'blur(30px)';
        ctx.globalAlpha = this.settings.noFlash ? 0.08 : 0.14;
        ctx.drawImage(this.glow, 0, 0, this.glow.width, this.glow.height, 0, 0, this.canvas.width, this.canvas.height);
      }
      ctx.filter = 'none';
      ctx.restore();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    lap('glow');

    // --- Screen-space labels & selection ---
    this.drawLabels(ctx, t);
    if (this.attenuation < 1) {
      ctx.fillStyle = rgba(PALETTE.ink, 1 - this.attenuation);
      ctx.fillRect(0, 0, this.width, this.height);
    }
    lap('labels');
    if (prof) {
      prof.frames++;
      prof.ms.total += performance.now() - started;
    }
  }

  private drawBackground(t: number) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(0, 0, w, h);
    // Deep field rather than lit room.
    //
    // The centre glow was `rgba(26,30,44,0.55)` — a soft grey wash over the
    // middle of the screen, which lifted the whole stage toward slate and left
    // the history sitting *on* a surface rather than *in* a space. It is now
    // barely a fifth of that and tinted cold, so the corners stay genuinely
    // black and the only bright things on screen are the commits.
    // No centre glow.
    //
    // There was a radial gradient at 50%/44% lifting the middle of the stage,
    // and however faint a radial gradient is, it is a circle: it has a centre,
    // and a centre on an otherwise even field is a shape the eye finds. The
    // page had one of these in CSS and one here, and removing only the first
    // left the second sitting in the same place doing the same thing.
    //
    // What is left is two clouds well off the centre line, which give the
    // black some structure without putting a bullseye behind the copy. They do
    // not move, so nothing about them draws the eye a second time.
    for (const [cx, cy, rad, tint] of [
      [0.16, 0.2, 0.62, 'rgba(30,52,86,0.085)'],
      [0.86, 0.8, 0.68, 'rgba(52,34,74,0.07)'],
    ] as Array<[number, number, number, string]>) {
      const neb = ctx.createRadialGradient(w * cx, h * cy, 0, w * cx, h * cy, Math.max(w, h) * rad);
      neb.addColorStop(0, tint);
      neb.addColorStop(1, 'rgba(7,8,12,0)');
      ctx.fillStyle = neb;
      ctx.fillRect(0, 0, w, h);
    }

    if (this.settings.quality === 'minimal') return;

    // Stars. Deterministic, and slow enough that the drift is felt rather than
    // watched — anything faster reads as snow falling past the history.
    const drift = this.settings.reducedMotion ? 0 : t * 0.004;
    for (let i = 0; i < DUST_COUNT; i++) {
      const s = this.dust[i * 3 + 2]!;
      const x = ((this.dust[i * 3]! + drift * s * 0.4) % 1) * w;
      const y = ((this.dust[i * 3 + 1]! + drift * 0.22) % 1) * h;
      // Brightness follows size, so the small ones recede instead of forming an
      // even veil at one distance. The largest get a faint halo; a handful of
      // near stars is what makes the rest read as far away.
      const near = (s - 0.35) / 2.2;
      ctx.fillStyle = `rgba(206,216,236,${(0.06 + near * 0.5).toFixed(3)})`;
      ctx.fillRect(x, y, s, s);
      if (s > 1.9) {
        ctx.fillStyle = 'rgba(206,216,236,0.05)';
        ctx.fillRect(x - s * 0.6, y - s * 0.6, s * 2.2, s * 2.2);
      }
    }
  }

  private drawEmptyStage(t: number) {
    const ctx = this.ctx;
    const cx = this.width / 2;
    const cy = (this.height - this.settings.safe.bottom + this.settings.safe.top) / 2;
    const pulse = this.settings.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.4);
    ctx.beginPath();
    ctx.arc(cx, cy, 16 + pulse * 6, 0, Math.PI * 2);
    ctx.fillStyle = rgba(PALETTE.ivory, 0.06 + pulse * 0.05);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = rgba(PALETTE.ivory, 0.5);
    ctx.fill();
  }

  private settledAlpha(e: EdgeGeom, t: number): number {
    const p = this.perf!;
    const th = p.threads[e.threadIdx]!;
    const isSpine = p.nodes[e.child]!.isSpine && p.nodes[e.parent]?.isSpine !== false;
    if (isSpine && e.kind !== 'secondary') return 0.95;
    const age = t - e.end;
    const floor = th.ending === 'merged' ? 0.26 : 0.4;
    const base = e.kind === 'secondary' ? 0.5 : 0.78;
    return floor + (base - floor) * Math.exp(-age / 14);
  }

  /**
   * A path, with the parts nobody can see left off it.
   *
   * This used to emit every point of the polyline every frame. A thread that
   * stays open for months is thousands of points long, so drawing it cost
   * whatever its whole life cost — while at any moment a screen-width of it is
   * visible. That is the shape of "it gets slower the longer you watch" that
   * survives after the settled and label passes are bounded: the *live* work
   * grows with how much history each live thread has behind it.
   *
   * Segments outside the current world window are skipped and the pen is
   * lifted, so the next visible segment begins with a `moveTo`. A segment with
   * one endpoint inside is kept whole, and so is a long one that spans the view
   * with both endpoints outside — that is what the overlap test below asks,
   * rather than "is either endpoint visible", which would drop exactly the
   * segments that cross the screen.
   *
   * Cost is now proportional to what is on screen instead of to elapsed time,
   * which is the property that lets a very long performance stay flat.
   */
  private drawPolyline(ctx: CanvasRenderingContext2D, pts: Float32Array, u = 1) {
    const count = pts.length >> 1;
    if (count < 2) return;
    const x0 = this.clipX0;
    const x1 = this.clipX1;
    const f = u * (count - 1);
    const full = Math.min(count - 1, Math.floor(f));
    ctx.beginPath();
    // Where the pen currently sits, as a point index; -1 when it has been
    // lifted and the next visible segment has to start with a `moveTo`.
    let penAt = -1;
    const segment = (ax: number, ay: number, bx: number, by: number, ai: number, bi: number) => {
      if ((ax < x0 && bx < x0) || (ax > x1 && bx > x1)) {
        penAt = -1;
        return;
      }
      if (penAt !== ai) ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      penAt = bi;
    };
    for (let i = 1; i <= full; i++) {
      segment(pts[(i - 1) * 2]!, pts[(i - 1) * 2 + 1]!, pts[i * 2]!, pts[i * 2 + 1]!, i - 1, i);
    }
    if (full < count - 1) {
      const k = f - full;
      const x = pts[full * 2]! + (pts[full * 2 + 2]! - pts[full * 2]!) * k;
      const y = pts[full * 2 + 1]! + (pts[full * 2 + 3]! - pts[full * 2 + 1]!) * k;
      segment(pts[full * 2]!, pts[full * 2 + 1]!, x, y, full, -2);
    }
  }

  private drawSettledEdge(ctx: CanvasRenderingContext2D, e: EdgeGeom, t: number, ivory: string, slateBase: string, dim: number, focusIdx: number) {
    const p = this.perf!;
    const slate = this.tints[e.threadIdx] ?? slateBase;
    const child = p.nodes[e.child]!;
    const parent = e.parent >= 0 ? p.nodes[e.parent]! : null;
    const spine = child.isSpine && (parent ? parent.isSpine : true) && e.kind !== 'secondary';
    const threadSel = this.settings.selectedThread;
    const selected = threadSel != null && e.threadIdx === threadSel;
    let alpha = this.settledAlpha(e, t) * (selected ? 1 : dim);
    if (focusIdx >= 0 && (e.contributorIdx === focusIdx || e.fromContributorIdx === focusIdx)) alpha = Math.max(alpha, 0.85);
    const lw = 1 / Math.sqrt(this.view.scale);
    if (e.kind === 'unknown') {
      ctx.setLineDash([6, 7]);
      ctx.strokeStyle = rgba(PALETTE.fog, 0.55);
      ctx.lineWidth = 1.4 * lw;
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    if (e.kind === 'aggregate') {
      const count = this.aggregateByNode[e.child]?.memberCount ?? 0;
      const width = Math.min(16, 5 + Math.log2(1 + count) * 1.6);
      ctx.strokeStyle = rgba(spine ? ivory : slate, alpha * 0.28);
      ctx.lineWidth = width;
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      ctx.strokeStyle = rgba(spine ? ivory : slate, alpha * 0.75);
      ctx.lineWidth = 1.6;
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      return;
    }
    if (spine) {
      ctx.strokeStyle = rgba(ivory, alpha * 0.22);
      ctx.lineWidth = 7;
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      ctx.strokeStyle = rgba(ivory, alpha);
      ctx.lineWidth = 2.6;
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      // A slow light runs back along everything already built, so the finished
      // structure keeps breathing instead of turning into wallpaper.
      if (!this.settings.reducedMotion && this.sweepX > -Infinity) {
        const mid = (e.pts[0]! + e.pts[e.pts.length - 2]!) / 2;
        const d = Math.abs(mid - this.sweepX);
        if (d < 240) {
          const k = Math.pow(1 - d / 240, 2);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = rgba(ivory, 0.4 * k);
          ctx.lineWidth = 3.4;
          this.drawPolyline(ctx, e.pts);
          ctx.stroke();
          ctx.restore();
        }
      }
      return;
    }
    ctx.strokeStyle = rgba(selected ? PALETTE.accent : slate, alpha);
    ctx.lineWidth = e.kind === 'secondary' ? 1.1 : 1.7;
    this.drawPolyline(ctx, e.pts);
    ctx.stroke();
  }

  private travelU(e: EdgeGeom, t: number): number {
    const f = Math.max(0, Math.min(1, (t - e.start) / Math.max(1e-6, e.end - e.start)));
    if (this.settings.reducedMotion) return f; // steady reveal
    // accelerate into the landing so arrivals read as hits
    return e.kind === 'merge' ? f * f * (3 - 2 * f) * 0.6 + 0.4 * Math.pow(f, 1.7) : Math.pow(f, 1.6);
  }

  private drawActiveEdge(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D | null, e: EdgeGeom, t: number, ivory: string, slateBase: string, focusIdx: number) {
    const p = this.perf!;
    const slate = this.tints[e.threadIdx] ?? slateBase;
    const child = p.nodes[e.child]!;
    const parent = e.parent >= 0 ? p.nodes[e.parent]! : null;
    const spine = child.isSpine && (parent ? parent.isSpine : true) && e.kind !== 'secondary';
    const u = this.travelU(e, t);
    const color = p.contributors[e.contributorIdx]?.color ?? PALETTE.accent;
    const focused = focusIdx < 0 || e.contributorIdx === focusIdx;
    const dim = focused ? 1 : 0.3;
    // A faint dashed line under the part of this thread that has already been
    // travelled, so a convergence reads as a convergence rather than as two
    // unrelated strokes.
    //
    // It used to draw the *whole* path — `drawPolyline(ctx, e.pts)` with no
    // `u`, which is the entire route including the part that has not happened.
    // On an edge that is by definition still in flight, that is the future
    // drawn on the stage: you could see where a branch was going to go before
    // it went there, and where it would land before it landed. It reads as a
    // faint grey line arriving from nowhere, which is exactly what it is.
    //
    // Nothing is drawn before it happens. That rule is the whole reason to
    // trust the picture, and it is not worth a rendering flourish.
    //
    // (A dashed stroke also has to be measured along the path as it
    // rasterises, which is the most expensive kind there is — so this is
    // skipped once the stage is crowded and each one is a hairline anyway.)
    if ((e.kind === 'merge' || e.kind === 'secondary' || e.kind === 'divergence') && this.edgeDetail >= 0.5) {
      const tension = e.kind === 'merge' ? 0.18 + 0.22 * u : 0.12;
      ctx.strokeStyle = rgba(spine ? ivory : slate, tension * dim);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      this.drawPolyline(ctx, e.pts, u);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (e.kind === 'unknown') {
      ctx.setLineDash([6, 7]);
      ctx.strokeStyle = rgba(PALETTE.fog, 0.6 * dim);
      ctx.lineWidth = 1.4;
      this.drawPolyline(ctx, e.pts, u);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    const structural = spine ? ivory : slate;
    const width = e.kind === 'aggregate' ? 8 : spine ? 2.8 : e.kind === 'secondary' ? 1.2 : 1.9;
    // revealed structural path
    ctx.strokeStyle = rgba(structural, (spine ? 0.95 : 0.85) * dim);
    ctx.lineWidth = width;
    this.drawPolyline(ctx, e.pts, u);
    ctx.stroke();
    // contributor energy flowing through the revealed path (never recolors the structure permanently)
    const trailLen = this.settings.reducedMotion ? 0 : 0.35;
    if (trailLen > 0) {
      const from = Math.max(0, u - trailLen);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // A gradient object per edge per frame, for a fade along a line a couple
      // of pixels wide. Below full detail it is a flat colour, which at this
      // density is the same picture and a fraction of the cost.
      if (this.edgeDetail >= 1) {
        const a = pointAt(e.pts, from, this.tmp);
        const b = pointAt(e.pts, u, this.tmp2);
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, rgba(color, 0));
        grad.addColorStop(1, rgba(color, 0.55 * dim));
        ctx.strokeStyle = grad;
      } else {
        ctx.strokeStyle = rgba(color, 0.34 * dim);
      }
      ctx.lineWidth = width + 1.5;
      this.drawPartial(ctx, e.pts, from, u);
      ctx.stroke();
      ctx.restore();
      // The glow layer gets the same stroke a second time. One copy of the
      // light is enough when the stage is full of it.
      if (glow && this.edgeDetail >= 0.5) {
        glow.strokeStyle = rgba(color, 0.5 * dim);
        glow.lineWidth = width + 4;
        this.drawPartial(glow, e.pts, from, u);
        glow.stroke();
      }
    }
  }

  /**
   * A stretch of a path, with the parts nobody can see left off it.
   *
   * The same clipping `drawPolyline` does, for the same reason: on a thread
   * that has been open for months this stretch can be thousands of points long
   * while a screen-width of it is visible.
   */
  private drawPartial(ctx: CanvasRenderingContext2D, pts: Float32Array, u0: number, u1: number) {
    const count = pts.length >> 1;
    if (count < 2) return;
    const x0 = this.clipX0;
    const x1 = this.clipX1;
    const f0 = u0 * (count - 1);
    const f1 = u1 * (count - 1);
    const a = pointAt(pts, u0, this.tmp);
    const b = pointAt(pts, u1, this.tmp2);
    ctx.beginPath();
    let px = a.x;
    let py = a.y;
    let penDown = false;
    const step = (nx: number, ny: number) => {
      if (!((px < x0 && nx < x0) || (px > x1 && nx > x1))) {
        if (!penDown) ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        penDown = true;
      } else penDown = false;
      px = nx;
      py = ny;
    };
    for (let i = Math.floor(f0) + 1; i <= Math.floor(f1) && i < count; i++) step(pts[i * 2]!, pts[i * 2 + 1]!);
    step(b.x, b.y);
  }

  private activeRipples(t: number): Array<{ x: number; y: number; age: number; amp: number; reach: number }> {
    if (this.settings.reducedMotion) return [];
    const out: Array<{ x: number; y: number; age: number; amp: number; reach: number }> = [];
    let lo = 0;
    let hi = this.impactEvents.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.impactEvents[mid]!.performanceImpact < t - 2.4) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < this.impactEvents.length; i++) {
      const ev = this.impactEvents[i]!;
      if (ev.performanceImpact > t) break;
      if (!HEAVY.has(ev.type)) continue;
      const age = t - ev.performanceImpact;
      const nd = this.nodeBySha.get(ev.subjectIds[0]!);
      if (!nd) continue;
      out.push({ x: nd.x, y: nd.y, age, amp: (4 + 9 * ev.salience) * ev.effectBudget * volumeScale(nd.mergeVolume), reach: 220 * volumeScale(nd.mergeVolume) });
    }
    return out;
  }

  private drawNode(
    ctx: CanvasRenderingContext2D,
    glow: CanvasRenderingContext2D | null,
    nd: NodeGeom,
    t: number,
    ripples: Array<{ x: number; y: number; age: number; amp: number; reach: number }>,
    ivory: string,
    slateBase: string,
    focusIdx: number,
  ) {
    const p = this.perf!;
    const slate = this.tints[nd.threadIdx] ?? slateBase;
    const age = t - nd.impact;
    let x = nd.x;
    let y = nd.y;
    // Existing geometry reacts: radial ripple from merge impacts, and a faint
    // breath. Suppressed behind the form for the same reason as the arrival
    // halo, and more so — a merge ripple reaches much further, so on the
    // landing it reads as a shockwave crossing the whole page.
    for (const r of this.shopWindow ? [] : ripples) {
      const d = Math.hypot(x - r.x, y - r.y);
      if (d < 4 || d > r.reach) continue;
      const wave = Math.sin((d / 34 - r.age * 6.5) * 1.0) * Math.exp(-r.age * 1.6) * (1 - d / r.reach);
      const k = (r.amp * wave) / d;
      x += (x - r.x) * k;
      y += (y - r.y) * k;
    }
    if (!this.settings.reducedMotion && age > 2) y += 0.7 * Math.sin(t * 1.1 + nd.idx * 0.7);

    const pop = this.settings.reducedMotion ? 1 : 1 + 1.3 * Math.exp(-age * 6) * Math.sin(Math.min(age, 0.8) * 9);
    const contributor = p.contributors[nd.contributorIdx];
    const color = contributor?.color ?? PALETTE.accent;
    const focused = focusIdx < 0 || nd.contributorIdx === focusIdx;
    const dim = focused ? 1 : 0.3;
    const selected = this.settings.selectedNode === nd.idx || this.settings.hoverNode === nd.idx;
    const threadSel = this.settings.selectedThread != null && nd.threadIdx === this.settings.selectedThread;
    const structural = nd.isSpine ? ivory : threadSel ? PALETTE.accent : slate;
    const baseR = nd.isMerge ? 5.2 * Math.min(2.1, volumeScale(nd.mergeVolume)) : nd.isSpine ? 4.1 : 3.2;
    // A merge that absorbed a great deal is drawn big, which is the point of
    // the scale — on a stage. Behind the form the same rule produces one
    // object several times the size of everything else, and the eye goes to it
    // instead of to the sentence it is sitting beside.
    const r = Math.min(baseR * pop * (1 + nd.salience * 0.5), this.shopWindow ? 7 : Infinity);

    // Arrival halo in the contributor's colour, fading — human energy touching
    // structure. It is punctuation: it says *this just landed*, and it earns
    // its cost on a stage somebody is watching.
    //
    // Behind the landing form it does not. The ring expands fourteen pixels a
    // second from every commit, and at the shop window's framing that is a
    // circle sweeping across the page while somebody is trying to read a
    // sentence — the eye is pulled to it precisely because it is moving, and
    // there is nothing there to look at once it arrives. The commits still
    // land, still light up; they simply stop announcing it.
    if (age < 1.4 && !this.settings.reducedMotion && !this.shopWindow) {
      const a = 1 - age / 1.4;
      ctx.beginPath();
      ctx.arc(x, y, r + 4 + age * 14, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(color, 0.45 * a * dim);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (glow) {
        glow.beginPath();
        glow.arc(x, y, r + 3, 0, Math.PI * 2);
        glow.fillStyle = rgba(color, 0.7 * a * dim);
        glow.fill();
      }
    }
    if (nd.kind === 'root' && !this.shopWindow) {
      const seed = this.settings.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.3);
      ctx.beginPath();
      ctx.arc(x, y, r + 6 + seed * 2, 0, Math.PI * 2);
      ctx.fillStyle = rgba(ivory, 0.08 * dim);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(structural, (nd.isSpine ? 1 : 0.92) * dim);
    ctx.fill();
    if (nd.isMerge) {
      ctx.beginPath();
      ctx.arc(x, y, r + 2.6, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(structural, 0.8 * dim);
      ctx.lineWidth = 1.3;
      ctx.stroke();
      if (nd.parentCount > 2 && !this.shopWindow) {
        ctx.beginPath();
        ctx.arc(x, y, r + 5.2, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(structural, 0.5 * dim);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    if (nd.kind === 'boundary' && !this.shopWindow) {
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(PALETTE.fog, 0.7 * dim);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Persistent contributor ring: who touched this commit, readable when
    // paused. Every ring on a node is an annotation — who, how many parents,
    // whether it is tagged — and annotations are what the landing page does not
    // want. A heavy merge carries four of them, which at the shop window's
    // framing is a fifty-pixel target sitting beside the form doing nothing but
    // catching the eye. The node itself still shows; it just stops being
    // labelled.
    if (age > 0.05 && !this.shopWindow) {
      ctx.beginPath();
      ctx.arc(x, y, r + 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(color, (focusIdx === nd.contributorIdx ? 0.9 : 0.38) * dim);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (nd.tagLabels.length && !this.shopWindow) {
      ctx.beginPath();
      ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(ivory, 0.55 * dim);
      ctx.lineWidth = 1;
      ctx.setLineDash([1.5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, r + 8, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(PALETTE.accent, 0.95);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  private drawGlyph(ctx: CanvasRenderingContext2D, glyph: string, x: number, y: number, r: number, heading: number) {
    ctx.save();
    ctx.translate(x, y);
    if (glyph === 'triangle' || glyph === 'diamond') ctx.rotate(heading + Math.PI / 2);
    ctx.beginPath();
    (GLYPH_PATHS[this.settings.showGlyphs ? glyph : 'orb'] ?? GLYPH_PATHS.orb!)(ctx, r);
    ctx.restore();
  }

  private drawBody(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D | null, e: EdgeGeom, t: number, focusIdx: number) {
    const p = this.perf!;
    const u = this.travelU(e, t);
    const f = Math.max(0, Math.min(1, (t - e.start) / Math.max(1e-6, e.end - e.start)));
    const contributor = p.contributors[e.contributorIdx];
    const from = e.fromContributorIdx >= 0 ? p.contributors[e.fromContributorIdx] : null;
    const handoff = !!from && e.fromContributorIdx !== e.contributorIdx && (e.kind === 'thread' || e.kind === 'aggregate');
    const color = handoff && from ? mixHex(from.color, contributor?.color ?? PALETTE.accent, f) : contributor?.color ?? PALETTE.accent;
    const focused = focusIdx < 0 || e.contributorIdx === focusIdx || (handoff && e.fromContributorIdx === focusIdx);
    const dim = focused ? 1 : 0.25;
    const isPerformer = e.body === 'performer';
    const size = (isPerformer ? 4.6 : 3) * (e.kind === 'aggregate' ? 1.25 : 1);
    const pos = pointAt(e.pts, u, this.tmp);
    // The furthest right anything is actually drawn, which is not the furthest
    // right anything has landed. `recentBounds` measures commits; the comets
    // travelling toward commits that have not landed are all in front of them,
    // and on the landing page they are what runs off the edge. Recorded before
    // the culling below, so a body already past the frame still counts — it is
    // precisely the one the framing has to make room for.
    if (pos.x > this.frontWorldX) this.frontWorldX = pos.x;
    // A live edge can cross the stage while the spark travelling it is still
    // far off the side. The edge earned its place by overlapping the view; the
    // body has to earn its own.
    const scr = this.worldToScreen(pos.x, pos.y);
    const margin = 48;
    if (scr.x < -margin || scr.x > this.width + margin || scr.y < -margin || scr.y > this.height + margin) return;
    const heading = headingAt(e.pts, u);
    const glyph = contributor?.glyph ?? 'orb';
    const bot = contributor?.isBot;

    if (this.settings.reducedMotion) {
      // Steady marker at the arrival node instead of a traveling comet.
      const end = pointAt(e.pts, 1, this.tmp2);
      ctx.beginPath();
      ctx.arc(end.x, end.y, size + 3, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(color, (0.3 + 0.5 * f) * dim);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      this.drawGlyph(ctx, glyph, pos.x, pos.y, size * 0.8, heading);
      ctx.fillStyle = rgba(color, 0.9 * dim);
      ctx.fill();
      return;
    }

    // comet trail: earlier positions along the exact path
    const trailFull = this.settings.quality === 'full' ? (isPerformer ? 11 : 6) : 5;
    const trailN = Math.max(1, Math.round(trailFull * this.bodyDetail));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = trailN; k >= 1; k--) {
      const uu = u - (k * 0.028 * (isPerformer ? 1 : 0.7)) / Math.max(0.4, e.length / 120);
      if (uu < 0) continue;
      const q = pointAt(e.pts, uu, this.tmp2);
      const a = (1 - k / (trailN + 1)) * 0.5 * dim;
      const rr = size * (1 - k / (trailN + 2)) * 0.8;
      if (bot) {
        if (k % 2) continue;
        ctx.fillStyle = rgba(color, a);
        ctx.fillRect(q.x - rr / 2, q.y - rr / 2, rr, rr);
      } else {
        ctx.beginPath();
        ctx.arc(q.x, q.y, rr, 0, Math.PI * 2);
        ctx.fillStyle = rgba(color, a);
        ctx.fill();
      }
    }
    // halo
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, size * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, 0.22 * dim);
    ctx.fill();
    ctx.restore();
    // handoff: the departing signature lingers just behind, fading
    if (handoff && from && f < 0.7) {
      const q = pointAt(e.pts, Math.max(0, u - 0.05), this.tmp2);
      this.drawGlyph(ctx, from.glyph, q.x, q.y, size * 0.75, heading);
      ctx.fillStyle = rgba(from.color, (1 - f / 0.7) * 0.8 * dim);
      ctx.fill();
    }
    // core
    this.drawGlyph(ctx, glyph, pos.x, pos.y, size, heading);
    ctx.fillStyle = rgba(color, 0.95 * dim);
    ctx.fill();
    this.drawGlyph(ctx, glyph, pos.x, pos.y, size * 0.45, heading);
    ctx.fillStyle = rgba('#ffffff', 0.9 * dim);
    ctx.fill();
    if (glow) {
      glow.beginPath();
      glow.arc(pos.x, pos.y, size * 1.8, 0, Math.PI * 2);
      glow.fillStyle = rgba(color, 0.9 * dim);
      glow.fill();
    }
    // aggregate ribbons carry an internal rhythm: ticks flowing behind the performer
    if (e.kind === 'aggregate') {
      const count = this.aggregateByNode[e.child]?.memberCount ?? 8;
      const ticks = Math.max(2, Math.round(Math.min(24, count) * this.bodyDetail));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < ticks; k++) {
        const uu = (k / ticks) * u;
        const q = pointAt(e.pts, uu, this.tmp2);
        const blink = 0.35 + 0.35 * Math.sin(t * 9 + k * 1.7);
        ctx.fillStyle = rgba(color, blink * dim);
        ctx.fillRect(q.x - 1, q.y - 3, 2, 6);
      }
      ctx.restore();
    }
  }

  private drawEffects(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D | null, t: number, ivory: string) {
    // Nothing announces itself behind the form.
    //
    // This is the fanfare pass: a ring tightening onto a merge before it lands
    // and a wave up to ninety-six pixels across afterwards, with a second ring
    // inside it on the heavy ones. On a stage being watched it is the moment
    // the whole motion language exists for. On the landing page it is a large
    // bright circle with visible structure appearing beside the sentence
    // somebody is reading, and it is what stayed behind after the ripples, the
    // arrival halos, the node annotations and the tip beacons had all gone —
    // each removal leaving the same complaint, because each time there was
    // another ring underneath.
    if (this.shopWindow) return;
    const noFlash = this.settings.noFlash;
    const reduced = this.settings.reducedMotion;
    let lo = 0;
    let hi = this.impactEvents.length;
    const firstImpact = t - 3;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.impactEvents[mid]!.performanceImpact < firstImpact) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < this.impactEvents.length; i++) {
      const ev = this.impactEvents[i]!;
      // Not one frame past the playhead. Events are in impact order, so the
      // first one that has not happened ends the walk.
      if (ev.performanceImpact > t) break;
      const age = t - ev.performanceImpact;
      if (age < 0 || age > 3) continue;
      const nd = this.nodeBySha.get(ev.subjectIds[0]!);
      if (!nd) continue;
      const budget = ev.effectBudget;
      // A ring used to tighten onto the merge node for the six tenths of a
      // second *before* it landed: a light in the empty space ahead of the
      // performance, marking a spot because of something that had not happened
      // there yet. Anticipation is the camera's job, and the camera already
      // does it — it leads a merge rather than drawing one early.
      if (HEAVY.has(ev.type)) {
        const release = Math.max(0.6, ev.performanceEnd - ev.performanceImpact);
        const a = Math.min(1, age / release);
        const vs = volumeScale(nd.mergeVolume);
        const radius = reduced ? (16 + 22 * (0.6 + ev.salience * 0.7)) * budget * vs : (12 + 96 * Math.sqrt(a) * (0.6 + ev.salience * 0.7)) * budget * vs;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(PALETTE.merge, (1 - a) * (1 - a) * 0.75 * budget);
        ctx.lineWidth = (1.8 * (1 - a) + 0.5) * Math.min(2.4, vs);
        ctx.stroke();
        if (ev.type !== 'MERGE_IMPACT' && !reduced) {
          ctx.beginPath();
          ctx.arc(nd.x, nd.y, radius * 0.62, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(ivory, (1 - a) * 0.4 * budget);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        // Spokes: one per converging parent, so an octopus reads instantly.
        if (!reduced && age < 0.7 && nd.parentCount > 1) {
          const k = 1 - age / 0.7;
          const spokes = Math.min(12, nd.parentCount);
          for (let i = 0; i < spokes; i++) {
            const ang = (i / spokes) * Math.PI * 2 + nd.idx;
            const r0 = 8 + 26 * (1 - k) * vs;
            const r1 = r0 + 16 * k * vs;
            ctx.beginPath();
            ctx.moveTo(nd.x + Math.cos(ang) * r0, nd.y + Math.sin(ang) * r0);
            ctx.lineTo(nd.x + Math.cos(ang) * r1, nd.y + Math.sin(ang) * r1);
            ctx.strokeStyle = rgba(PALETTE.merge, 0.5 * k * budget);
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        }
        if (age < 0.28 && !noFlash && !reduced) {
          const k = 1 - age / 0.28;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.beginPath();
          ctx.arc(nd.x, nd.y, (10 + 22 * (1 - k)) * Math.min(2, vs), 0, Math.PI * 2);
          ctx.fillStyle = rgba(PALETTE.merge, 0.55 * k * budget);
          ctx.fill();
          ctx.restore();
          if (glow) {
            glow.beginPath();
            glow.arc(nd.x, nd.y, 26 * k * (0.5 + ev.salience) * Math.min(2, vs), 0, Math.PI * 2);
            glow.fillStyle = rgba(PALETTE.merge, 0.9 * k * budget);
            glow.fill();
          }
        }
      } else if (ev.type === 'DIVERGENCE' && age >= 0 && age < 0.9 && !reduced) {
        // clean split flare at the exact junction
        const base = this.nodeBySha.get(ev.subjectIds[0]!);
        if (!base) continue;
        const k = 1 - age / 0.9;
        const dir = Math.atan2(nd.y - base.y, nd.x - base.x);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(base.x, base.y);
          ctx.lineTo(base.x + Math.cos(dir + s * 0.5) * 22 * (1 - k * 0.5), base.y + Math.sin(dir + s * 0.5) * 22 * (1 - k * 0.5));
          ctx.strokeStyle = rgba(ivory, 0.5 * k * budget);
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      } else if (ev.type === 'TAG_LANDMARK' && age >= 0 && age < 2) {
        const k = 1 - age / 2;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, 9 + age * 18, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(ivory, 0.4 * k * budget);
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if ((ev.type === 'REPO_BIRTH' || ev.type === 'MULTI_ROOT_REVEAL') && age >= 0 && age < 2.5) {
        const k = 1 - age / 2.5;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, 6 + age * (reduced ? 10 : 30), 0, Math.PI * 2);
        ctx.strokeStyle = rgba(ivory, 0.45 * k);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  /**
   * The last entry that has already landed, found rather than walked to.
   *
   * Several label passes were written as "walk from the beginning and break
   * when you pass the playhead". That reads as a cheap early exit and is the
   * opposite: the number of iterations is *how much has already happened*, so
   * the cost grows with elapsed time and with nothing else. Linux filters
   * 111,926 merges down to a caption list, and an hour into the performance
   * that loop was stepping over most of them every frame to draw a handful.
   *
   * The lists are in landing order — the old `break` depended on that too — so
   * the end of the landed range is one binary search away, and the passes walk
   * *backwards* from it until their labels have faded out.
   */
  private lastLanded<T>(arr: readonly T[], keyOf: (v: T) => number, t: number): number {
    let lo = 0;
    let hi = arr.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (keyOf(arr[mid]!) <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }

  private drawLabels(ctx: CanvasRenderingContext2D, t: number) {
    const p = this.perf!;
    const labels = this.settings.labels;
    ctx.font = '500 11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    const drawn: Array<{ x: number; y: number; w: number }> = [];
    /**
     * The slice of the world the stage can currently show, padded.
     *
     * Used to throw work away before doing it. The passes below end in
     * `place()`, which rejects anything off-screen — but only after evaluating
     * a curve and running a transform to find out where it is. Linux has
     * 77,929 aggregate captions and an hour into the performance about 6,500
     * of them have landed, so that is 6,500 `pointAt` calls and 6,500
     * transforms a frame to draw the handful that are actually on screen.
     *
     * The padding is deliberately generous — a fifth of the view on each side.
     * The camera can be rolled, which makes an axis-aligned world box an
     * approximation, and the cost of being slightly too generous is a few
     * comparisons while the cost of being too tight is a caption that silently
     * stops appearing.
     */
    let __m = performance.now();
    const __lap = (k: keyof typeof renderProfile.ms) => { if (!renderProfile.enabled) return; const n = performance.now(); renderProfile.ms[k] += n - __m; __m = n; };
    const v = this.view;
    const halfW = this.width / Math.max(1e-6, v.scale) / 2;
    const padW = halfW * 0.4;
    const worldLeft = v.cx - halfW - padW;
    const worldRight = v.cx + halfW + padW;
    const place = (x: number, y: number, text: string, alpha: number, color: string = PALETTE.text) => {
      // Reject off-screen candidates before asking Canvas to shape their text.
      // A large history can have thousands of aggregate captions behind the
      // camera; measuring every one was far more expensive than locating it.
      if (x < 0 || x > this.width || y < this.settings.safe.top - 10 || y > this.height - this.settings.safe.bottom + 10) return;
      const w = ctx.measureText(text).width + 10;
      if (x + w > this.width) return;
      for (const d of drawn) if (Math.abs(d.y - y) < 14 && x < d.x + d.w && x + w > d.x) return;
      drawn.push({ x, y, w });
      ctx.fillStyle = rgba(PALETTE.ink, 0.55 * alpha);
      ctx.fillRect(x - 4, y - 8, w, 16);
      ctx.fillStyle = rgba(color, alpha);
      ctx.fillText(text, x, y);
    };
    // Thread names, budgeted. A project with thousands of short-lived pull
    // request branches would otherwise bury the stage in "thread 1617" labels
    // that say nothing. Named branches come first, the nearest to the playhead
    // win, and anonymous threads are only named when there are few enough for
    // the name to be worth reading.
    if (labels !== 'minimal') {
      const candidates: Array<{ th: (typeof p.threads)[number]; latest: NodeGeom; alpha: number; label: string }> = [];
      for (const th of this.labelThreads) {
        const first = p.nodes[th.nodeIdxs[0]!];
        if (!first || first.impact > t) continue;
        // The last node of this thread that has landed, found rather than
        // walked to.
        //
        // This was a scan from the start of the thread that stopped when it
        // passed the playhead — so its length was however much of the thread
        // had already happened, and it ran once per labelled thread per frame.
        // The cost therefore grew with elapsed time and nothing else, which is
        // exactly what "it gets laggy a couple of hours in" is: measured on
        // Linux, the label pass went from 0.32 ms a frame at the start to
        // 3.3 ms at one hour and 5.91 ms at two, by which point it was the
        // most expensive thing the renderer did.
        //
        // `nodeIdxs` is in impact order — the old loop's `break` depended on
        // that too — so the same answer is one binary search away.
        let lo = 0;
        let hi = th.nodeIdxs.length - 1;
        let found = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (p.nodes[th.nodeIdxs[mid]!]!.impact <= t) {
            found = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        const latest = p.nodes[th.nodeIdxs[found]!]!;
        // A label for a thread whose newest commit is off the side of the
        // stage cannot be placed — `place()` rejects it on screen position a
        // moment later. Rejecting it here is the difference between a
        // candidate list bounded by what is visible and one bounded by how
        // much of the history has gone by: every named branch that has ever
        // landed was being measured, allocated and *sorted* every frame, to
        // choose ten. Eleven hours into Linux that pass was 10.3 ms, more than
        // half the frame, while fewer threads were moving than at six hours.
        if (latest.x < this.clipX0 || latest.x > this.clipX1) continue;
        const mergedAt = th.mergeNodeIdx != null ? p.nodes[th.mergeNodeIdx]!.impact : Infinity;
        const merged = mergedAt <= t;
        const alpha = merged ? Math.max(0, 0.55 - (t - mergedAt) / 6) : th.ending === 'tip' ? 0.85 : 0.7;
        if (alpha <= 0.02) continue;
        candidates.push({ th, latest, alpha, label: th.label ?? th.id.replace('thread-', 'thread ') });
      }
      // Named branches, then whichever landed most recently.
      candidates.sort((a, b) => Number(!!b.th.label) - Number(!!a.th.label) || b.latest.impact - a.latest.impact);
      for (const c of candidates.slice(0, 10)) {
        const scr = this.worldToScreen(c.latest.x, c.latest.y);
        place(scr.x + 12, scr.y + c.th.side * 13, c.label, c.alpha, this.tints[c.th.idx] ?? PALETTE.slate);
      }
    }
    __lap('lblThreads');
    // The main line, named where it can always be seen.
    //
    // This used to be printed once, beside the spine's very first commit, and
    // then the camera moved on and it was gone for the next twelve hours. The
    // straight ivory line is the one thing a viewer needs to keep hold of —
    // everything else is described relative to it — so its name rides along
    // with it instead of being a fact stated at the beginning and forgotten.
    //
    // It is pinned to the right-hand edge of the frame and it stays there.
    //
    // Two earlier versions both moved it, and both were wrong in the same way.
    // Printed once beside the spine's first commit it was gone within seconds
    // and never came back. Following the head commit it went where the head
    // went — which is off the right of the frame on any long history, so it
    // spent most of its time clamped against the margin anyway, and the rest
    // of its time being clipped back and forth across that clamp as the camera
    // moved. Easing the clamped value only smeared the same problem out.
    //
    // So it rides just off the end of the line, 25px clear of the newest
    // commit on it, at that commit's own height.
    //
    // Pinning it to the frame's right margin fixed the jumping and put it a
    // long way from the thing it names — on a wide shot the line ends in the
    // middle of the stage and the plate sat at the edge with nothing under it.
    // The two faults that made following the head unwatchable are gone now and
    // neither was the following: the plate was being clamped into the camera's
    // safe area, which reserves 150px at the bottom of a stage barely 550
    // tall, so it detached from a spine that spends much of its time below
    // that band and slammed between the clamps; and its height came from
    // `spineY`, a constant 0 that describes the layout's intent rather than
    // the geometry the compiler emits, which put it a flat 374px off the line.
    //
    // Drawn directly rather than through `place()`: this one never yields to
    // another label and never gets skipped for overlapping.
    const spine = p.threads[0];
    const spineBegun = spine && spine.nodeIdxs.length > 0 && p.nodes[spine.nodeIdxs[0]!]!.impact <= t;
    if (spine && spine.label && spineBegun && labels !== 'minimal' && this.settings.showSpineLabel) {
      const text = spine.label.toUpperCase();
      ctx.save();
      ctx.font = '600 9.5px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(text).width;
      // Tracking has to be added by hand; canvas has no letter-spacing.
      const track = 1.4;
      const padX = 7;
      const boxW = w + track * (text.length - 1) + padX * 2;
      // The same tip the camera framed, so the plate cannot disagree with the
      // shot it is standing in — and the *drawn* end of the line rather than
      // the last commit on it, or it sits behind the stroke still travelling.
      const onLine = this.spineTip(t) ?? p.nodes[spine.nodeIdxs[0]!]!;
      const head = this.worldToScreen(onLine.x, onLine.y);
      // Its height is read off that commit, not from `spineY`: that returns a
      // constant 0 and describes the layout's intent — "the primary spine is a
      // perfectly straight horizontal axis" — rather than the geometry the
      // compiler emits, and measured on Kubernetes the two were a flat 374px
      // apart at every depth in the performance.
      const lineY = head.y;
      // Twice what it was. At 25 the plate read as attached to the line —
      // close enough to be part of the stroke rather than a label on it.
      const GAP = 50;
      // Held on the stage when the head has run off it, which is the usual
      // case on a long history: the camera frames the work and the line
      // continues past the edge, so the plate waits at the margin.
      const x = Math.max(this.settings.safe.left + 6, Math.min(this.width - this.settings.safe.right - boxW - 6, head.x + GAP));
      // Kept on the canvas, not inside the safe area.
      //
      // The safe insets are a compositional margin for the *camera* — 150px at
      // the bottom of a stage barely 550 tall — and clamping the plate into
      // them detached it from the thing it names. Measured on Kubernetes the
      // spine spends much of its time below that band, so the plate sat at the
      // bottom of the safe area with its line 200px further down, and slammed
      // between the two clamps: y swung across the full 320px range with
      // single-frame jumps of the whole 320. That is the teleporting. The pill
      // is 16px tall and belongs on its line; it only has to stay on the
      // canvas.
      // Centred on the line, not floating above it.
      //
      // It used to sit 15px up with a tick dropped from its underside to the
      // line, which is the right drawing for a label hovering *over* the thing
      // it names. It does not hover over it any more — it stands past the end
      // of it — so the tick pointed down into empty stage and the plate read
      // as belonging to nothing. On the line's own axis it is simply the last
      // thing on the line, which is what it is.
      const y = Math.max(14, Math.min(this.height - 14, lineY));
      ctx.fillStyle = rgba(PALETTE.ink, 0.72);
      ctx.beginPath();
      ctx.roundRect(x, y - 8, boxW, 16, 8);
      ctx.fill();
      ctx.strokeStyle = rgba(PALETTE.ivory, 0.22);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = rgba(PALETTE.ivory, 0.92);
      let cx = x + padX;
      for (const ch of text) {
        ctx.fillText(ch, cx, y);
        cx += ctx.measureText(ch).width + track;
      }
      ctx.restore();
      // Claim the ground it stands on.
      //
      // This one is drawn directly rather than through `place()`, because it
      // never yields and never gets skipped — but not going through `place()`
      // also meant it never told `place()` it was there, so every later
      // caption happily wrote across it. Every run produced at least one, and
      // the result reads as a rendering fault: "21 merged branches · 49
      // commiMAIN". Registering the box costs nothing and makes the captions
      // route around the one label that cannot move.
      drawn.push({ x: x - 4, y, w: boxW + 8 });
      this.mainLabelAt = { x, y };
    } else this.mainLabelAt = null;
    // how much converged, on the merges big enough to warrant saying so
    if (labels !== 'minimal') {
      // Backwards from the playhead. Age only increases going back, and the
      // caption is gone by 3.4 s, so the first faded one ends the walk.
      for (let i = this.lastLanded(this.mergeLabelNodes, (n) => n.impact, t); i >= 0; i--) {
        const nd = this.mergeLabelNodes[i]!;
        const age = t - nd.impact;
        const alpha = Math.max(0, Math.min(1, 1 - (age - 2.2) / 1.2));
        if (alpha <= 0) break;
        const s = this.worldToScreen(nd.x, nd.y);
        place(s.x + 12, s.y + 16, `${nd.mergeVolume} commits converge`, alpha, PALETTE.merge);
      }
    }
    __lap('lblMerges');
    // tags & aggregates
    if (labels !== 'minimal') {
      // `all` pins every landed tag at a constant alpha, so there is no fade to
      // stop at and that mode keeps the full walk it has always had — it is a
      // deliberate "show me everything". `auto` fades out by 5.5 s and can walk
      // backwards from the playhead instead.
      const tagStart = this.lastLanded(this.taggedNodes, (n) => n.impact, t);
      for (let i = tagStart; i >= 0; i--) {
        const nd = this.taggedNodes[i]!;
        const age = t - nd.impact;
        const alpha = labels === 'all' ? 0.85 : Math.max(0, Math.min(1, 1 - (age - 4) / 1.5));
        if (alpha <= 0) break;
        const s = this.worldToScreen(nd.x, nd.y);
        place(s.x + 10, s.y - 14, nd.tagLabels.join(' · '), alpha, PALETTE.ivory);
      }
    }
    __lap('lblTags');
    // "40 commits" over a collapsed run is a commit name like any other, so it
    // goes when the rest do. It was outside the gate, which is why turning the
    // names off left the stage still captioned — and why the landing page was
    // printing "6 commits" through the sentence asking for a URL.
    if (labels !== 'minimal') {
      // "40 commits" belongs to a *visible ribbon*. Below the width where the
      // ribbon is its own object on screen, the caption has nothing to label:
      // a hundred of them land on the same few pixels, and `place()` throws
      // all but the first away on the overlap test — after building each
      // string and measuring its text.
      //
      // That is what made this the most expensive thing in the renderer.
      // Eleven hours into Linux the camera has pulled right out, so the world
      // window covers nearly the whole history and the bounds test above
      // rejects almost nothing: 71,000 captions were being composed and
      // measured every frame to draw a handful. Measured at 10.35 ms of a
      // 10.58 ms label pass, over half the frame.
      //
      // A ribbon narrower than this is drawn — it is still history — but it is
      // not captioned, which is what "too small to read" already looked like.
      const MIN_RIBBON_PX = 36;
      const minRibbonWorld = MIN_RIBBON_PX / Math.max(1e-6, v.scale);
      // Binary search to the first ribbon that could reach the left edge of
      // the stage, then walk forward until they start past the right edge. A
      // ribbon overlapping the view must begin no earlier than the left edge
      // less the widest it could be, which is what makes this exact rather
      // than a heuristic.
      //
      // Per group rather than once over everything: each group's reach is its
      // own widest ribbon, and a group whose widest is already too narrow to
      // caption is skipped whole. Positions are collected and then sorted, so
      // what `place()` sees is the same sequence, in the same order, that a
      // single walk over all of them produced.
      const picked = this.aggPicked;
      picked.length = 0;
      for (const level of this.aggLevels) {
        if (level.maxSpan < minRibbonWorld) continue;
        const lm = level.minX;
        const reach = worldLeft - level.maxSpan;
        let lo2 = 0;
        let hi2 = lm.length;
        while (lo2 < hi2) {
          const mid = (lo2 + hi2) >> 1;
          if (lm[mid]! < reach) lo2 = mid + 1;
          else hi2 = mid;
        }
        for (let i = lo2; i < lm.length && lm[i]! <= worldRight; i++) picked.push(level.pos[i]!);
      }
      picked.sort((m, n) => m - n);
      for (const oi of picked) {
        const ai = this.aggByMinX[oi]!;
        const e = this.aggregateEdges[ai]!;
        if (e.start > t) continue;
        const eb = this.aggregateEdgePos[ai]! * 4;
        const lo = this.edgeBounds[eb]!;
        const hi = this.edgeBounds[eb + 2]!;
        // Too narrow on screen to be captioning anything the eye can pick out.
        if (hi - lo < minRibbonWorld) continue;
        if (hi < worldLeft) continue;
        const agg = this.aggregateByNode[e.child];
        if (!agg || agg.memberCount < 3) continue;
        const m = pointAt(e.pts, 0.5, this.tmp);
        const s = this.worldToScreen(m.x, m.y);
        place(s.x - 30, s.y - 14, describeAggregate(agg), 0.75, PALETTE.textDim);
      }
    }
    __lap('lblAggs');
    for (const e of this.unknownEdges) {
      if (e.start > t) break;
      const eb = e.idx * 4;
      if (this.edgeBounds[eb + 2]! < worldLeft || this.edgeBounds[eb]! > worldRight) continue;
      const m = pointAt(e.pts, 0.2, this.tmp);
      const s = this.worldToScreen(m.x, m.y);
      place(s.x - 40, s.y - 14, 'history not loaded', 0.75, PALETTE.fogText);
    }
    // Live tips carry a branch name, so they follow the branch names.
    for (const th of labels === 'minimal' ? [] : this.tipThreads) {
      if (th.end > t || th.role === 'primary' || !th.label) continue;
      const last = p.nodes[th.nodeIdxs[th.nodeIdxs.length - 1]!]!;
      const s = this.worldToScreen(last.x, last.y);
      place(s.x + 12, s.y, th.label, 0.7, PALETTE.accent);
    }
    __lap('lblRest');
  }

  toBlob(type = 'image/png'): Promise<Blob | null> {
    return new Promise((resolve) => this.canvas.toBlob(resolve, type));
  }
}
