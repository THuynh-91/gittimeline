import type { AggregateSpan, CameraCue, ChoreographyEvent, CompiledPerformance, EdgeGeom, NodeGeom, ThreadGeom } from '@/model/types';
import { sampleCamera } from '@/choreography/camera';
import { describeAggregate } from '@/analysis/aggregate';
import { pointAt, headingAt } from '@/layout/paths';
import { hash01 } from '@/model/prng';
import { mixHex, rgba } from '@/model/color';
import { LANE_GAP } from '@/layout/layout';
import { GLYPH_PATHS, PALETTE, threadTint } from './palette';
import { volumeIsCapped, volumePhrase } from '@/model/volume';

/**
 * Canvas2D stage renderer. Every visible quantity is a pure function of the
 * performance time `t` (plus the compiled plan), so seeking, pausing and
 * capture are exact and side-effect free. Layers back to front:
 * atmosphere → settled paths → spine → active trajectories → nodes →
 * bodies (performers/pulses) → impact effects → labels.
 */
export type Quality = 'full' | 'reduced' | 'minimal';

/** Ordered, so "whichever asks for less" is a comparison rather than a chain. */
const QUALITY_RANK: Record<Quality, number> = { minimal: 0, reduced: 1, full: 2 };

export interface RenderSettings {
  reducedMotion: boolean;
  noFlash: boolean;
  /** Camera held still — no punch, no roll. See `Settings.noShake`. */
  noShake: boolean;
  highContrast: boolean;
  quality: Quality;
  labels: 'minimal' | 'landmarks' | 'all';
  contributorFocus: string | null;
  selectedNode: number | null;
  hoverNode: number | null;
  selectedThread: number | null;
  showGlyphs: boolean;
  showSpineLabel: boolean;
  /** The rule at the playhead, and main's line carried to it. */
  showPresent: boolean;
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
/**
 * How much of an edge's path is revealed at linear progress `f`.
 *
 * Exported, and a pure function of `f`, so the one property that matters about
 * it can be asserted without a canvas: **it must never exceed `f`**. The
 * reveal is what draws the path, so a curve above the diagonal draws the path
 * before the body has travelled it — the future, on a stage whose single rule
 * is that nothing is drawn before it happens.
 *
 * The merge curve used to be above the diagonal everywhere:
 * `f*f*(3-2f)*0.6 + 0.4*f^1.7`, which returns 0.829 at f=0.815. Measured on
 * streamed Kubernetes at 40%, twenty-nine merge strokes in one frame reached
 * past the playhead, the worst 7,600 px past it — off the right of the frame,
 * which is why it read as lines running into the future. A viewer reported
 * exactly that and was right about the picture in a way this renderer was not.
 * `48ca9d7` had fixed the same fault in its other half, where the whole path
 * was stroked with no bound at all; bounding the path was not enough while the
 * clock reading it could overshoot.
 *
 * Arrivals still read as hits: `f^k` for `k > 1` has a rising derivative, so
 * both curves still accelerate into the landing, and both reach exactly 1 at
 * f = 1, so a body lands on its merge commit on the frame that commit appears.
 * Merges keep the snappier of the two exponents.
 */
export function travelEase(kind: string, f: number, reducedMotion = false): number {
  const c = Math.max(0, Math.min(1, f));
  if (reducedMotion) return c; // steady reveal
  return kind === 'merge' ? Math.pow(c, 1.25) : Math.pow(c, 1.6);
}

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
    /** Times the stage gave up a resolution the device could not sustain. */
    dprSteppedDown: 0,
    /** Times it gave up part of the picture, once resolution was spent. */
    qualitySteppedDown: 0,
    /**
     * Captions drawn twice in the same place, this frame.
     *
     * A viewer on mdBook: "I caught `v0.0.19` drawn twice, stacked." One
     * commit, two kinds of ref pointing at it — a tag and a one-commit branch
     * named after the tag — and two passes that each write the name, 27 px
     * apart, which is outside the 14 px `place()` rejects an overlap within.
     * See the thread-label pass for the fix.
     *
     * Counted here rather than asserted in one place because "the same words
     * twice in the same corner of the frame" is a property of the whole label
     * pass, and any future pass can break it. Only computed while the profiler
     * is on, so the scan below costs nothing in a real performance.
     */
    stackedLabels: 0,
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

/**
 * What the device earned last time, so it does not walk the whole ladder again.
 *
 * The ladder needs 90 frames before its first step and 30 between rungs, and
 * those are frames, not seconds: on a device running the demo at 5 fps that is
 * 18 s before anything gives and about 30 s to reach the floor. Every load.
 * Which means the worst half-minute of a weak device's experience is the first
 * one, every single time, and it is the one that decides whether a visitor
 * stays.
 *
 * Persisting a *floor* on its own would be worse than the problem: one bad
 * sample -- a compile on the same thread, a background tab, a laptop on
 * battery -- would degrade the picture permanently, with no way back. So this
 * lands together with `climbFrameRate`, and the two are a pair. Do not keep
 * one without the other.
 */
const LADDER_KEY = 'gittimeline.ladder.v1';

interface EarnedLadder {
  dpr: number;
  quality: Quality;
}

function loadLadder(): EarnedLadder | null {
  try {
    const raw = localStorage.getItem(LADDER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<EarnedLadder>;
    const dpr = typeof v.dpr === 'number' && v.dpr >= MIN_RENDER_SCALE && v.dpr <= 2 ? v.dpr : null;
    const quality = v.quality === 'full' || v.quality === 'reduced' || v.quality === 'minimal' ? v.quality : null;
    if (dpr == null || quality == null) return null;
    return { dpr, quality };
  } catch {
    // Private mode, or a value written by a different version. Start fresh.
    return null;
  }
}

function saveLadder(l: EarnedLadder): void {
  try {
    localStorage.setItem(LADDER_KEY, JSON.stringify(l));
  } catch {
    /* private mode */
  }
}

/**
 * Slow enough to count against the device: ten frames a second.
 *
 * Its own name because it was once the frame loop's `dt` clamp, and reading
 * "was this frame capped?" as "is this device struggling?" only worked while
 * the two numbers were the same one.
 */
export const SLOW_FRAME_SECONDS = 0.1;

/**
 * How much of the closing frame's height the history has to occupy.
 *
 * The scale is uniform, so pulling back for a wide shot buys empty sky at the
 * same rate it buys history. Measured on llvm at 1440x900 with no bound at
 * all: 50 nodes in a 23-pixel band, a lit-pixel fraction of 0.00014 — the
 * near-empty stage that the original width clamp existed to prevent and that
 * two attempts at this shot walked back into from different directions.
 */
const MIN_TABLEAU_FILL = 0.3;

/**
 * The fewest pixels the stage will draw per CSS pixel.
 *
 * The picture is hairlines — a 1px spine and a lane glow a few pixels wide —
 * and they survive a bit over a third of the pixels but stop reading as lines
 * much below that. Reached only by a device that has already given up its
 * second device pixel, the bloom and the dust.
 */
export const MIN_RENDER_SCALE = 0.6;
/**
 * A frame fast enough to count towards climbing back up: two vsyncs at 60 Hz.
 *
 * Not the reciprocal of `SLOW_FRAME_SECONDS`. The gap between 33 ms and 100 ms
 * is deliberate dead space, so a device sitting between the two neither falls
 * nor climbs and the picture stays put.
 */
export const FAST_FRAME_SECONDS = 0.0334;
/**
 * The frame average a device has to hold to earn a rung back.
 *
 * Load-bearing, and by a narrower margin than it looks. Together with
 * `SLOW_FRAME_SECONDS` this is what stops the ladder oscillating, and the
 * argument is arithmetic rather than the "dead space between 33 ms and 100 ms"
 * a commit message once claimed -- that gap only stops one frame satisfying
 * both tests, and a rung change moves frame time discontinuously across it.
 *
 * The real reason: descending needs seven frames in ten at or over
 * `SLOW_FRAME_SECONDS`, so a steady load that descends is sitting near 100 ms.
 * The largest rung is `dpr` 2 to 1, which is exactly four times fewer pixels
 * against a cost that is per-pixel, so it lands near 25 ms. Climbing needs
 * 20 ms. Blocked, with 5 ms to spare.
 *
 * **So a rung that improved frame time by more than 5x would reopen the loop.**
 * The largest measured is the whole glow pipeline at 2.6x (49.0 to 18.5 ms on
 * torvalds/linux at 55%). `tests/unit/ladder.test.ts` asserts the ratio, so
 * lowering `SLOW_FRAME_SECONDS` or adding a bigger step fails a test rather
 * than shipping a stage that changes resolution every few seconds.
 */
export const CLIMB_EMA_SECONDS = 0.02;

/**
 * The widest shot a streamed performance may take, in world units.
 *
 * Not a taste decision: a windowed plan holds the pages around the playhead
 * and nothing else, so a shot wider than this is a shot of stage with no
 * geometry behind it -- empty canvas presented as the shape of a repository.
 * The same number is `MAX_VIEW_WIDTH` in `controller.ts` and in the worker,
 * which is why it is named here rather than spelled 16000 in three places.
 */
const MAX_VIEW_WIDTH = 16000;

/**
 * The least room a commit gets along the closing frame, in CSS pixels.
 *
 * The closing tableau was reported as a rendering failure — "a broken cream
 * dotted line across an otherwise empty black screen, no nodes, no tags, no
 * threads, no tally" — and every previous attempt at it measured *coverage*,
 * how much of the history is inside the frame, and declared the shot fixed
 * when coverage went up. Coverage was never the problem. Measured at
 * 1600x900, paused and settled at `t = duration`:
 *
 *   mdBook       106% of its history in frame   0.17% of the frame is lit
 *   public-apis  106%                           0.18%
 *
 * The frame holds the whole history and draws 1,220 nodes and 2,000 edges into
 * a sixth of one per cent of the pixels. The renderer draws inside
 * `ctx.scale(view.scale, view.scale)`, so a node's radius, a stroke's width
 * and a lane's separation are all specified in *world* units and shrink with
 * the frame: at mdBook's closing scale of 0.0106 a lane gap is 0.57 device
 * pixels and a node radius is 0.04. Nothing was missing from the frame. It was
 * all there, a fortieth of a pixel wide.
 *
 * Two things follow, and neither is sufficient alone. The feature floors below
 * put a device pixel under every stroke and disc, so a wide shot draws thin
 * instead of drawing nothing. And the frame has to be bounded by the *density*
 * of the ending rather than by its length, because 1,220 commits across 1,552
 * pixels is 1.3 px per commit however wide the strokes are — the discs merge
 * into one bar. Stepping the manual zoom over the same frame, the lit fraction
 * is flat at 0.167–0.170% for every lane gap under 3.4 px and only starts
 * climbing past 6 px: below that, quadrupling the history in frame buys
 * literally no ink.
 *
 * Eight, from the shelf rather than from one repository. At 1600x900 it puts
 * mdBook's ending at 15.9% of its history, public-apis' at 7.9% and React's at
 * 5.0%, and it does not engage at all on a history sparse enough to be framed
 * whole — the demo is 177 nodes over 15,936 units, which is 8.8 px a commit at
 * 1600 wide and 13.3 at 2400, so a plan held whole still ends on its whole
 * history exactly as `fallback.spec.ts` asks. That is the honest form of the
 * promise: the whole history when the whole history can be drawn, and the end
 * of it when it cannot.
 */
const TABLEAU_COMMIT_PX = 8;

/**
 * The least a stroke or a disc may be drawn at, in device pixels.
 *
 * The main line has had this since `f9d2843` and it is why the main line is
 * the one thing still visible in the closing frame: `wCore = max(2.6 + …,
 * 1.7 * px)` with `px` a device pixel in world units. Nothing else on the
 * stage had it. A settled branch is stroked at `1.7 / sqrt(scale)` world
 * units, which is `1.7 * sqrt(scale)` on screen — under one device pixel for
 * every scale below 0.346, and the closing tableau runs at 0.005 to 0.011.
 * That is the exact reason threads only start appearing in a wide shot at
 * around a 19 px lane gap: 19 px is where `1.7 * sqrt(scale)` reaches a pixel,
 * and it is a fact about the stroke width, not about the lane gap.
 *
 * A floor and not a fixed width: above it the arithmetic is the arithmetic it
 * always was, so nothing changes at the framing the show spends its time at
 * (scale 0.4 to 1.5, where these floors are between a quarter and a tenth of
 * the nominal widths). It engages only where the picture is being drawn
 * smaller than the rasteriser can put down, which is the closing shot and a
 * viewer who has zoomed all the way out.
 */
const MIN_STROKE_PX = 1;
const MIN_NODE_PX = 1.4;


export class StageRenderer {
  private ctx: CanvasRenderingContext2D;
  private glow: HTMLCanvasElement;
  private glowCtx: CanvasRenderingContext2D;
  /**
   * Successive halvings of the glow layer, 1/4 to 1/32 of the stage.
   *
   * These replace `ctx.filter = 'blur(...)'`, which was costing 20.9 ms of a
   * 49 ms frame on `torvalds/linux` at 55% -- 43% of the frame for one
   * assignment. Canvas2D `filter` is not the GPU blur it resembles: it is a
   * Skia image filter over a bitmap the size of the draw, on the raster
   * thread, every frame, charged per pixel regardless of how few strokes went
   * in. See `docs/notes/proposal-frame-budget.md` for the four-arm attribution.
   *
   * A bilinear upscale *is* a blur, performed by the sampler for free, so the
   * bloom is built by halving down and drawing back up. Halving steps matter:
   * bilinear sampling reads a 2x2 neighbourhood, so a 2x reduction is exactly
   * a box average, while jumping 1/2 straight to 1/8 skips pixels and
   * sparkles on a moving starfield.
   */
  private mips: HTMLCanvasElement[] = [];
  private mipCtxs: CanvasRenderingContext2D[] = [];
  /**
   * Whether this engine implements canvas `ctx.filter`, and therefore whether
   * it was ever paying for the blur this replaced.
   *
   * WebKit does not: `'filter' in ctx` is false, and it silently accepted the
   * assignment while ignoring it. So Safari -- and every browser on iOS and
   * iPadOS, which Apple requires to use WebKit -- has never seen a blurred
   * bloom. It composited the glow layer hard-edged for one cheap `drawImage`.
   *
   * That makes the mip chain pure added cost there rather than a replacement,
   * and it measured as one: 36.9 -> 32.7 fps over three interleaved rounds.
   * Suppressing one of the two upscale taps put it back to 38.2 against the
   * old build's 38.2, to the tenth. So an engine that never had the filter
   * gets a single tap: the same frame rate it had before, and a real spread of
   * light where before there was none.
   *
   * Feature-detected rather than sniffed, because the question really is "does
   * this engine support the filter" and not "which browser is this".
   */
  private readonly hasCanvasFilter: boolean;
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
  /**
   * The history's merge count, which is what sets the ancestry budget.
   *
   * Read off the plan rather than carried in the geometry, so the twelve
   * already-published packages get the correction without being rebuilt.
   */
  private mergeCount = 0;
  private taggedNodes: NodeGeom[] = [];
  private labelThreads: ThreadGeom[] = [];
  private tipThreads: ThreadGeom[] = [];
  private nodesByX = new Int32Array(0);
  private width = 1;
  private height = 1;
  private dpr = 1;
  /**
   * A ceiling on `dpr` that this device has actually earned.
   *
   * `chooseQuality` picks the cap from `hardwareConcurrency` and
   * `deviceMemory`, before a single frame has been drawn — and neither of
   * those says anything about whether canvas compositing is accelerated. On a
   * machine with plenty of both but a software rasteriser the guess comes back
   * "full", the stage is sized at twice the device pixels in each direction,
   * and four times the fill lands on a CPU.
   *
   * That is not merely a soft picture. It used to be slow motion as well: the
   * frame loop clamped `dt` to 0.1s, so below ten frames a second the
   * performance clock advanced slower than the wall clock and a history the
   * card said ran 2 min 43 took 6 min 37. The clamp is half a second now, so
   * real time survives down to two frames a second — but two frames a second
   * is not a performance, which is why this still steps the resolution down.
   * Measured at 1280x720 with the same demo, under the old clamp:
   *
   *     chromium  dpr 1   59.8 fps   1.00x     dpr 2   59.6 fps   1.00x
   *     webkit    dpr 1   15.0 fps   0.99x     dpr 2    4.2 fps   0.41x
   *     firefox   dpr 1   17.0 fps   0.99x     dpr 2    5.0 fps   0.49x
   *
   * Those are headless engines without GPU access and not a claim about Safari
   * or Firefox on a real machine — but the shape is the point: the same guess
   * is right for one of them and three times too ambitious for the others, and
   * only a drawn frame can tell them apart. So this measures, and steps down.
   *
   * Downwards only, and once. Coming back up when the average recovers is how
   * an adaptive setting starts oscillating — the cheaper resolution is what
   * made it fast, so recovery is evidence for the step, not against it.
   */
  /**
   * The aggregated runs that hold the focused contributor's work, by index.
   *
   * Contributor focus dimmed everything to 28% and lit only the nodes whose
   * own `contributorIdx` matched. On a large history that is almost nothing:
   * 98 to 99.9% of commits are inside aggregated runs, and the arithmetic is
   * brutal — Chromium has 923 individually-drawn nodes for 15,832
   * contributors, or 0.058 each; LLVM 0.092; Node 0.214. So selecting almost
   * anybody from a list captioned "select one to follow their work through the
   * structure" dimmed the stage and lit nothing at all. That is the reported
   * complaint, arithmetically: it is not imprecise, it is empty.
   *
   * Their work is not missing from the picture, only from the attribution:
   * `AggregateSpan.contributorIds` has always listed everyone inside a run,
   * and it is in the published plans already, so this needs no rebuild.
   *
   * A flag array rather than a `Set` because it is read once per node per
   * frame, and rebuilt only when the focus or the plan changes.
   */
  private focusRuns = new Uint8Array(0);
  private focusRunsKey = '\u0000';
  private dprEarned = Infinity;
  /**
   * A ceiling on `quality` that this device has actually earned — the same
   * idea as `dprEarned`, for the devices `dprEarned` could not help.
   *
   * Stepping the resolution down is the biggest single win available, and on a
   * HiDPI display it is four times the fill. On a display that reports
   * `devicePixelRatio === 1` there is nothing there to give up: the old
   * `watchFrameRate` returned immediately unless `dpr > 1`, so a slow 1x
   * device — a low-end laptop, an old integrated GPU, a phone in a browser
   * that reports 1 — could not adapt at all, however badly it was doing. It
   * ran at whatever frame rate it managed and nothing ever changed.
   *
   * There are two other levers and they are not small ones: `reduced` drops
   * the bloom pass, which is a second full-frame composite of every lit line,
   * and `minimal` drops the drifting dust and shortens the performer trails.
   *
   * Capped, not set: the viewer's own choice in Settings still wins when it is
   * lower than this. Downwards only, and one notch at a time, for the reason
   * given on `dprEarned` — the cheaper picture is what made it fast, so
   * recovery is evidence for the step rather than against it.
   */
  private qualityEarned: Quality = 'full';
  /**
   * The share of recent frames that were slow, as an exponential average.
   *
   * Was a count of *consecutive* slow frames, and twenty of them in a row is a
   * stricter condition than it looks. A device that is mostly too slow but
   * occasionally manages a quick frame — one where the camera barely moved, or
   * a garbage collection happened to land between frames — resets the counter
   * every time, so the ladder stalls on exactly the machines it exists for.
   * Measured: Chromium under 8x and 20x CPU throttling reached the 0.75 rung
   * and then sat there for another 45 seconds at 3 to 5 frames a second,
   * because a run of twenty unbroken slow frames never happened.
   *
   * A share is the honest form of the question — "is this device struggling
   * most of the time" — and it is robust to one frame going the other way.
   */
  private slowShare = 0;
  /** The share of recent frames comfortably fast; see `climbFrameRate`. */
  private fastShare = 0;
  /** Frames since the last step, so the ladder cannot spend two rungs at once. */
  private sinceStep = 0;
  /**
   * Frames drawn of the current performance, so the ladder cannot judge a
   * device by its first seconds.
   *
   * A load is a burst of slow frames for reasons that are nothing to do with
   * the device: the compile finishes on this thread, the first paint touches
   * every cache, and the geometry is being built. The original comment here
   * said as much and relied on "twenty consecutive" to rule it out, which it
   * does not — a load easily produces twenty in a row. Stepping there costs a
   * canvas reallocation at the worst moment for it, and headless WebKit
   * crashed twice on load while this was reachable.
   */
  private framesSeen = 0;
  private frameEma = 0;
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
  /**
   * Where the present was marked last frame, for measurement — same reason as
   * the plate above, and the same shape of answer.
   *
   * The claim the rule is supposed to make is "nothing is right of this", and
   * that claim is checkable only against a number: a photograph of a dense
   * frame cannot distinguish a hairline at 1120 px from one at 1140. `nowX` is
   * the rule; `tipX` is where main's drawn head is, so the gap between them is
   * the in-flight work the rule is meant to explain. Null when the rule was
   * not drawn - off frame, or the setting is off.
   */
  private presentMarkAt: { nowX: number; tipX: number; tipY: number } | null = null;
  get presentMark(): { nowX: number; tipX: number; tipY: number } | null {
    return this.presentMarkAt;
  }

  /**
   * Check the rule's claim against the nodes, rather than against a photograph.
   *
   * A capture of streamed Kubernetes at 40% showed commit dots and thread
   * lines running to the frame's right edge, 730 px right of the rule, while
   * every travelling body was left of it. That cannot happen if x is monotone
   * in impact and the draw guard holds, so one of those is not true, and this
   * reports which: the fit's own residual, how many drawn nodes sit right of
   * the rule in world space, and the camera rotation that would move a node's
   * screen x away from its world x.
   */
  presentAudit(t: number) {
    const p = this.perf;
    const n = this.nodesByX.length;
    if (!p || n < 2) return null;
    const worldX = this.xAtTime(t);
    const a = p.nodes[this.nodesByX[0]!]!;
    const b = p.nodes[this.nodesByX[n - 1]!]!;
    let residual = 0;
    let landed = 0;
    let beyondWorld = 0;
    let maxLandedX = -Infinity;
    let maxLandedImpact = -Infinity;
    let nonMonotone = 0;
    let prevX = -Infinity;
    let prevImpact = -Infinity;
    const worst: Array<{ x: number; impact: number; kind: string; y: number }> = [];
    for (let i = 0; i < n; i++) {
      const nd = p.nodes[this.nodesByX[i]!]!;
      if (nd.x < prevX) nonMonotone++;
      if (nd.impact < prevImpact) nonMonotone++;
      prevX = nd.x;
      prevImpact = nd.impact;
      const di = b.impact - a.impact;
      if (Math.abs(di) > 1e-9) {
        const pred = a.x + ((nd.impact - a.impact) * (b.x - a.x)) / di;
        residual = Math.max(residual, Math.abs(pred - nd.x));
      }
      if (nd.impact <= t + 0.001) {
        landed++;
        if (nd.x > maxLandedX) maxLandedX = nd.x;
        if (nd.impact > maxLandedImpact) maxLandedImpact = nd.impact;
        if (worldX != null && nd.x > worldX + 1) {
          beyondWorld++;
          if (worst.length < 6) worst.push({ x: nd.x, impact: nd.impact, kind: nd.kind, y: nd.y });
        }
      }
    }
    // Resident-but-not-yet-happened nodes that fall inside the frame. If the
    // ink right of the rule is nodes, these are the nodes, and their screen x
    // will line up with the lit columns. If the nearest one is off the frame,
    // the ink is something else and the node pass is exonerated.
    let unlandedInFrame = 0;
    let minUnlandedScreenX = Infinity;
    const unlandedSample: Array<{ sx: number; sy: number; impact: number; kind: string }> = [];
    // Edges that are drawn this frame and whose *path* reaches right of the
    // rule, which the impact guard on nodes says nothing about.
    let edgesPastRule = 0;
    let maxEdgeScreenX = -Infinity;
    const edgeSample: Array<{ sx: number; kind: string; start: number; end: number; settled: boolean; u: number; pts: number }> = [];
    if (worldX != null) {
      for (let i = 0; i < n; i++) {
        const nd = p.nodes[this.nodesByX[i]!]!;
        if (nd.impact <= t + 0.001) continue;
        const s = this.worldToScreen(nd.x, nd.y);
        if (s.x >= 0 && s.x <= this.width && s.y >= 0 && s.y <= this.height) {
          unlandedInFrame++;
          if (s.x < minUnlandedScreenX) minUnlandedScreenX = s.x;
          if (unlandedSample.length < 6) unlandedSample.push({ sx: +s.x.toFixed(1), sy: +s.y.toFixed(1), impact: nd.impact, kind: nd.kind });
        }
      }
      // The *drawn* tip of every edge on the stage, by drawPolyline's own
      // arithmetic: `u` indexes the point list, so the tip is the point at
      // `floor(u*(count-1))` plus the fractional part of the next segment.
      // A settled edge is drawn whole, so its tip is its last point.
      for (const e of p.edges) {
        if (e.start > t) continue;
        const count = e.pts.length >> 1;
        if (count < 2) continue;
        const settled = e.end <= t;
        const u = settled ? 1 : Math.max(0, Math.min(1, this.travelU(e, t)));
        const f = u * (count - 1);
        const full = Math.min(count - 1, Math.floor(f));
        let tipX = e.pts[full * 2]!;
        if (full < count - 1) tipX += (e.pts[full * 2 + 2]! - e.pts[full * 2]!) * (f - full);
        // The widest x anywhere in the drawn prefix, not just its end: a
        // merge curve can turn back on itself.
        let widest = tipX;
        for (let k = 0; k <= full; k++) widest = Math.max(widest, e.pts[k * 2]!);
        if (widest > worldX + 1) {
          edgesPastRule++;
          const sx = this.worldToScreen(widest, 0).x;
          if (sx > maxEdgeScreenX) maxEdgeScreenX = sx;
          if (edgeSample.length < 8) edgeSample.push({ sx: +sx.toFixed(1), kind: e.kind, start: +e.start.toFixed(1), end: +e.end.toFixed(1), settled, u: +u.toFixed(3), pts: count });
        }
      }
    }
    // The overhang: work that has happened but that main has not received.
    //
    // A different quantity from `beyondWorld` above, and the one a viewer
    // actually asks about. `beyondWorld` counts nodes right of the *playhead*
    // and must be zero — nothing is drawn before it happens. This counts nodes
    // right of *main's head* and left of the playhead, which is committed work
    // waiting on a merge, and is the one thing this app can show that a
    // topological tool cannot. Their thread endings say which it is: `merged`
    // means it landed later, `tip` means it never did.
    // Main's newest *landed commit*, not `spineTip` — that returns the drawn
    // end of the stroke, which has no impact on it to compare against.
    const spine = p.threads[0];
    let tip: NodeGeom | null = null;
    if (spine) {
      for (let i = spine.nodeIdxs.length - 1; i >= 0; i--) {
        const nd = p.nodes[spine.nodeIdxs[i]!];
        if (nd && nd.impact <= t + 0.001) { tip = nd; break; }
      }
    }
    let overhang = 0;
    const endings: Record<string, number> = {};
    let worstOverhangSeconds = 0;
    if (tip) {
      for (let i = n - 1; i >= 0; i--) {
        const nd = p.nodes[this.nodesByX[i]!]!;
        if (nd.x <= tip.x) break; // sorted by x, so the rest are behind main
        if (nd.impact > t + 0.001) continue;
        overhang++;
        const th = p.threads[nd.threadIdx];
        const key = th ? th.ending : 'unknown';
        endings[key] = (endings[key] ?? 0) + 1;
        const gap = nd.impact - tip.impact;
        if (gap > worstOverhangSeconds) worstOverhangSeconds = gap;
      }
    }
    return {
      t,
      resident: n,
      landed,
      fitResidualWorld: residual,
      worldX,
      maxLandedX,
      maxLandedImpact,
      beyondWorld,
      worst,
      nonMonotone,
      mainHeadX: tip ? tip.x : null,
      mainHeadImpact: tip ? tip.impact : null,
      // Screen x of the playhead, whether or not the rule is drawn there.
      // `showPresent` governs the drawing; the position is a property of the
      // clock and the camera, so a test can ask for it with the mark off —
      // which is the default, and the state that needs guarding.
      presentScreenX: worldX == null ? null : this.worldToScreen(worldX, tip ? tip.y : 0).x,
      mainHeadScreenX: tip ? this.worldToScreen(tip.x, tip.y).x : null,
      overhang,
      overhangEndings: endings,
      worstOverhangSeconds,
      unlandedInFrame,
      minUnlandedScreenX,
      unlandedSample,
      edgesPastRule,
      maxEdgeScreenX,
      edgeSample,
      rotation: this.view.rotation,
      viewScale: this.view.scale,
      spanImpact: [a.impact, b.impact],
      spanX: [a.x, b.x],
    };
  }
  /** How much of each spark's comet to draw this frame; see the body loop. */
  private bodyDetail = 1;
  /** How much of each thread's energy trail to draw this frame; see the body loop. */
  private edgeDetail = 1;
  private clipX0 = -Infinity;
  private clipX1 = Infinity;
  /** World x of the playhead this frame; see `drawPolyline` and `xAtTime`. */
  private presentX = Infinity;
  /** Held framing while the plan's own cues are unusable; null when they are not. */
  private rescueView: { cx: number; cy: number; w: number; h: number } | null = null;
  private frameCounter = 0;
  private tmp = { x: 0, y: 0 };
  private tmp2 = { x: 0, y: 0 };
  /** Node indices in landing order, so the shop window can grow a bounding box. */
  private byImpact = new Int32Array(0);
  private landedPtr = 0;
  private landedT = -1;
  /**
   * Whether the clock is running, set by the frame loop each frame.
   *
   * The quality ladder reads it: a paused stage still draws, and frames spent
   * holding a still picture say nothing about whether a device can perform.
   */
  live = false;
  /** Empty until a node lands: an all-zero box would drag the bounds to the origin. */
  private landed = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  private shopView: { cx: number; cy: number; scale: number } | null = null;

  settings: RenderSettings = {
    reducedMotion: false,
    noFlash: false,
    noShake: false,
    highContrast: false,
    quality: 'full',
    labels: 'landmarks',
    contributorFocus: null,
    selectedNode: null,
    hoverNode: null,
    selectedThread: null,
    showGlyphs: true,
    showSpineLabel: true,
    showPresent: false,
    /**
     * How much of the canvas the page's own furniture is standing on.
     *
     * 150 was `--band` from `styles.css`, and `--band` is a `min-height` — the
     * band is a flex column that grows with what is in it, and what is in it is
     * a row of view toggles, the date, the scrubber and the transport.
     * Measured off `getBoundingClientRect` at eight window shapes (1600x900,
     * 1920x1080, 1440x900, 1855x620, 1280x720, 844x390, 390x844, 820x1180):
     * the band is **241 px** tall at all seven desktop shapes and 273 on the
     * phone, and the topmost thing a viewer reads in it — the COMMITS and
     * CONTROLS pills — starts **199 px** from the bottom on seven of the eight.
     * So the renderer was composing into 49 px of the page's controls and
     * captioning into them.
     *
     * A viewer reported the result: "on public-apis the merge rings and their
     * labels are drawn straight through the COMMITS and CONTROLS pills". They
     * are: `.band`'s background is a gradient that is fully transparent at its
     * own top edge, which is the row the pills sit on, and `.vbtn` is
     * `rgba(7,8,12,0.6)` — so canvas ink under a pill shows *through* it.
     * Measured on public-apis at 1600x900, lit canvas pixels inside the pills'
     * own bounding boxes: 0 at seven of eleven points sampled, and 150/435 and
     * 164/492 of an 1,800 and 1,968 pixel box at three of them.
     *
     * 199 rather than 241, because between the two the band's gradient is
     * nearly transparent and the ink there is on open stage where it belongs.
     *
     * This is a measured stand-in for a number the page should be handing over.
     * `safe` is documented as "screen-space safe insets (top chrome, bottom
     * timeline)" and nothing ever sets it, so the default *is* the value — and
     * with the controls hidden the band hugs its contents at about 103 px and
     * this over-reserves instead. `Stage.tsx` measuring `.band` and passing its
     * height would make both cases exact; over-reserving in a mode a viewer
     * opted into is the better of the two errors, because under-reserving is
     * the default.
     *
     * `top` is 56 and the top bar measures 56 at seven of the eight shapes
     * (64 on the phone), so it is left alone.
     */
    safe: { top: 56, bottom: 199, left: 24, right: 24 },
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
    this.hasCanvasFilter = 'filter' in ctx;
    // Start where this device left off rather than optimistically. See
    // `LADDER_KEY`; the climb below is what makes this safe to remember.
    const earned = typeof localStorage !== 'undefined' ? loadLadder() : null;
    if (earned) {
      this.dprEarned = earned.dpr;
      this.qualityEarned = earned.quality;
    }
    // Four levels: 1/4, 1/8, 1/16 and 1/32 of the stage. The first two carry
    // the bloom every frame; the last two are only read for the landing
    // page's wide second pass. At 1600x900 the whole chain is under 40 KB.
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('canvas');
      this.mips.push(c);
      this.mipCtxs.push(c.getContext('2d')!);
    }
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
    // is not a performance question. See the note in docs/notes/TASKS.md.
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
    // The closing shot's cached box, and where it had eased to. Both describe
    // a plan that is being replaced. The cache key covers the plan hash, the
    // window key, the node count and the two end positions — a reviewer's
    // question was whether a swap could change what is resident without
    // changing any of those five, and clearing here means the answer stops
    // mattering.
    this.tableauShot = null;
    this.tableauEase = null;
    // A new performance is a new load, and the frames it spends arriving say
    // nothing about the device.
    this.framesSeen = 0;
    this.slowShare = 0;
    this.sinceStep = 0;
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
    this.mergeCount = p.stats.merges;
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

  /** Hold a spine segment for the pass after the bloom, reusing the slot. */
  /**
   * How far along the main line the ink has got, in world units.
   *
   * `spineTip` claims to be "the far end of the main line *as drawn*" and is
   * not: it interpolates between the newest landed commit and the next one by
   * how much of the *time* between their impacts has passed, and an edge has
   * its own `start` and `end` which need not span that gap — so on a spine
   * built from ribbons the tip runs ahead of the ink. Measured on mdBook,
   * thirteen frames in the first six seconds: the gap from the nameplate to
   * the rightmost lit pixel on its own row ran 26, 46, 52, 53, 62, 72, 76, 91,
   * 95, 100, 122, 123, 132 px, against the 50 it is drawn at. A viewer
   * reported "the MAIN chip consistently floats 70-100px to the right of the
   * line head it's labelling" and was reading the low end of that off a
   * screen.
   *
   * This is the ink. `u` indexes the point list and the spine is laid out flat
   * and evenly in x, so interpolating x by `u` is the same arithmetic
   * `drawPolyline` uses to decide where to stop, and `presentX` is the same
   * clip. Two array reads and a multiply, per visible stretch of the spine.
   *
   * Called from every pass that draws a stretch of main, which is three of
   * them and not one: the deferred structural stroke below, *and* the two
   * ribbon paths, which return before reaching it. Missing the ribbons left
   * the plate 68 px short of the end of the line on React's closing frame —
   * on top of four commits, with the line running through it — because the
   * last stretch of main there is a counted run rather than individual
   * commits.
   */
  private noteSpineInk(pts: Float32Array, u: number) {
    const lastX = pts[pts.length - 2]!;
    const x0 = pts[0]!;
    const end = Math.min(this.presentX, x0 + (lastX - x0) * Math.max(0, Math.min(1, u)));
    if (end > this.spineDrawnX) this.spineDrawnX = end;
  }

  private keepSpine(pts: Float32Array, u: number, alpha: number) {
    this.noteSpineInk(pts, u);
    const slot = this.spineRedraw[this.spineCount];
    if (slot) {
      slot.pts = pts;
      slot.u = u;
      slot.alpha = alpha;
    } else {
      this.spineRedraw.push({ pts, u, alpha });
    }
    this.spineCount++;
  }

  /**
   * Step the resolution down if the frames say the device cannot hold this one.
   *
   * The test is a count of frames slower than a tenth of a second rather than
   * a frame rate, because what matters is a sustained run at the floor and not
   * the average of a run and a recovery.
   *
   * Two seconds' worth in a row before anything changes. A seek, a first
   * paint, a compile finishing on the same thread and a tab coming back from
   * the background are all several slow frames together and none of them mean
   * the device is slow — the run has to be sustained to be about the device.
   * The EMA is kept alongside so a run of merely mediocre frames does not
   * accumulate towards the same conclusion as a run of terrible ones.
   */
  private watchFrameRate(dtReal: number) {
    /**
     * Only while something is actually playing.
     *
     * The last commit claimed this wanted "ninety frames *of a performance*…
     * so a step costs a canvas reallocation only once the show is actually
     * running", and that was not what it did: `framesSeen` counted every frame
     * drawn, and a paused stage still draws. With `play()` never called and
     * the clock parked at zero it spent a rung within two seconds — judging a
     * device on frames that were costing it nothing to hold still.
     */
    if (dtReal <= 0 || !this.live) return;
    this.frameEma = this.frameEma ? this.frameEma * 0.9 + dtReal * 0.1 : dtReal;
    // Ten frames a second, named here rather than inherited from the frame
    // loop's clamp. It used to be the clamp — `dtReal >= 0.0999` was reading
    // "this frame was capped" — and when the clamp moved to half a second to
    // stop slow frames turning the show into slow motion, a test written
    // against the old value would have silently stopped counting anything.
    this.slowShare = this.slowShare * 0.9 + (dtReal >= SLOW_FRAME_SECONDS ? 0.1 : 0);
    // The same shape as `slowShare`, for the other direction. A "fast" frame
    // is one inside two vsyncs at 60 Hz, which is the point at which the stage
    // stops reading as a stutter.
    this.fastShare = this.fastShare * 0.9 + (dtReal <= FAST_FRAME_SECONDS ? 0.1 : 0);
    this.sinceStep++;
    this.framesSeen++;
    this.climbFrameRate();
    /**
     * Sustained, and about the device rather than the moment.
     *
     * Three conditions, each ruling out a different false positive. Seven
     * frames in ten being slow says the trouble is the norm and not an
     * incident — a seek, a first paint, a compile finishing on the same thread
     * and a tab coming back from the background are all bursts of slow frames
     * and none of them mean the device is slow. The frame average being over
     * 60ms says the slow frames are actually slow, so a run of merely mediocre
     * ones does not accumulate towards the same conclusion as a run of
     * terrible ones. And thirty frames since the last step stops the ladder
     * spending every rung it has in one bad second.
     */
    if (this.framesSeen < 90 || this.slowShare < 0.7 || this.frameEma < 0.06 || this.sinceStep < 30) return;
    this.slowShare = 0;
    this.sinceStep = 0;

    // Resolution first, because it is the cheapest thing to give up and the
    // largest saving — and unlike the bloom, nobody chose it.
    if (this.dpr > 1) {
      this.dprEarned = 1;
      renderProfile.counts.dprSteppedDown++;
      this.rememberLadder();
      this.resize();
      return;
    }

    // Then the picture itself, a notch at a time.
    const next = this.quality === 'full' ? 'reduced' : this.quality === 'reduced' ? 'minimal' : null;
    if (next) {
      this.qualityEarned = next;
      renderProfile.counts.qualitySteppedDown++;
      this.rememberLadder();
      this.resize();
      return;
    }

    /**
     * And then fewer pixels than the window has, upscaled by the compositor.
     *
     * `minimal` used to be the floor, on the reasoning that past it there is
     * nothing left to remove that is not the history. True of *effects*, and
     * it left the worst devices with nowhere to go: a 1x display already at
     * `minimal` had spent every rung, and the measurements say that is not a
     * hypothetical — headless WebKit at 1280x720 runs the demo at 5.65 frames
     * a second, an iPhone 12 descriptor at 3.55, and Chromium under 20x CPU
     * throttling at 2.43. Those are honest, in real time, and unwatchable.
     *
     * Fill is quadratic in this number, so 0.75 is a little over half the
     * pixels and 0.6 is a little over a third. The picture gets soft — this is
     * the same trade as a game dropping its render scale — and it is only
     * reached by a device that has already given up the bloom, the dust and
     * its second device pixel, so the alternative on offer is not a sharp
     * picture but a slideshow.
     *
     * 0.6 is the floor because the stage is drawn in hairlines: the lane glow
     * and the 1px spine survive a bit over a third of the pixels and stop
     * reading as lines much below it. `resize` needs no change — `dpr` has
     * always been a multiplier on the backing store, and nothing in the
     * renderer assumed it was at least one.
     */
    const under = this.dprEarned > 0.75 ? 0.75 : this.dprEarned > MIN_RENDER_SCALE ? MIN_RENDER_SCALE : null;
    if (under == null) return;
    this.dprEarned = under;
    renderProfile.counts.dprSteppedDown++;
    this.rememberLadder();
    this.resize();
  }

  /** Write the current rung, so the next load starts here. See `LADDER_KEY`. */
  private rememberLadder() {
    this.fastShare = 0;
    if (typeof localStorage === 'undefined') return;
    saveLadder({ dpr: Number.isFinite(this.dprEarned) ? this.dprEarned : 2, quality: this.qualityEarned });
  }

  /**
   * And step back up when the frames say the device can hold more.
   *
   * Without this the ladder is one-way, which is wrong twice over. Within a
   * session a device that improves -- a laptop plugged in, a compile
   * finishing, twenty other tabs closed -- never gets its picture back. And
   * across sessions, remembering a rung would make one bad minute permanent,
   * which is why persistence could not ship without this.
   *
   * Deliberately harder to climb than to fall, because a wrong step up is
   * visible as a stutter while a wrong step down is only a slightly softer
   * picture: nine tenths of frames comfortably fast, an EMA under 20 ms, and
   * four times as many frames between rungs as the descent needs. So a device
   * oscillating at the boundary settles at the lower rung rather than
   * flickering between two.
   */
  private climbFrameRate() {
    if (this.fastShare < 0.9 || this.frameEma > CLIMB_EMA_SECONDS || this.sinceStep < 120) return;
    // Resolution last on the way down, so first on the way up.
    if (this.dprEarned < 1) {
      this.dprEarned = this.dprEarned < 0.75 ? 0.75 : 1;
    } else if (this.qualityEarned !== 'full') {
      this.qualityEarned = this.qualityEarned === 'minimal' ? 'reduced' : 'full';
    } else if (this.dprEarned < 2) {
      this.dprEarned = 2;
    } else {
      return;
    }
    this.sinceStep = 0;
    this.fastShare = 0;
    this.rememberLadder();
    this.resize();
  }

  /**
   * What to actually draw at: the viewer's setting, or what the device has
   * earned, whichever asks for less. Every cost decision reads this rather
   * than `settings.quality` directly.
   */
  private get quality(): Quality {
    return QUALITY_RANK[this.settings.quality] <= QUALITY_RANK[this.qualityEarned] ? this.settings.quality : this.qualityEarned;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dprCap = this.quality === 'full' ? 2 : this.quality === 'reduced' ? 1.5 : 1;
    this.dpr = Math.min(dprCap, this.dprEarned, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.glow.width = Math.max(1, Math.round(this.canvas.width / 2));
    this.glow.height = Math.max(1, Math.round(this.canvas.height / 2));
    for (let i = 0; i < this.mips.length; i++) {
      const d = 4 << i;
      this.mips[i]!.width = Math.max(1, Math.round(this.canvas.width / d));
      this.mips[i]!.height = Math.max(1, Math.round(this.canvas.height / d));
    }
  }

  get camera(): CameraCue | null {
    return this.lastCue;
  }

  /**
   * The stage's size in CSS pixels.
   *
   * Exposed so a caller can key work to the viewport rather than to whatever
   * the page has just re-laid-out. `measureSafeInsets` needs exactly that: the
   * insets it reads have to follow the window, and must *not* follow the date
   * band growing to hold a travel slider while a performance is being watched.
   */
  get canvasSize(): { w: number; h: number } {
    return { w: this.width, h: this.height };
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    const v = this.view;
    const dx = x - v.cx;
    const dy = y - v.cy;
    const cos = Math.cos(v.rotation);
    const sin = Math.sin(v.rotation);
    return { x: v.ox + (dx * cos - dy * sin) * v.scale, y: v.oy + (dx * sin + dy * cos) * v.scale };
  }

  /**
   * One drawn pixel, in world units, at the framing currently in force.
   *
   * The edge and node passes run inside `ctx.scale(view.scale, view.scale)`,
   * so every width and radius they set is in world units. This converts the
   * other way, which is what a floor in *pixels* needs. `Math.min(1, dpr)` is
   * a no-op at one or two device pixels per CSS pixel and widens the floor
   * only where the stage has stepped its resolution down and is drawing fewer
   * pixels than the window has — the same expression, for the same reason, as
   * the spine's own floor.
   */
  private worldPerPixel(): number {
    return 1 / (Math.max(1e-9, this.view.scale) * Math.min(1, this.dpr));
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

  /** Cached, because the tableau holds still for hundreds of frames. */
  private tableauShot: { key: string; box: { minX: number; minY: number; maxX: number; maxY: number } } | null = null;
  /** Where the closing shot has eased to, so it is a move and not a cut. */
  private tableauEase: { cx: number; cy: number; fit: number } | null = null;

  /**
   * The box the closing tableau should frame.
   *
   * `nodesByX` is sorted, so the resident span is its two ends. On a plan held
   * whole that span is the history, and the shot is the history. On a streamed
   * one it is whatever pages are in hand, capped at `MAX_VIEW_WIDTH` and hung
   * off the newest commit — because what a closing shot is of is the ending,
   * and because a frame wider than the resident geometry is empty canvas
   * presented as the shape of a repository.
   *
   * Deliberately *not* `window.minX/maxX`. Those are geometry-page bounds, and
   * a single long edge carries a wide bounding box, so they read 0..137,222 on
   * mdBook and 404,602..13,866,081 on kubernetes — the whole history in both
   * cases, which is not what is drawable. Node positions are.
   */
  private tableauBox(cueW: number, safeW: number, safeH: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const p = this.perf;
    const n = this.nodesByX.length;
    if (!p || !n) return null;
    const aspect = safeW / Math.max(1e-6, safeH);
    const firstX = p.nodes[this.nodesByX[0]!]!.x;
    const headX = p.nodes[this.nodesByX[n - 1]!]!.x;
    const key = `${p.planHash}:${p.window?.key ?? 'whole'}:${n}:${firstX}:${headX}:${cueW.toFixed(1)}:${safeW.toFixed(1)}:${safeH.toFixed(1)}`;
    if (this.tableauShot?.key === key) return this.tableauShot.box;

    /** The vertical extent of the nodes within `width` of the newest one. */
    const heightWithin = (width: number): { minY: number; maxY: number } => {
      const left = headX + width * 0.05 - width;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = n - 1; i >= 0; i--) {
        const nd = p.nodes[this.nodesByX[i]!]!;
        if (nd.x < left) break;
        if (nd.y < minY) minY = nd.y;
        if (nd.y > maxY) maxY = nd.y;
      }
      if (!Number.isFinite(minY)) return { minY: p.bounds.minY, maxY: p.bounds.maxY };
      const pad = Math.max(40, (maxY - minY) * 0.09);
      return { minY: minY - pad, maxY: maxY + pad };
    };

    const span = Math.max(1, headX - firstX);
    const wanted = span * 1.06 + 80;
    let width = p.window ? Math.min(wanted, MAX_VIEW_WIDTH) : wanted;

    /**
     * How wide the shot may be before the picture is mostly sky.
     *
     * The scale is uniform, so a frame `w` wide is `w / aspect` tall in world
     * units whatever the content does. A 16,000-unit shot of a history whose
     * lanes occupy 1,300 units is 87% empty, and measured on llvm it was 50
     * nodes drawn into a 23-pixel band in a 900-pixel window — a lit-pixel
     * fraction of 0.00014, which is the near-empty stage the original width
     * clamp existed to prevent. Wide is not the same as informative.
     *
     * So the width is bounded by the height as well as by residency: the
     * content has to fill at least `MIN_TABLEAU_FILL` of the frame. It costs
     * coverage — mdBook goes from 11.6% of its history to about 6% — and buys
     * a frame with the history in it rather than above and below it. Entries
     * with tall endings keep a wide shot; entries with a single thread at the
     * end get a tight one, which is what each of them needs.
     *
     * Two passes, because the height depends on the width it is measured over
     * and the width then depends on the height. The second pass only ever
     * narrows, so it cannot oscillate.
     *
     * Only for a windowed plan. A plan held whole — the demo, and anything
     * compiled from a pasted URL — is meant to end on the whole history, and
     * that promise is older and more important than this bound: applying it
     * there took the closing frame from 100% of a generated history to 48%,
     * which two tests caught immediately and were right to. The letterboxing
     * is the correct trade when the alternative is not showing the history at
     * all. On a streamed entry no such promise is available, because only a
     * window is resident — so the frame may as well be one worth looking at.
     */
    const legible = (h: number) => (h * aspect) / MIN_TABLEAU_FILL;
    if (p.window) {
      const first = heightWithin(width);
      width = Math.min(width, legible(first.maxY - first.minY));
    }

    /**
     * And no more commits in it than the stage has room to draw.
     *
     * This is the bound the closing shot never had, and the one the emptiness
     * was actually about. See `TABLEAU_COMMIT_PX`: coverage was 106% of the
     * history on mdBook and public-apis and the frame was 0.17% lit, because
     * every feature the renderer composes is in world units and the scale had
     * fallen to a hundredth. Widening the strokes fixes half of it; the other
     * half is that 1,220 commits cannot be told apart across 1,552 pixels
     * whatever width they are drawn at.
     *
     * `nodesByX` is sorted, so "the last `room` commits" is an index
     * subtraction and one array read — no scan, and exact rather than a mean
     * pitch, which matters because commits cluster: the ending of a repository
     * is usually its densest part, so a mean over the whole history would have
     * allowed a frame two or three times too wide.
     *
     * Divided by 0.95 because the margin past the head below is five per cent
     * of the final width, so the span the nodes get is the other ninety-five.
     *
     * Applied to a plan held whole as well as to a windowed one, deliberately.
     * The residency cap above is gated on `p.window` on the grounds that a
     * whole plan promises its whole history; this bound is not, because
     * mdBook, public-apis and React are all *whole* plans and all three are
     * where the failure was reported. The promise survives where it can be
     * kept — a history sparse enough to draw whole is still drawn whole,
     * because then `n <= room` and this does nothing at all.
     */
    const room = Math.max(2, Math.floor(safeW / TABLEAU_COMMIT_PX));
    if (n > room) {
      const dense = (headX - p.nodes[this.nodesByX[n - room]!]!.x) / 0.95;
      if (dense > 0) width = Math.min(width, dense);
      /**
       * And, having already given up "the whole history", make the frame worth
       * looking at vertically too.
       *
       * `legible` is the fill bound above, and it was gated on `p.window` on
       * the grounds that a plan held whole promises its whole history —
       * applying it there took a generated history's closing frame from 100%
       * to 48% and two tests caught it. That reasoning is sound and it does
       * not apply *inside this branch*: `n > room` is precisely the case where
       * the whole history could not be drawn and the shot is already a wide
       * shot of the ending, so there is no promise left for the fill bound to
       * break.
       *
       * It is worth a lot here. The scale is uniform, so a frame bounded only
       * by width is as tall in world units as `width / aspect` — mdBook's
       * 23,039-unit shot is 10,300 units tall and its lanes occupy about
       * 1,300, which is the 87% of empty sky the original clamp existed to
       * prevent, arrived at from a third direction.
       */
      const h = heightWithin(width);
      width = Math.min(width, legible(h.maxY - h.minY));
    }

    // Never narrower than the shot the director had already composed: `cue.w`
    // is the tail's own framing, and a tableau tighter than that is a step
    // backwards rather than a wide shot. Applied before the box is positioned,
    // so the margin past the head stays five per cent of whatever the final
    // width turns out to be — taking the maximum afterwards left a small
    // repository with 10.6% of empty stage on its right.
    width = Math.max(cueW, width);

    // A margin past the newest commit, so the head sits inside the frame
    // rather than exactly on its edge. A proportion and not a fixed number of
    // units, because the shot's width varies by four orders of magnitude
    // across the shelf.
    const maxX = headX + width * 0.05;
    const minX = maxX - width;
    const { minY, maxY } = heightWithin(width);
    const box = { minX, maxX, minY, maxY };
    this.tableauShot = { key, box };
    return box;
  }

  /** See `focusRuns`. Rebuilt only when the focus or the plan changes. */
  private markFocusRuns(focus: string | null) {
    const p = this.perf;
    const key = `${p?.planHash ?? ''}:${focus ?? ''}`;
    if (this.focusRunsKey === key) return;
    this.focusRunsKey = key;
    const n = p?.aggregates.length ?? 0;
    this.focusRuns = new Uint8Array(n);
    if (!p || !focus) return;
    for (let i = 0; i < n; i++) if (p.aggregates[i]!.contributorIds.includes(focus)) this.focusRuns[i] = 1;
  }

  /**
   * Is this node part of what the focused contributor did?
   *
   * Either it is theirs, or it is a run that holds some of their commits —
   * which on a large history is where nearly all of anybody's work is.
   */
  private inFocus(nd: NodeGeom, focusIdx: number): boolean {
    if (focusIdx < 0) return true;
    if (nd.contributorIdx === focusIdx) return true;
    return nd.aggregateIdx != null && this.focusRuns[nd.aggregateIdx] === 1;
  }

  private applyCamera(planned: CameraCue, dtReal: number, t: number) {
    const s = this.settings.safe;
    const safeW = Math.max(80, this.width - s.left - s.right);
    const safeH = Math.max(80, this.height - s.top - s.bottom);
    if (this.manual) {
      if(this.perf?.window)this.manual.scale=Math.max(this.manual.scale,safeW/MAX_VIEW_WIDTH);
      this.view = { scale: this.manual.scale, ox: s.left + safeW / 2, oy: s.top + safeH / 2, rotation: 0, cx: this.manual.x, cy: this.manual.y };
      return;
    }
    const sound = this.usableCue(planned);
    if (sound) this.rescueView = null;
    const cue = sound ? planned : this.rescueCue(planned, t, dtReal);
    if (renderProfile.enabled && !sound) renderProfile.counts.rescuedCues++;
    // The two things that make the camera lurch, and the one switch that
    // holds both still. `punch` is the shove toward an arrival; `rotation` is
    // the roll around it. Reduced motion already implies both.
    const still = this.settings.reducedMotion || this.settings.noShake;
    const targetPunch = still ? 1 : cue.punch;
    const k = dtReal > 0 ? 1 - Math.exp(-dtReal * 14) : 1;
    this.smoothedPunch += (targetPunch - this.smoothedPunch) * k;
    if (this.shopWindow && this.applyShopWindow(t, dtReal)) return;
    /**
     * The closing tableau, framed from the plan's own bounds.
     *
     * `camera.ts` already means this: in the tail it sets the target frame to
     * the whole bounding box and says so — "the one moment worth showing
     * everything at once". Then the next few lines clamp the integrator's
     * state to `MAX_FRAME_W`, which is 2,600 world units and exists to stop a
     * logarithmic spring exponentiating an overshoot into a frame a thousand
     * times the maximum. It is a stability guard, and it was being applied to
     * a target that needs no stabilising: the tail's width is read straight
     * off finite bounds and never integrated towards.
     *
     * So every history wider than 2,600 units has always ended on a shot of a
     * small piece of itself. Measured on mdBook, whose geometry is 137,626
     * units across: the tableau framed 5,714 of them — four per cent — and
     * drew twelve nodes and eight edges a frame. The stage was not blank, but
     * it was near enough to empty that it was reported as blank, and what the
     * comment promises never happened once.
     *
     * Here rather than in `camera.ts` on purpose. The camera is compiled into
     * the plan, and twelve plans are published and immutable; changing how
     * cues are written fixes nothing already on the shelf and would need a
     * `choreographyVersion` bump, which is a promise that every one of them is
     * recompiled and republished before it can be played again. This reads the
     * same bounds at draw time and fixes the shot for plans that already
     * exist — including the ones nobody is going to recompile tonight.
     *
     * The precedent is two lines down: the lane floor is already waived for
     * this shot, for exactly this reason. A tableau that cannot pull back is
     * the only thing that floor was ever protecting, and it was protecting it
     * from nothing.
     *
     * "Everything at once" is true of a plan held whole and false of a streamed
     * one, and the difference is not small. A windowed history keeps only the
     * pages around the playhead, and the scale floor below refuses to show more
     * than is loaded — correctly, because the alternative is presenting empty
     * stage as the shape of a repository. So the closing frame is 16,000 world
     * units wide whatever the history is, which is the whole of the demo and a
     * fraction of Linux:
     *
     *   mdBook        137,222 units    11.7% in frame   151 nodes, 204 edges
     *   React         485,139           3.3%            154 nodes, 237 edges
     *   kubernetes 13,461,479           0.1%            148 nodes, 364 edges
     *   Linux      40,131,368           0.04%           136 nodes, 609 edges
     *
     * Which is a full frame in every case — it is a wide shot of the ending,
     * not a wide shot of everything, and it is not the near-empty stage the
     * clamp used to produce. Showing the real whole of a streamed history would
     * mean packaging a decimated overview of it and drawing that instead, which
     * is a different picture with a different claim attached, and a decision
     * about what the ending *is* rather than a bug to be fixed.
     */
    /**
     * The closing shot, framed from what this performance actually holds.
     *
     * Three attempts. The first two are worth writing down, because both
     * looked right under a test that was not the right test.
     *
     * Framing from `perf.bounds` on a streamed plan aims at the midpoint of
     * the *whole* history — the summary carries those bounds and
     * `assembleWindow` keeps them — while the zoom floor below refuses any
     * scale showing more than is resident. So it produced a `MAX_VIEW_WIDTH`
     * slice of the *middle*, and on kubernetes the frame centre sat 7,014,201
     * units from the final commit: 0.11% of the history in frame, and none of
     * it the ending. It read as fixed because the frame was *full* — 151 nodes
     * on mdBook — which is a healthy-looking picture of the wrong part of the
     * repository. "Not blank" was the wrong test.
     *
     * Guarding that on whether the floor permitted the shot was worse. The
     * condition needed a history narrower than about 15,000 units; the
     * narrowest published entry is 137,706, so the branch was a constant
     * `false`, every streamed entry fell through to the cue, and the cue's
     * tail width is 2,600 units for all twelve. Coverage went *down* — mdBook
     * 11.6% to 1.89%, eighteen nodes in frame. What caught it was measuring
     * all twelve entries at four viewport shapes, which is also why the two
     * previous attempts were not caught.
     *
     * What is actually true: a streamed plan can honestly show the span its
     * resident nodes cover, up to the floor, and the shot has to *end* at the
     * newest commit rather than be centred on anything. So take the resident
     * span, cap its width, and hang it off the right-hand end. The head-band
     * correction below is waived for a tableau on the grounds that the head is
     * in frame by construction — which was false while the frame was centred
     * on a midpoint, and is true again now.
     *
     * A plan held whole — the demo, and anything compiled from a pasted URL —
     * has no window and no floor, and still frames its whole history.
     */
    const tableau = cue.state === 'tableau' && this.zoomLock == null;
    let bounds: { cx: number; cy: number } | null = null;
    let fit: number;
    const shot = tableau ? this.tableauBox(cue.w, safeW, safeH) : null;
    if (shot) {
      /**
       * Eased into, because nothing else smooths it.
       *
       * The compiled cue swings into the tail over about two seconds of
       * spring. This box does not go through the spring — it is computed at
       * draw time and was going straight into `view.cx`, so the frame the
       * state turned `tableau` moved the camera 6,566 to 6,874 world units in
       * one frame, 87x to 176x the median dolly, with a 5.6x to 6.6x zoom step
       * in the same frame, and then held exactly still for 97 to 127 frames.
       * A cut followed by a freeze, which is what the previous attempt at this
       * shot also did and what the one before it was fixing.
       *
       * The filter is the one `rescueCue` already uses: `1 - exp(-dt * k)`,
       * the analytic solution rather than an Euler step, so it is stable at
       * any frame length and it still snaps when `dtReal` is zero — which is
       * what a seek looks like, and a seek should arrive rather than glide.
       */
      const target = { cx: (shot.minX + shot.maxX) / 2, cy: (shot.minY + shot.maxY) / 2, fit: Math.min(safeW / (shot.maxX - shot.minX), safeH / (shot.maxY - shot.minY)) };
      if (dtReal <= 0) this.tableauEase = target;
      else if (!this.tableauEase) {
        // Entering the shot during playback: start from where the camera is,
        // not from where it is going.
        this.tableauEase = { cx: this.view.cx, cy: this.view.cy, fit: this.view.scale };
      } else {
        const k = 1 - Math.exp(-dtReal * 2.4);
        this.tableauEase = {
          cx: this.tableauEase.cx + (target.cx - this.tableauEase.cx) * k,
          cy: this.tableauEase.cy + (target.cy - this.tableauEase.cy) * k,
          fit: this.tableauEase.fit + (target.fit - this.tableauEase.fit) * k,
        };
      }
      bounds = { cx: this.tableauEase.cx, cy: this.tableauEase.cy };
      fit = this.tableauEase.fit;
    } else {
      this.tableauEase = null;
      fit = Math.min(safeW / cue.w, safeH / cue.h);
    }
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
    /**
     * No punch on a tableau, and no width floor either.
     *
     * `smoothedPunch` scales the frame and not the box, so above a punch of
     * about 1.11 the frame becomes narrower than the box it was composed from
     * and the newest commit — placed at 95% across — leaves the screen
     * entirely. Kubernetes's compiled tableau cues reach 1.1178; only the
     * smoothing lag kept the head in frame at sixteen frames a second, and a
     * faster machine would have lost it. A tableau is a still, so the punch it
     * inherited from the phrase before it has nothing to express anyway.
     *
     * The `MAX_VIEW_WIDTH` floor is also skipped here, because `tableauBox`
     * has already applied it to the box — reapplying it to the scale would
     * override the height bound and put the letterboxing straight back.
     */
    const scale = shot
      ? fit
      : Math.max(this.perf?.window ? safeW / MAX_VIEW_WIDTH : 0, (this.zoomLock ?? fit) * this.smoothedPunch, this.zoomLock != null ? 0 : laneFloor);
    this.view = {
      scale,
      ox: s.left + safeW / 2,
      oy: s.top + safeH / 2,
      rotation: still ? 0 : cue.rotation,
      // Centred on whatever is being framed. Widening the shot to the bounds
      // while still pointing at the cue's centre shows the whole width from
      // the wrong place, which is a different way of missing most of it.
      cx: bounds ? bounds.cx : cue.x,
      cy: bounds ? bounds.cy : cue.y,
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
    //
    // Not during the closing tableau. That shot is the whole picture, so the
    // head is in it by construction — sitting at the right-hand end, where the
    // last commit is, which is exactly where a band that insists on seven
    // tenths across would drag the camera away from. Two rules composing into
    // a shot neither of them asked for.
    const head = bounds ? null : this.spineTip(t);
    if (head && this.view.scale > 0) {
      /**
       * Where the band sits, and why it moved right.
       *
       * It was three fifths to seven tenths, and a cold viewer reported "the
       * frontier never gets past about 60% of the width". She was describing
       * the arithmetic. The correction below only ever pushes the head back to
       * the *near* edge of the band, and the director composes around the
       * phrase it is playing, which is almost always left of the head — so the
       * head is not somewhere in a band, it is pinned at `lo`. Measured on
       * mdBook, thirteen consecutive frames in the first six seconds: the
       * nameplate's x was a constant 1010 in a 1600-wide window, which is the
       * head at exactly 960, which is exactly `width * 0.6`.
       *
       * And nothing is drawn right of the head, by construction — that is the
       * whole of `48aa84b` and `tests/unit/reveal.test.ts`. So the band was
       * setting the empty share of the stage directly. Ink per horizontal
       * twelfth at threshold 60, six samples across mdBook and public-apis:
       * the last four twelfths read 0.00% in six of six, and the rightmost lit
       * column sat at 59.9–74.7% of the frame.
       *
       * `RIGHT_ROOM` is why this is not simply 0.9. The captions that sit
       * right of a commit are placed at `s.x + 12` and rejected outright by
       * `place()` if their box would cross the frame — "409 commits converge"
       * is about 150 px of text — so a band pushed hard right silently deletes
       * the merge labels near the head on a narrow window. At 1600 wide the
       * fraction binds and the head lands at 0.82; at 844 (a landscape phone)
       * the room binds and it lands at 0.76, which is still 16 points better
       * than it was and still captions its merges.
       */
      /**
       * Back towards the middle, on the owner's report that 0.82 reads "so far
       * right now" against the 55-60% they remembered.
       *
       * The band was 0.6-0.7 before today and was moved right to spend the
       * empty right-hand third of the frame on history. That measurement was
       * real -- the last four twelfths carried 0.00% ink in six of six samples
       * -- but it treated an empty band as waste when it is also headroom: the
       * head sits at the *left* edge of the band, so everything to its right is
       * where arriving work is seen coming.
       *
       * 0.62-0.72 restores what was there, one twentieth wider so the
       * correction fires less often. `RIGHT_ROOM` still applies on a narrow
       * window, where 62% of 700px would put the head 266px from the edge and
       * a 150px caption would be deleted rather than drawn.
       */
      /**
       * Towards the middle, on the third and best-argued report about this.
       *
       * The band has been 0.6-0.7, then 0.82-0.9, then 0.62-0.72. The reason
       * to move again is not another preference: **people look at the middle
       * of a screen, and holding the eye at 62-72% for the length of a
       * performance is work.** A stage somebody watches for four minutes is
       * different from one they glance at.
       *
       * What made this affordable is a measurement. The band was pushed right
       * in the first place because the right of the frame was empty -- the
       * last four twelfths carried 0.00% ink in six of six samples -- and an
       * empty right edge with the head at the middle would be half a wasted
       * frame. That is no longer true. On `torvalds/linux` at 1:37, main's
       * newest commit sits 2,264 world units behind the playhead, because main
       * went 2.4 s without landing anything while side branches kept
       * committing. Their commits are genuinely later in time and therefore
       * genuinely further right, so the space right of main's head carries
       * real history, not blank stage.
       *
       * Which also answers the complaint that arrives with it: "many branches
       * passing MASTER". They are passing main's newest *commit*, not the
       * playhead -- `presentAudit` reports 0 edges and 0 nodes past the NOW
       * rule at that moment. Anchoring the camera at 62% put main's head there
       * and left the actual frontier at 86%, hard against the right edge,
       * which is what made it read as things escaping.
       */
      const RIGHT_ROOM = 200;
      const lo = Math.min(this.width * 0.5, Math.max(this.width * 0.42, this.width - RIGHT_ROOM));
      const hi = Math.max(lo + 40, Math.min(this.width * 0.6, this.width - RIGHT_ROOM * 0.55));
      const sx = this.worldToScreen(head.x, head.y).x;
      const want = sx < lo ? (sx - lo) / this.view.scale : sx > hi ? (sx - hi) / this.view.scale : 0;
      /**
       * Low-passed, because moving the band right multiplied the zoom's noise.
       *
       * The correction places the head at a fixed *screen* column, so what it
       * asks of `cx` is `tipX - cue.x - (column - ox) / scale`. That last term
       * carries every wobble in `scale` into `cx`, amplified by how far the
       * column is from the frame's centre — which the move from 0.6 to 0.82
       * took from 160 px to 512 px, a factor of 3.2. Measured on streamed
       * Kubernetes at 40% with `x/jitter.mjs` (p95 jerk over pan speed, four
       * runs each): 0.86/0.85/0.89 before the move, 0.95/0.98/0.92/1.02 after
       * it. Real, and about the zoom rather than about the head.
       *
       * So the *shift* is filtered rather than `cx` itself. Filtering `cx`
       * would leave a steady-state error on a ramp — the dolly runs at about
       * 35 world units a frame, so a 125 ms lag is 260 units of permanent
       * offset — while the shift is very nearly constant during a steady dolly,
       * so a low-pass on it has no steady-state error and removes only the
       * high-frequency part. `sx` is read from the cue's own centre, set fresh
       * from the plan every frame, so this is a filter and not a feedback loop:
       * `want` is a function of the clock and the zoom, not of its own output.
       *
       * The exponential form is the one `rescueCue` and the tableau ease use,
       * for the same reason — stable at any frame length, and it snaps rather
       * than glides when `dtReal` is zero, which is what a seek is.
       */
      /**
       * And only while the clock is actually moving.
       *
       * A filter with state keeps converging after its input stops changing,
       * which on a paused stage means the frame is not the same frame twice —
       * `demo.spec.ts` asks for an exact freeze ("no side effects accumulate
       * while paused") and caught this immediately: 600 ms after a pause the
       * stage hash had moved, because 1.5% of the correction was still being
       * worked off. There is nothing to smooth when nothing is moving, so a
       * still clock snaps, exactly as a seek does. `lastT` is the previous
       * frame's time; `render` updates it after this runs.
       */
      const moving = dtReal > 0 && t !== this.lastT && Number.isFinite(this.headShift);
      this.headShift = moving ? this.headShift + (want - this.headShift) * (1 - Math.exp(-dtReal * 7)) : want;
      this.view.cx += this.headShift;
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
      // Eased the way the edge itself is revealed, not straight in time.
      //
      // `travelU` does not run linearly — an ordinary stroke goes as `f^1.6` —
      // and interpolating linearly here put the tip ahead of the ink for most
      // of every commit, so the plate sat further off the line than it was
      // asked to and the line appeared to chase it and catch up at each
      // arrival.
      //
      // `f^1.6` for every step, with no merge case. There was one, keyed on
      // `next.mergeVolume > 0` — but that asks whether the *commit* is a
      // merge, and `travelU` asks whether the *edge* is. Along the spine they
      // are never the same question: `compile.ts` gives a thread its own
      // consecutive edges as `thread` or `aggregate`, and writes a `merge`
      // edge only from a branch's last node into the merge commit, on a slot
      // above zero. So the spine's own approach to a merge commit is a thread
      // edge revealed as `f^1.6`, and the merge curve here was answering for
      // an edge drawn somewhere else. The two differ by up to 0.093 of a
      // commit gap around the middle of the stroke, on 41% of Kubernetes's
      // commits.
      const u = this.settings.reducedMotion ? f : Math.pow(f, 1.6);
      x = head.x + (next.x - head.x) * u;
      y = head.y + (next.y - head.y) * u;
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
  /**
   * How much of the additive light to lay down, given how full the stage is.
   *
   * Branches are drawn twice — `lighter` over the picture and again into the
   * glow buffer — while the main line is a plain `source-over` stroke that
   * never enters the glow at all. So the busier the history the brighter the
   * branches get, and the one line everything else is read against loses by
   * comparison. Square root, so total additive light grows as sqrt(n) rather
   * than n: fuller without brighter. Keyed to live edges rather than to frame
   * time so a history looks the same on every machine, and a no-op at 24.
   */
  private energy = 1;
  /**
   * The spine's structural strokes, deferred until after the glow composite.
   *
   * *Deferred*, not repeated. Drawing them in the edge pass and again on top
   * laid the same halo down twice: the alpha compounded and the per-edge
   * segments overlapped unevenly at their joins, which is the thick chunky
   * band that appeared along the main line. It is one stroke, moved.
   *
   * Moving it costs nothing either. The glow buffer only ever receives the
   * contributor energy trail; a structural stroke is `source-over` on the main
   * context and was never part of the bloom, so drawing it after the composite
   * changes when it lands and not what it is.
   */
  private spineRedraw: Array<{ pts: Float32Array; u: number; alpha: number }> = [];
  /**
   * How many entries of `spineRedraw` are this frame's. The array is a pool.
   *
   * Pushing a fresh object per visible spine edge per frame was a few hundred
   * short-lived allocations a second where the pass it replaced allocated
   * nothing, and it showed up where garbage collection always shows up — not
   * in the mean but in the worst frame. CPython, four interleaved rounds:
   * worst frame 29.4/29.5/30.3/27.1 ms before, 48.9/34.8/54.7/61.5 ms after,
   * with the mean *improving* over the same rounds. Reusing the slots costs a
   * counter.
   */
  private spineCount = 0;
  /** The distinct alphas on this frame's spine. Reused, like the pool above. */
  private spineAlphas: number[] = [];
  private frontWorldX = -Infinity;
  private frontPrev = -Infinity;
  /** The head band's smoothed correction; see where it is applied. */
  private headShift = NaN;
  /** How far along main the ink reached this frame; see `keepSpine`. */
  private spineDrawnX = -Infinity;
  /** The bottom wash, cached: it changes only when the window resizes. */
  private scrim: CanvasGradient | null = null;
  private scrimKey = '';
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
    this.watchFrameRate(dtReal);
    this.spineCount = 0;
    this.spineDrawnX = -Infinity;
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
    /**
     * A jump the clock could not have made by running is a seek, and a seek
     * snaps the camera rather than gliding it across the history.
     *
     * "Could not have made" has to be measured against the frame, not fixed at
     * a second. Playback goes up to 4x, so half a second of real time — which
     * the frame loop now permits — is two seconds of show time, and a flat
     * one-second test would have called every slow frame at speed a seek and
     * snapped the camera on each one. Eight times the frame's own step leaves
     * the fastest legitimate advance well inside, and at sixty frames a second
     * the test is the one second it always was.
     */
    const jumped = this.lastT < 0 || Math.abs(t - this.lastT) > Math.max(1, dtReal * 8);
    this.applyCamera(cue, jumped ? 0 : dtReal, t);
    this.lastT = t;
    lap('camera');
    if (p.nodes.length === 0) {
      this.drawEmptyStage(t);
      return;
    }

    const v = this.view;
    /**
     * Where the stage stops, so nothing is drawn on the page's own controls.
     *
     * `safe.bottom` says how much of the canvas the band is standing on, and
     * until now it was used only to *compose* — the camera fits its box into
     * the safe rectangle and centres on it. That is not the same as keeping
     * ink out: the frame is nearly always bound by width, so the world height
     * on screen is far larger than the box's and outer lanes spread over the
     * whole canvas whatever the insets say. Measured on public-apis at 50% of
     * its show, 1600x900: 2,966 lit canvas pixels inside the band, 435 of them
     * inside the COMMITS pill's own box — two bright branch lines with their
     * commit dots, showing through a pill that is only 60% opaque.
     *
     * A clip and not a per-object fade. Fading each stroke by its own height
     * was tried first and cannot be made right: an active merge edge climbs
     * from an outer lane to the spine, so *any* single height taken off it —
     * mean, top or bottom — is wrong for most of its length. Measured with the
     * mean at 1440x620, where the boundary falls inside the lanes rather than
     * outside them: 699 lit pixels still inside the COMMITS pill. A clip is
     * also a guarantee rather than an approximation, and it covers the passes
     * a per-object fade would each have to be threaded through by hand —
     * bodies, comet trails, impact ripples, tip beacons and the bloom.
     *
     * The cut is softened by a scrim over the last `CHROME_FADE_PX` above it,
     * so the stage dissolves into the band rather than ending on a rule. On
     * the default layout the whole of that happens inside `.band` (241 px
     * tall, boundary at 199) where the page is already darkening the stage.
     */
    //
    // Not on the landing page. `applyShopWindow` composes into the *whole*
    // canvas — `safeW`/`safeH` there are `this.width`/`this.height` — because
    // the picture behind the sign-in form is a backdrop and not a stage with a
    // transport under it. Clipping it to a band that is not there would take
    // 199 px off the bottom of the first thing a visitor sees.
    const stageBottom = this.shopWindow ? this.height : this.height - this.settings.safe.bottom;
    ctx.save();
    // Set in CSS pixels, before the world transform goes on.
    ctx.beginPath();
    ctx.rect(0, 0, this.width, Math.max(1, stageBottom));
    ctx.clip();
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


    const useGlow = this.quality === 'full' && !this.settings.reducedMotion;
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

    // Where the present is, in world units, for the stroke clip in
    // `drawPolyline`. Once a frame rather than per edge: it depends only on t.
    this.presentX = this.xAtTime(t) ?? Infinity;

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
    this.markFocusRuns(focus);
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
    // Set before the additive passes read it, from what is actually live.
    this.energy = Math.max(0.35, Math.min(1, Math.sqrt(24 / Math.max(1, activeEdges.length))));
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
      // The same cut, in device pixels, because this composite sets its own
      // identity transform. Without it the bloom carries a blurred copy of
      // everything the clip above removed straight back onto the controls.
      ctx.beginPath();
      ctx.rect(0, 0, this.canvas.width, Math.max(1, stageBottom * this.dpr));
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      /**
       * Halve down the chain, then draw two levels back up.
       *
       * `copy` on the way down so each level is the level above resampled and
       * nothing accumulates between frames. Smoothing is left at its default
       * bilinear: on a 2x reduction that is a box average, which is what is
       * wanted, and 'high' asks Chromium for a costlier resample that buys
       * nothing here.
       *
       * The pair read back is 1/4 and 1/8, the shallowest pair that still needs
       * only two halvings. Against the old blur, on paused frames at fixed
       * clocks, with **only this file** differing between the two builds:
       *
       *     landing t=6    lit +2.6%   mean +0.4%   band +1.9%   p99 +5.7%
       *     landing t=12   lit +1.0%   mean +0.1%   band -0.0%   p99 +4.4%
       *     landing t=20   lit +4.9%   mean +0.2%   band +0.8%   p99 +1.1%
       *
       * The landing is where this matters: it is a sparse fixture on a dark
       * stage, so the bloom is a large share of the light, and it is the only
       * route that reads the widest level. On a dense history the bloom is
       * about 4% of the brightest band and measuring there gates nothing.
       *
       * That "only this file" is doing real work, because **three readings of
       * these taps were wrong before this one and all three failed the same
       * way** -- comparing builds that differed in more than the bloom:
       *
       *   - pixels sampled after a 240-frame pacing run, so the faster build
       *     was photographed earlier in the history than the slower one. The
       *     content gap was reported as the bloom brightening 46%.
       *   - the shallow pair judged against the deep pair using that same
       *     broken harness, concluding "within a percent". Unfounded, though
       *     the numbers above now vindicate the shallow pair on its own terms.
       *   - a baseline built before `fixtures/landing.ts` changed topology, so
       *     the two builds generated *different histories*. The content gap
       *     was reported as the bloom dimming the stage 41% to 75%, which
       *     triggered a revert of a change that was never at fault.
       *
       * If you touch these numbers: build the baseline from the current tree
       * with only `canvas.ts` reverted, and nothing else.
       *
       * Two levels rather than one because a lone bilinear upscale is a tent
       * filter, which shows as a visible square on an isolated bright stroke.
       */
      for (let i = 0; i < this.mips.length; i++) {
        const m = this.mipCtxs[i]!;
        const src: HTMLCanvasElement = i === 0 ? this.glow : this.mips[i - 1]!;
        m.globalCompositeOperation = 'copy';
        m.drawImage(src, 0, 0, src.width, src.height, 0, 0, this.mips[i]!.width, this.mips[i]!.height);
        // Only the landing page's wide pass reads below 1/8, so stop there.
        //
        // Every level is a `drawImage`, and on an engine that was never paying
        // for the filter at all those draws are pure added cost -- WebKit does
        // not implement canvas `ctx.filter` (`'filter' in ctx` is false), so it
        // used to composite this layer hard-edged for one cheap draw. Three
        // halvings plus two upscales measured 36.5 -> 32.0 fps there over three
        // interleaved rounds. Two halvings is four draws rather than five.
        if (i === 1 && !this.shopWindow) break;
      }
      // Not `* this.energy`. The strokes that fill this buffer are already
      // scaled by it, so scaling the composite too made the blurred light go
      // as energy squared — 24/n, not sqrt(24/n) — which is a total bloom that
      // does not grow with the history at all. Measured against the previous
      // build on public-apis at 66 live edges: the brightest branch band fell
      // 32%, the stage mean 15%, and lit pixels from 6.13% to 4.01%. The taper
      // was doing roughly twice the job it was asked to do.
      /**
       * Split across the two levels rather than spent on one.
       *
       * The sum is the 0.85 the single blurred pass used, because a blur
       * conserves the light it spreads and so does a bilinear upscale, so the
       * total is what has to match. The split sets how the halo falls off:
       * weighted towards 1/4 keeps the core of a stroke bright, and the 1/8
       * tap supplies the spread the 6 px Gaussian had.
       *
       * Gated on the pixel measurements in `x/stage-metrics.mjs`, not on
       * looking about right.
       */
      const tight = this.settings.noFlash ? 0.34 : 0.52;
      const wide = this.settings.noFlash ? 0.21 : 0.33;
      if (this.hasCanvasFilter) {
        ctx.globalAlpha = tight;
        ctx.drawImage(this.mips[0]!, 0, 0, this.mips[0]!.width, this.mips[0]!.height, 0, 0, this.canvas.width, this.canvas.height);
        ctx.globalAlpha = wide;
        ctx.drawImage(this.mips[1]!, 0, 0, this.mips[1]!.width, this.mips[1]!.height, 0, 0, this.canvas.width, this.canvas.height);
      } else {
        // One tap, carrying the light of both, from the wider level so the
        // single tent spreads rather than sitting tight on the stroke. See
        // `hasCanvasFilter`: two taps cost this engine 11% for a softer
        // falloff it has never had, and one costs it nothing.
        ctx.globalAlpha = tight + wide;
        ctx.drawImage(this.mips[1]!, 0, 0, this.mips[1]!.width, this.mips[1]!.height, 0, 0, this.canvas.width, this.canvas.height);
      }
      if (this.shopWindow) {
        // A second, wider pass of the same light, so the picture reads as one
        // scene rather than a scatter of bright strokes. It was twice this
        // strength and the page paid for it: a background that wins the
        // attention it is competing for has stopped being a background. This
        // spreads light already drawn and claims nothing new.
        // 1/32 of the stage, which read back up is roughly the 30 px spread
        // this replaces. Same alpha: it is the same light, spread further.
        ctx.globalAlpha = this.settings.noFlash ? 0.08 : 0.14;
        ctx.drawImage(this.mips[3]!, 0, 0, this.mips[3]!.width, this.mips[3]!.height, 0, 0, this.canvas.width, this.canvas.height);
      }
      ctx.restore();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    // The main line, once, over the bloom.
    //
    // In the edge pass it is painted before the glow composite, so every
    // branch's blurred light lands on top of it — which is why it is the
    // dimmest thing on a dense stage and why branches have three times been
    // reported as crossing it. Here it is the one thing nothing is ever drawn
    // over, by construction rather than one cause at a time.
    //
    // The ink casing arrives with density and is absent without it. On a quiet
    // history there is nothing for the main line to be separated *from*, and a
    // dark rim around it there is an outline drawn for its own sake.
    if (this.spineCount) {
      const casing = 0.7 * (1 - this.energy);
      const heft = 1 - this.energy;
      ctx.save();
      // Back into world space. The glow composite leaves the context in screen
      // pixels, and `drawPolyline` speaks world coordinates — mixing the two
      // draws the main line at the origin, a couple of pixels wide, which is
      // to say not at all. It took the spine off the stage entirely, landing
      // page included.
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.beginPath();
      ctx.rect(0, 0, this.width, Math.max(1, stageBottom));
      ctx.clip();
      ctx.translate(v.ox, v.oy);
      ctx.rotate(v.rotation);
      ctx.scale(v.scale, v.scale);
      ctx.translate(-v.cx, -v.cy);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // One path for the whole spine, stroked three times.
      //
      // Stroked per edge instead, every commit is a seam: adjacent runs share
      // an endpoint, their round caps overlap, and a translucent halo laid
      // down twice there is visibly brighter than the run either side of it.
      // Zoomed out, the main line stopped reading as a line and started
      // reading as fifty joined segments. Collected into a single path it is
      // rasterised once per stroke, so the overlaps cost nothing and show
      // nothing — and it is three strokes a frame rather than three per edge.
      //
      // World units, floored in screen pixels — not fixed in screen pixels.
      //
      // The edge pass sets these widths inside the world transform, so they
      // scale with the zoom. Dividing by `v.scale` pinned them to CSS pixels
      // instead, which is not a smaller change than it sounds: at the usual
      // framing, scale about 0.52, the halo went from 3.6 CSS px to 7.0 and
      // the core from 1.3 to 2.6 — and the pass lands after the node pass, so
      // that doubled core drew a grey band across the middle of every commit
      // dot on the main line. Above scale 1 it inverted and the line came out
      // thinner than before (React at 1.32: 4.0 px to 2.0).
      //
      // What actually needed fixing was only the bottom end, where the line
      // thinned to a sub-pixel hairline as the camera pulled back. So: the
      // world width it always had, and a floor underneath it. Above the floor
      // the arithmetic is the old arithmetic; below it the line stops
      // disappearing. The floor is in CSS pixels because that is the unit the
      // problem is in.
      //
      // A *device* pixel, though, once the stage is drawing fewer pixels than
      // the window has. `1 / v.scale` is one CSS pixel in world units, and at
      // a render scale of 0.6 that lands on 0.6 of a device pixel — below what
      // a rasteriser can put down as a line. Measured at the same moment and
      // camera, the 1px spine survived the drop intact but lane-pair
      // modulation collapsed from 0.455 to 0.060, an 87% loss, where lanes sit
      // five pixels apart: the lines were still being drawn and were no longer
      // landing on anything. `Math.min(1, dpr)` is a no-op at one or two
      // device pixels per CSS pixel, so this changes nothing above the floor
      // and widens the floor itself only where the picture is being
      // undersampled.
      const px = 1 / (v.scale * Math.min(1, this.dpr));
      const wCase = Math.max(9 + 2 * heft, 6 * px);
      const wHalo = Math.max(7 + 1.6 * heft, 4.6 * px);
      const wCore = Math.max(2.6 + 0.8 * heft, 1.7 * px);

      // The casing is one value for the whole line, so it is one path.
      if (casing > 0.02) {
        ctx.beginPath();
        for (let i = 0; i < this.spineCount; i++) {
          const seg = this.spineRedraw[i]!;
          this.drawPolyline(ctx, seg.pts, seg.u, false);
        }
        ctx.strokeStyle = rgba(PALETTE.ink, casing);
        ctx.lineWidth = wCase;
        ctx.stroke();
      }

      // The ivory is not.
      //
      // This took `spineRedraw[0].alpha` and painted the whole line with it.
      // The settled spine *is* uniform — until somebody focuses a contributor,
      // and then each edge is either full strength or multiplied by 0.28
      // depending on who wrote it. One value for all of them threw that away:
      // measured on public-apis with an author focused, the spine's peak
      // luminance went from 65/110/200 at p10/p50/p90 to a flat 80/80/122 —
      // p10 equal to p50 is a line with no variation left in it, and the
      // commits by the person being focused on were no longer lit at all.
      //
      // Grouped by value, not by consecutive run. `settledAlpha` returns a
      // flat 0.95 for a spine edge, so the whole set is that, 0.285 when
      // somebody else is focused, 0.85 when the focused author wrote it, and
      // whatever the in-flight edge carries — four values at the very most,
      // however many hundred segments are visible. Grouping by run instead
      // would have meant one path per edge the moment two contributors
      // alternated along the line, which is the per-edge stroking that made it
      // read as fifty joined pieces in the first place.
      this.spineAlphas.length = 0;
      for (let i = 0; i < this.spineCount; i++) {
        const a = this.spineRedraw[i]!.alpha;
        if (!this.spineAlphas.includes(a)) this.spineAlphas.push(a);
      }
      for (const alpha of this.spineAlphas) {
        ctx.beginPath();
        for (let i = 0; i < this.spineCount; i++) {
          const seg = this.spineRedraw[i]!;
          if (seg.alpha === alpha) this.drawPolyline(ctx, seg.pts, seg.u, false);
        }
        ctx.strokeStyle = rgba(PALETTE.ivory, alpha * (0.22 + 0.06 * heft));
        ctx.lineWidth = wHalo;
        ctx.stroke();
        ctx.strokeStyle = rgba(PALETTE.ivory, alpha);
        ctx.lineWidth = wCore;
        ctx.stroke();
      }
      ctx.restore();
    }
    lap('glow');

    /**
     * The stage dissolves into the page rather than ending on a rule.
     *
     * The clip above is a hard edge, and a hard edge across a picture of
     * hairlines reads as a fault of its own — every thread stopping dead on
     * the same row. So the last `CHROME_FADE_PX` above it are washed to the
     * page's own ink, transparent at the top of the wash and opaque at the
     * cut. Thirty-four pixels, which on the default layout sits between 199
     * and 233 px from the bottom: inside `.band`, whose background is already
     * a gradient to the same colour over the same region, so the two agree
     * rather than compete.
     *
     * One `fillRect` with a cached gradient, in screen space, after everything
     * the world transform drew and before the captions — which have their own
     * bound, the safe rectangle, and are not history.
     */
    if (stageBottom > 0 && stageBottom < this.height) {
      const CHROME_FADE_PX = 34;
      const top = Math.max(0, stageBottom - CHROME_FADE_PX);
      if (this.scrimKey !== `${top}:${stageBottom}`) {
        const g = ctx.createLinearGradient(0, top, 0, stageBottom);
        g.addColorStop(0, rgba(PALETTE.ink, 0));
        g.addColorStop(1, rgba(PALETTE.ink, 1));
        this.scrim = g;
        this.scrimKey = `${top}:${stageBottom}`;
      }
      ctx.fillStyle = this.scrim!;
      ctx.fillRect(0, top, this.width, stageBottom - top);
    }

    // --- Screen-space labels & selection ---
    // Before the labels, so a nameplate is never drawn under the rule.
    this.drawPresent(ctx, t);
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

    if (this.quality === 'minimal') return;

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
  private drawPolyline(ctx: CanvasRenderingContext2D, pts: Float32Array, u = 1, begin = true) {
    const count = pts.length >> 1;
    if (count < 2) return;
    const x0 = this.clipX0;
    const x1 = this.clipX1;
    // No stroke may cross the present. `u` bounds how far along the point list
    // the reveal has got, which is only the same thing as "how far along in
    // time" when the points are spaced evenly in x — and on a merge they are
    // not: a long lane run is sampled at a fixed spacing and capped at 200
    // points, then the turn into the landing adds twenty more over a few
    // hundred units. So the fraction of *points* revealed can be well past the
    // fraction of *x* the clock has reached, and a correct `u` still overshot.
    //
    // Clipping here rather than at each caller because it is the invariant, not
    // a property of one pass: every stroke on the stage goes through this
    // function, and a future change to any easing cannot reintroduce the
    // fault. Infinity when the playhead's x is unknown, which is the case
    // before a plan is resident.
    const front = this.presentX;
    const f = u * (count - 1);
    const full = Math.min(count - 1, Math.floor(f));
    // `begin` lets a caller collect several runs into one path. Stroking a
    // path once rasterises the whole shape and composites it once, so pieces
    // that overlap do not lay their alpha down twice — which is the difference
    // between a line and a string of beads where the pieces meet.
    if (begin) ctx.beginPath();
    // Where the pen currently sits, as a point index; -1 when it has been
    // lifted and the next visible segment has to start with a `moveTo`.
    let penAt = -1;
    const segment = (ax: number, ay: number, bx: number, by: number, ai: number, bi: number) => {
      if ((ax < x0 && bx < x0) || (ax > x1 && bx > x1)) {
        penAt = -1;
        return;
      }
      if (ax > front) {
        penAt = -1;
        return;
      }
      if (bx > front) {
        const d = bx - ax;
        const k = Math.abs(d) > 1e-9 ? (front - ax) / d : 0;
        bx = front;
        by = ay + (by - ay) * k;
        // -2 lifts the pen: the next segment cannot continue from a point that
        // was interpolated rather than reached.
        bi = -2;
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
    /**
     * A floor under every width below, in drawn pixels.
     *
     * `1.7 * lw` world units is `1.7 * sqrt(scale)` on screen, which is under
     * one device pixel for every scale below 0.346 — and the closing tableau
     * runs between 0.005 and 0.011, so the branches were being stroked at a
     * fifth of a pixel and landing on nothing. That is the whole reason a wide
     * shot showed a bare main line: the main line has carried this floor since
     * `f9d2843` and nothing else did. See `MIN_STROKE_PX`.
     */
    const px = this.worldPerPixel();
    const floor = MIN_STROKE_PX * px;
    if (e.kind === 'unknown') {
      ctx.setLineDash([6, 7]);
      ctx.strokeStyle = rgba(PALETTE.fog, 0.55);
      ctx.lineWidth = Math.max(1.4 * lw, floor);
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    if (e.kind === 'aggregate') {
      // Before the early return: a counted run of commits on main is main, and
      // this pass draws it rather than handing it to the deferred spine stroke.
      if (spine) this.noteSpineInk(e.pts, 1);
      const count = this.aggregateByNode[e.child]?.memberCount ?? 0;
      const width = Math.min(16, 5 + Math.log2(1 + count) * 1.6);
      ctx.strokeStyle = rgba(spine ? ivory : slate, alpha * 0.28);
      // The ribbon's body keeps its own floor of two pixels: it is the one
      // stroke that carries a *quantity* — how many commits are inside it —
      // and a ribbon thinned to the same hairline as a single-commit thread
      // stops saying anything at all.
      ctx.lineWidth = Math.max(width, 2 * px);
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      ctx.strokeStyle = rgba(spine ? ivory : slate, alpha * 0.75);
      ctx.lineWidth = Math.max(1.6, floor);
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      return;
    }
    if (spine) {
      this.keepSpine(e.pts, 1, alpha);
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
    ctx.lineWidth = Math.max(e.kind === 'secondary' ? 1.1 : 1.7, floor);
    this.drawPolyline(ctx, e.pts);
    ctx.stroke();
  }

  /** How much of an edge's path has been travelled; see `travelEase`. */
  private travelU(e: EdgeGeom, t: number): number {
    const f = (t - e.start) / Math.max(1e-6, e.end - e.start);
    return travelEase(e.kind, f, this.settings.reducedMotion);
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
    // Floored in drawn pixels, like the settled widths above and the spine's
    // own. A travelling thread is the thing a viewer is most likely to be
    // watching, so it is the last thing that should thin to nothing when the
    // camera pulls back — which is exactly what it did.
    const width = Math.max(e.kind === 'aggregate' ? 8 : spine ? 2.8 : e.kind === 'secondary' ? 1.2 : 1.9, MIN_STROKE_PX * this.worldPerPixel());
    // revealed structural path
    if (spine) {
      this.keepSpine(e.pts, u, 0.95 * dim);
    } else {
      ctx.strokeStyle = rgba(structural, 0.85 * dim);
      ctx.lineWidth = width;
      this.drawPolyline(ctx, e.pts, u);
      ctx.stroke();
    }
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
        grad.addColorStop(1, rgba(color, 0.55 * dim * this.energy));
        ctx.strokeStyle = grad;
      } else {
        ctx.strokeStyle = rgba(color, 0.34 * dim * this.energy);
      }
      ctx.lineWidth = width + 1.5;
      this.drawPartial(ctx, e.pts, from, u);
      ctx.stroke();
      ctx.restore();
      // The glow layer gets the same stroke a second time. One copy of the
      // light is enough when the stage is full of it.
      if (glow && this.edgeDetail >= 0.5) {
        glow.strokeStyle = rgba(color, 0.5 * dim * this.energy);
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
    const focused = this.inFocus(nd, focusIdx);
    const dim = focused ? 1 : 0.3;
    const selected = this.settings.selectedNode === nd.idx || this.settings.hoverNode === nd.idx;
    const threadSel = this.settings.selectedThread != null && nd.threadIdx === this.settings.selectedThread;
    const structural = nd.isSpine ? ivory : threadSel ? PALETTE.accent : slate;
    const baseR = nd.isMerge ? 5.2 * Math.min(2.1, volumeScale(nd.mergeVolume)) : nd.isSpine ? 4.1 : 3.2;
    // A merge that absorbed a great deal is drawn big, which is the point of
    // the scale — on a stage. Behind the form the same rule produces one
    // object several times the size of everything else, and the eye goes to it
    // instead of to the sentence it is sitting beside.
    /**
     * With a floor in drawn pixels, for the same reason as the strokes.
     *
     * `baseR` is 3.2 world units for an ordinary commit. At the closing
     * tableau's scale that was 0.04 of a device pixel on mdBook and 0.02 on
     * public-apis — measured, with 1,220 and 2,403 nodes in frame respectively
     * and 0.17% of the frame lit. Every commit was being drawn and none of
     * them was landing on a pixel, which is what "no nodes" was.
     *
     * The rings hung off this radius (`r + 2.6` for a merge, `r + 7` for a
     * tag) grow with it, so a merge stays a ring rather than becoming a disc.
     * The floor is under `pop`, so the arrival bounce still reads.
     */
    const px = this.worldPerPixel();
    const lwFloor = MIN_STROKE_PX * px;
    const rFloor = MIN_NODE_PX * px;
    // The floor inside the shop window's cap, not outside it: that cap exists
    // so one heavy merge does not become the largest object behind a sign-in
    // form, and a floor applied after it could override it. It never does at
    // the landing's own framing — the scale there is near one, so the floor is
    // 1.4 world units against a cap of 7 — but the order is the intent.
    const r = Math.min(this.shopWindow ? 7 : Infinity, Math.max(rFloor, baseR * pop * (1 + nd.salience * 0.5)));

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
      ctx.lineWidth = Math.max(1.5, lwFloor);
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
      ctx.lineWidth = Math.max(1.3, lwFloor);
      ctx.stroke();
      if (nd.parentCount > 2 && !this.shopWindow) {
        ctx.beginPath();
        ctx.arc(x, y, r + 5.2, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(structural, 0.5 * dim);
        ctx.lineWidth = Math.max(1, lwFloor);
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
      // `focusIdx >= 0 &&`, because `inFocus` answers true when nothing is
      // focused — it is asking "should this be drawn at full strength", and
      // with no focus everything should. This site is asking the narrower
      // question "is this the focused contributor's", and reading the wider
      // answer here would have lit every cap on the stage at 0.9 instead of
      // 0.38 whenever no contributor was selected, which is most of the time.
      ctx.strokeStyle = rgba(color, (focusIdx >= 0 && this.inFocus(nd, focusIdx) ? 0.9 : 0.38) * dim);
      ctx.lineWidth = Math.max(1, lwFloor);
      ctx.stroke();
    }
    if (nd.tagLabels.length && !this.shopWindow) {
      ctx.beginPath();
      ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(ivory, 0.55 * dim);
      ctx.lineWidth = Math.max(1, lwFloor);
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
      /**
       * A ring around the marker, and *not* around where it is going.
       *
       * This drew at `pointAt(e.pts, 1)` — the arrival node — from `f = 0`,
       * so for the whole flight there was a lit ring on a commit that had not
       * happened. Measured on the shipped demo: 749 world units past the
       * playhead, 8.7 seconds of a 45-second show; 1,192 units on
       * `12-merge-storm`. It went through neither `drawPolyline` nor the node
       * guard, so nothing added in `48a24bb` or `5a24f91` touched it.
       *
       * Three things I asserted today were wrong because of it: that "the
       * rightmost ink is the present", which was the argument for switching
       * the NOW rule off; that the only lit things past the rule were the
       * word NOW and MASTER's plate; and the note in `reveal.test.ts` that
       * reduced motion "was the only one drawing the truth". It was the only
       * mode drawing the *easing* truthfully. It was also the only mode
       * drawing a commit before it existed — in the accessibility path, which
       * is the worst place to have it and the one neither new test covers.
       *
       * Drawn at `pos` now, which is where the glyph on the next line already
       * is, so this adds no motion that was not already there: the marker
       * moves in this mode regardless, and `pos` is bounded by the playhead.
       * What reduced motion removes is the comet, the trail and the shake, not
       * the fact that something is travelling.
       */
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, size + 3, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(color, (0.3 + 0.5 * f) * dim);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      this.drawGlyph(ctx, glyph, pos.x, pos.y, size * 0.8, heading);
      ctx.fillStyle = rgba(color, 0.9 * dim);
      ctx.fill();
      return;
    }

    // comet trail: earlier positions along the exact path
    const trailFull = this.quality === 'full' ? (isPerformer ? 11 : 6) : 5;
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

  /**
   * The world x the playhead is at, derived rather than assumed.
   *
   * `x = naturalTime * X_PER_SECOND` and `naturalTime = (impact - HEAD) / scale`,
   * so x is *affine* in impact — which means any two nodes determine the
   * mapping and no constant from the compiler needs to be repeated here. Two
   * nodes far apart in impact give the best conditioning, so the first and the
   * last are used.
   *
   * Worth deriving rather than importing: `X_PER_SECOND` and the clock's scale
   * live in the compiler, they are already baked into the geometry, and a
   * second copy of them here would be a second thing to keep in step.
   */
  private xAtTime(t: number): number | null {
    const p = this.perf;
    const n = this.nodesByX.length;
    if (!p || n < 2) return null;
    const a = p.nodes[this.nodesByX[0]!]!;
    const b = p.nodes[this.nodesByX[n - 1]!]!;
    const di = b.impact - a.impact;
    if (!(Math.abs(di) > 1e-9)) return null;
    return a.x + ((t - a.impact) * (b.x - a.x)) / di;
  }

  /**
   * A rule at the present, and main's line carried up to it.
   *
   * Two halves of one answer to a viewer's question — "it's confusing seeing
   * strings go in the future so it's hard to understand what the present is".
   *
   * Nothing is ever drawn in the future: the node pass refuses anything with
   * `impact > t`, so the rightmost ink *is* the present. But nothing said so.
   * The stage's only moving mark was `sweepX`, a light that travels repeatedly
   * over already-drawn history, and the date and the scrubber are both in the
   * chrome. So a viewer hunting for "now" found one labelled thing near the
   * right of the frame — MASTER's plate — and read everything past it as the
   * future.
   *
   * What is past it is real and is not the future. The camera keeps main's head
   * between three fifths and seven tenths of the way across (see the head band
   * below), so during playback the third of the frame between main's plate and
   * the playhead holds committed work that has not been merged yet. Measured on
   * whole plans: up to 3,137 such commits on VS Code, 383 on React, and *every
   * one of them* on a branch that eventually merges. Zero at the closing frame,
   * where main has absorbed everything.
   *
   * So: mark the present, and let main reach it. Main's ref exists
   * continuously — it simply has no commit at this moment — and a line that
   * stops at its newest commit implies it stopped existing. Carrying it forward
   * puts the in-flight work *beside* main instead of *beyond* it, which is what
   * the viewer asked for, without moving a single commit.
   *
   * The continuation must not read as commits. That is the trap `48ca9d7`
   * climbed out of: merges were drawn as S-curves that painted main's own path
   * ahead of where main had got to. Hence a dotted hairline at a third of the
   * line's weight, and no dots on it.
   */
  private drawPresent(ctx: CanvasRenderingContext2D, t: number) {
    const p = this.perf;
    if (!p || !this.settings.showPresent) return;
    const worldX = this.xAtTime(t);
    if (worldX == null) return;
    const s = this.settings.safe;
    const nowX = this.worldToScreen(worldX, 0).x;
    // Off the frame is the usual case on a long history mid-seek, and a rule
    // clamped to the edge would be a rule in the wrong place.
    if (nowX < s.left || nowX > this.width - s.right) {
      this.presentMarkAt = null;
      return;
    }

    const hc = this.settings.highContrast;
    const ivory = hc ? PALETTE.highContrast.ivory : PALETTE.ivory;
    ctx.save();

    // Main's line, carried from its drawn head to the present.
    const tip = this.spineTip(t);
    const tipScreen = tip ? this.worldToScreen(tip.x, tip.y) : null;
    this.presentMarkAt = { nowX, tipX: tipScreen ? tipScreen.x : NaN, tipY: tipScreen ? tipScreen.y : NaN };
    if (tip) {
      const from = this.worldToScreen(tip.x, tip.y);
      if (nowX - from.x > 2) {
        ctx.beginPath();
        ctx.setLineDash([2, 5]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(ivory, hc ? 0.5 : 0.3);
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(nowX, from.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // The rule itself, and its one word.
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(ivory, hc ? 0.34 : 0.16);
    ctx.moveTo(nowX, s.top);
    ctx.lineTo(nowX, this.height - s.bottom);
    ctx.stroke();

    // "NOW" and not the date. The date is already on the hero directly below
    // and describes this same moment, so a second copy of it would be two
    // dates on one screen — the shape of a defect this app has had once, when
    // the readout was fourteen years out because it silently described the
    // camera instead of the clock.
    ctx.font = '600 8.5px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = nowX > this.width - s.right - 40 ? 'right' : 'left';
    ctx.fillStyle = rgba(ivory, hc ? 0.7 : 0.42);
    const pad = ctx.textAlign === 'right' ? -5 : 5;
    ctx.fillText('NOW', nowX + pad, s.top + 4);
    ctx.restore();
  }

  private drawLabels(ctx: CanvasRenderingContext2D, t: number) {
    const p = this.perf!;
    const labels = this.settings.labels;
    ctx.font = '500 11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    const drawn: Array<{ x: number; y: number; w: number; text: string }> = [];
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
      // Inside the safe rectangle, with no slack.
      //
      // This used to allow ten pixels either side of it, which was ten pixels
      // of caption on the page's own chrome — and the merge captions are placed
      // at `s.y + 16`, so a commit sixteen pixels above the boundary put its
      // "338 commits converge" squarely into the reserved band. There is
      // nothing the slack bought: a label that does not fit inside the stage is
      // a label on the furniture.
      if (x < 0 || x > this.width || y < this.settings.safe.top || y > this.height - this.settings.safe.bottom) return;
      const w = ctx.measureText(text).width + 10;
      if (x + w > this.width) return;
      for (const d of drawn) if (Math.abs(d.y - y) < 14 && x < d.x + d.w && x + w > d.x) return;
      /**
       * The same words twice in the same corner of the frame.
       *
       * Not rejected here, deliberately. The overlap test above is about
       * *space* and this would be about *meaning*, and there are captions this
       * app draws many times over legitimately — "3 commits" belongs to every
       * ribbon on the stage, and two ribbons on neighbouring lanes 40 px apart
       * are two separate true statements. Suppressing by text would delete one
       * of them. So this counts, and the passes that can produce a genuine
       * duplicate fix it at the source, where the reason is known.
       */
      if (renderProfile.enabled) {
        for (const d of drawn) if (d.text === text && Math.abs(d.y - y) < 40 && Math.abs(d.x - x) < 80) { renderProfile.counts.stackedLabels++; break; }
      }
      drawn.push({ x, y, w, text });
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
        const label = th.label ?? th.id.replace('thread-', 'thread ');
        /**
         * Two refs, one commit, one label.
         *
         * A viewer on mdBook: "I caught `v0.0.19` drawn twice, stacked." The
         * data is innocent — the artifact holds exactly one ref named
         * `v0.0.19`, on exactly one commit (`cba988f0`), and the compiled plan
         * has exactly one node carrying it (node 153, the only tagged node in
         * the whole plan whose label repeats anywhere). What is doubled is the
         * drawing: thread 104 is a one-commit branch *named* `v0.0.19`, its
         * only node is 153, and 153 is also tagged `v0.0.19`. So the thread
         * pass writes the name at `s.y + side * 13` and the tag pass writes the
         * same seven characters at `s.y - 14`. `place()` throws away an overlap
         * within 14 px of a row, and the two land 27 px apart when `side` is
         * +1 — which it is, because the node sits at y 113.19, above the spine.
         *
         * So it is one commit with two kinds of ref pointing at it, and the
         * honest drawing is to say the name once. The tag keeps it: it is a
         * statement about the commit under the label, it carries the dashed
         * ring already drawn on that commit, and it joins with any other tags
         * on the same commit — whereas the thread name describes a line that
         * has already merged and no longer exists.
         *
         * Conditioned on the tag pass actually being able to draw it, so this
         * suppresses a duplicate and never a lone label. That pass walks
         * backwards from the newest landed tagged node and stops at the first
         * faded one; age rises monotonically as it walks, so "it reaches this
         * node" is exactly "this node's tag alpha is above zero", which is what
         * is tested here.
         */
        const tagStillShows = labels === 'all' || t - latest.impact < 5.5;
        if (tagStillShows && latest.tagLabels.includes(label)) continue;
        candidates.push({ th, latest, alpha, label });
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
    /**
     * The nameplate introduces the main line and then gets out of the way.
     *
     * It used to be on for the whole performance, which on Kubernetes is four
     * and a half hours of a label that says the same word. Its job is done in
     * the first few seconds: name the line, so the ivory stroke is not just
     * the brightest one. After that it is furniture, and it is furniture in the
     * busiest part of the frame — it rides 50 px right of the head, which is
     * inside the head band the camera holds main's newest commit in.
     *
     * Held solid for `PLATE_HOLD` seconds from the moment the spine's first
     * commit lands, then faded over `PLATE_FADE`. Measured from the plan rather
     * than from wall-clock time so it is the same on every machine and at every
     * playback rate, and so seeking back to the opening shows it again — a
     * viewer who wants to be reminded which line is main can scrub to the start
     * and read it, which is cheaper than leaving it on for hours.
     *
     * The switch in Settings still hides it outright. This changes how long it
     * stays, not whether the viewer gets a say.
     */
    const PLATE_HOLD = 4;
    const PLATE_FADE = 1.2;
    /**
     * It goes quiet. It does not go away.
     *
     * The fade was to zero, and the arithmetic above it is measured from the
     * spine's *first* commit — so the one label that says which line is main is
     * on screen for 5.2 seconds of a 163-second show on mdBook and 5.2 seconds
     * of a twelve-hour one on Linux, which is 0.012%. Worse, those 5.2 seconds
     * are the opening, when there is exactly one line on the stage and nothing
     * for the name to distinguish it *from*. It earns its keep later, when
     * there are twenty lines and a viewer is being asked to read everything
     * relative to the ivory one — and by then it has been gone for hours. Two
     * of this viewer's five reports are about mistaking something else for main
     * or for the present.
     *
     * **Floor removed, on the owner's instruction, twice given.** The ask was
     * "make the MASTER tag appear for 3-5 seconds then fade out", and a floor
     * of 0.3 is not fading out. The argument for keeping a dim marker was that
     * the opening five seconds are when there is one line on the stage and
     * nothing to distinguish it from -- true, and answered by the hold rather
     * than by never leaving. The key on the stage now names the main line in
     * its own right, so the plate is no longer the only thing that does.
     *
     * Zero, and the block below is skipped entirely once it reaches it, so no
     * alpha is spent on an invisible pill for the rest of the show.
     */
    const PLATE_FLOOR = 0;
    const plateAge = spineBegun ? t - p.nodes[spine!.nodeIdxs[0]!]!.impact : 0;
    const plateFade = plateAge <= PLATE_HOLD ? 1 : Math.max(PLATE_FLOOR, 1 - (plateAge - PLATE_HOLD) / PLATE_FADE);
    // Per frame, not per load: `spineLabel` exists so a test can read where the
    // plate was *drawn*, and now that it fades there are frames where it was
    // not. Reset here or it reports the last place it was seen forever, which
    // is the same staleness `presentMark` was pulled up on.
    this.mainLabelAt = null;
    if (spine && spine.label && spineBegun && plateFade > 0.01 && labels !== 'minimal' && this.settings.showSpineLabel) {
      const text = spine.label.toUpperCase();
      ctx.save();
      // Every alpha in the block below is relative to this, so the plate fades
      // as one object rather than as a pill, a border and some letters.
      ctx.globalAlpha = plateFade;
      ctx.font = '600 9.5px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(text).width;
      // Tracking has to be added by hand; canvas has no letter-spacing.
      const track = 1.4;
      const padX = 7;
      const boxW = w + track * (text.length - 1) + padX * 2;
      // The end of the ink, measured while the ink was laid down.
      //
      // This was `spineTip`, which is what the camera composes around, on the
      // reasoning that the plate must not disagree with the shot it stands in.
      // The reasoning is sound and the quantity was wrong: `spineTip`
      // interpolates on *commit impacts* and the stroke is revealed on *edge*
      // times, which on a spine built from ribbons are not the same clock. See
      // `keepSpine` for the thirteen frames that settle it — the plate stood
      // 26 to 132 px clear of the line while being drawn at 50.
      //
      // `spineDrawnX` is set by the pass that draws the line, so it cannot
      // drift from it. Its height still comes from the tip: the spine is
      // horizontal, so the two agree to a pixel, and the tip is the one that
      // knows which commit's height to use.
      const onLine = this.spineTip(t) ?? p.nodes[spine.nodeIdxs[0]!]!;
      const head = this.worldToScreen(Number.isFinite(this.spineDrawnX) ? Math.min(this.spineDrawnX, onLine.x) : onLine.x, onLine.y);
      // Its height is read off that commit, not from `spineY`: that returns a
      // constant 0 and describes the layout's intent — "the primary spine is a
      // perfectly straight horizontal axis" — rather than the geometry the
      // compiler emits, and measured on Kubernetes the two were a flat 374px
      // apart at every depth in the performance.
      const lineY = head.y;
      // Twice what it was. At 25 the plate read as attached to the line —
      // close enough to be part of the stroke rather than a label on it.
      //
      // Down from 50, now that it is measured from the ink instead of from a
      // tip that ran ahead of it. 50 was chosen against an anchor that was
      // already 0 to 82 px past the end of the line, so what a viewer saw was
      // 50 plus that, and closing the anchor without closing the gap would
      // have left it reading as a label on nothing. 30 puts the pill clear of
      // the arriving body's glow — which reaches about 12 px past the stroke —
      // and no further.
      const GAP = 30;
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
      drawn.push({ x: x - 4, y, w: boxW + 8, text });
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
        // "at least", when the volume is the ancestry budget rather than a
        // count — see `model/volume.ts`. The chrome caption has said this
        // since the cap was found; this label, which is the one that can
        // appear ten times in a single frame, was still stating it as exact.
        const v = nd.mergeVolume;
        place(s.x + 12, s.y + 16, volumePhrase(v, volumeIsCapped(v, this.mergeCount)), alpha, PALETTE.merge);
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
