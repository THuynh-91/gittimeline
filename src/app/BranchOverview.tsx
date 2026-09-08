import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { branchActivityOf, BranchActivityIndex, groupBranches } from '@/model/branchOverview';
import type { BranchActivity } from '@/model/types';
import { loadBranchOverview } from '@/export/branchOverview';
import { getRenderer, pause, player, seek, selectNode, selectThread } from './controller';
import { store } from './store';
import './branchOverview.css';

/**
 * Where the playhead sits across the plot, as a fraction of its width.
 *
 * Every active thread's head is at the playhead by construction — its activity
 * interval contains now — so this one number decides the whole composition:
 * how much room the tails get to the left, and how much empty stage is left to
 * the right saying that nothing after now is drawn. 0.78 was chosen by eye
 * against Linux's 600-thread peak; the empty margin is a statement, not waste.
 *
 * It is duplicated as a CSS custom property, because the two overlays that
 * light the frontier and fade the past have to know where it is.
 */
const FRONTIER = 0.78;
/**
 * A dark channel either side of the spine, in pixels.
 *
 * MASTER has to stay prominent — it is the only thing in this view a viewer can
 * orient by — and at 600 threads lane spacing near the spine is under two
 * pixels, so the first lane out would otherwise sit on top of it. Twelve is
 * enough for the label to live in the channel rather than in the field.
 */
const SPINE_GAP = 12;
/** Faintest a far lane may get. `canvas.ts`'s `laneFade` uses 0.17 for 240 lanes; this view draws 600. */
const DEPTH_FLOOR = 0.14;
/** Lanes this close to the spine keep their full weight, as in `laneFade`. */
const DEPTH_NEAR = 5;
/**
 * Depth is quantised so that 600 filaments cost twelve `stroke()` calls rather
 * than 600 — six depth steps, each split above and below the spine.
 *
 * Not a micro-optimisation; it is what pays for the curvature. Measured
 * unthrottled in `x/bench/`, which replays the 600 real active rows from
 * Linux's peak through this same drawing:
 *
 *   flat colour, every line width <= 1 ................  7.0 ms
 *   flat colour, widths 0.6-1.4 ...................... 12.5 ms
 *   one CanvasGradient per bucket as `strokeStyle` .... 61.0 ms
 *   flat colour + one destination-in alpha ramp ....... 17.5 ms
 *   flat colour + one source-over scrim ............... 11.7 ms
 *   filaments only, batched .......................... 5.9 ms
 *   filaments only, one stroke each .................. 8.5 ms
 *
 * Three findings ran the design, and the expected one came last. Skia has a
 * fast hairline path for stroke widths at or below one device pixel and a slow
 * geometry-expanding path above it, so *every* width in this file stays under
 * 1 and depth is carried by alpha instead — that is the 12.5 against 7.0, and
 * it is the largest single lever here. A gradient `strokeStyle` over a path
 * with hundreds of subpaths is catastrophic, nine times a flat colour, so the
 * head-to-tail falloff is not painted at all: it comes from filament
 * *density*, which genuinely thins towards the past, plus two CSS overlays
 * that cost nothing per frame (see `branchOverview.css`). Batching itself is
 * the smallest of the three at 1.4x, and it is the reason the whole drawing
 * ends up *cheaper* than the straight-line version it replaced at 284 and 350
 * lines, where the old code issued one fractional-width stroke per line.
 */
const DEPTH_BUCKETS = 6;
/**
 * Lens strengths for the vertical control, weakest first. See `lens`.
 *
 * Three named steps rather than a slider: a slider is a data-panel affordance
 * and there is no value here to read off one.
 */
const SPREADS = [0.4, 1.9, 3.6];
const SPREAD_NAMES = ['Tight', 'Open', 'Wide'];
/** How long a thread stays lit after its first commit, in performance seconds. */
const FLARE_SECONDS = 8;
/** Vertical room given up so the outermost lane's wander still fits inside the plot. */
const WANDER_MAX = 13;
const CURTAIN = 15;
/** Zoom factor for one button press or one wheel notch. */
const ZOOM_STEP = 1.32;
/** History visible to the left of the playhead may not collapse below this, in seconds. */
const MIN_PAST_SECONDS = 8;

/**
 * Lane index to distance from the spine, as a fraction of the half height.
 *
 * A normalised `1 - e^(-a·u)`, so the first lanes out are spread far apart and
 * the far field compresses into atmosphere. `a` is the only vertical control
 * this view has, and it is deliberately a *lens* rather than a zoom: a lens
 * always maps every lane onto the height available, so no counted thread can
 * be pushed out of frame. A vertical zoom with a pan would be closer to the
 * graph's camera and would let this view hide lines the header is still
 * promising, which is invariant 1 — the count equals the lines drawn.
 *
 * At a = 1.9 with 300 lanes a side in the 230 px this leaves them, the
 * innermost lanes sit 1.71 px apart and the outermost 0.26 px. Both numbers
 * are the point.
 */
export function lens(u: number, a: number): number {
  if (a < 1e-3) return u;
  return (1 - Math.exp(-a * u)) / (1 - Math.exp(-a));
}

/**
 * How much of its colour a lane keeps, by distance from the spine.
 *
 * The same argument as `laneFade` in `canvas.ts`, for the same reason: 600
 * lines of equal weight all shout, and the structure a viewer follows is the
 * spine and the threads nearest it. Lanes inside `DEPTH_NEAR` are untouched,
 * so a history with four branches is not dimmed for no reason.
 */
export function depthOf(lane: number, maxLane: number): number {
  if (maxLane <= DEPTH_NEAR) return 1;
  const u = Math.max(0, lane - DEPTH_NEAR) / (maxLane - DEPTH_NEAR);
  return Math.pow(1 - u, 1.5);
}

/**
 * Base opacity for one filament, from how many there are.
 *
 * Six hundred filaments overlapping at sub-pixel spacing accumulate: at the
 * flat 0.58 the first version used, Linux's peak was a solid olive block with
 * no internal structure at all. This curve keeps a four-branch history bright
 * and lets a six-hundred-branch one build its tone out of overlap rather than
 * out of ink.
 */
export function crowdAlpha(count: number): number {
  return Math.max(0.2, Math.min(0.8, 4 / (1 + count / 110)));
}

/**
 * Cool above the spine, warm olive below, both washing out to a neutral far
 * grey with depth.
 *
 * The same encoding `threadTint` uses in the renderer — "threads above the
 * spine drift cool, below drift warm" — so this view is recognisably the same
 * app rather than a chart of the same data. `dr` is 1 at the spine and 0 at
 * the far edge.
 *
 * A per-thread hue by contributor was the first idea and is not possible: the
 * packed record is `{ id, label, start, end }` and contributors are not in it.
 * A ramp by age was the second, tried and dropped — rows arrive ordered by
 * start and lanes are handed out in that order, so age *is* depth here, and
 * ramping on it twice only muddied the mirror.
 */
export function laneTint(side: number, dr: number): [number, number, number] {
  const near = side < 0 ? [126, 170, 186] : [176, 190, 122];
  const u = 1 - Math.max(0, Math.min(1, dr));
  return [
    Math.round(near[0]! + (96 - near[0]!) * u),
    Math.round(near[1]! + (112 - near[1]!) * u),
    Math.round(near[2]! + (124 - near[2]!) * u),
  ];
}

/**
 * How much history to frame, from the tails that are actually on stage.
 *
 * Measured, and the reason the camera is not decoration here: at Linux's peak
 * the 600 active tails have a median length of 254 s and an 85th percentile of
 * 301 s, inside a 43,200 s performance. Framed to the whole duration all six
 * hundred collapse into six pixels. Framing to a little over the 85th
 * percentile puts most of the field on stage and lets the oldest few run off
 * the left edge, which is the honest thing for them to do.
 *
 * `sorted` must be ascending; only a quantile is read out of it.
 */
export function frameSpan(sorted: ArrayLike<number>, count: number): number {
  if (count <= 0) return MIN_PAST_SECONDS * 2;
  const p85 = sorted[Math.min(count - 1, Math.floor(count * 0.85))] ?? 60;
  return Math.max(MIN_PAST_SECONDS * 2, p85 * 1.3 + 6);
}

/** Stable per-thread wander phase. FNV-1a, so two ids never share a wave by accident. */
function phaseOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

/**
 * Lane to pixels from the spine, for every lane in one frame.
 *
 * Tabulated because the wander amplitude needs local spacing, which is a
 * difference between neighbours: per filament that would be two `Math.exp`
 * calls six hundred times instead of one three hundred times.
 */
let laneCache = new Float64Array(0);
function laneOffsets(maxLane: number, a: number, halfH: number, slack: number): Float64Array {
  if (laneCache.length < maxLane + 2) laneCache = new Float64Array(Math.max(1024, (maxLane + 2) * 2));
  // The room the lanes may use is the half height less everything the wander
  // can add to the outermost one. Clamping y instead piled the extreme lanes
  // onto the top and bottom edges of the plot and produced two bright squares
  // at the frontier — visible in the first round's screenshots.
  const room = Math.max(4, halfH - slack);
  for (let lane = 0; lane <= maxLane; lane++) laneCache[lane] = lens(lane / maxLane, a) * room;
  return laneCache;
}

interface Camera {
  /** Seconds of history visible to the left of the playhead. */
  past: number;
  /** Playhead position across the plot, as a fraction. Dragging moves this. */
  frontier: number;
  /** Index into `SPREADS`. */
  spread: number;
  /** Set once the viewer touches the camera; stops the auto-framing. */
  manual: boolean;
  /** False until the first frame, which is the only one allowed to jump. */
  ready: boolean;
}

const FIT: Camera = { past: 60, frontier: FRONTIER, spread: 1, manual: false, ready: false };

export function BranchOverview() {
  const perf = store.perf.value;
  const open = store.branchOverviewOpen.value;
  const canvas = useRef<HTMLCanvasElement>(null);
  const painted = useRef<{ groups: BranchActivity[][]; ys: Float32Array }>({ groups: [], ys: new Float32Array(0) });
  const camera = useRef<Camera>({ ...FIT });
  const drag = useRef<{ x: number; from: number; moved: number } | null>(null);
  const shownSpan = useRef('');
  const shownFrontier = useRef('');
  // Every per-frame buffer lives here and is grown, never reallocated: this
  // loop runs sixty times a second over six hundred rows, and the old version's
  // per-frame garbage was already the largest thing in a profile.
  const scratch = useRef({
    last: 0,
    tails: new Float64Array(0),
    sorted: new Float64Array(0),
    yBase: new Float32Array(0),
    amp: new Float32Array(0),
    curtain: new Float32Array(0),
    phase: new Float32Array(0),
    freq: new Float32Array(0),
    x0: new Float32Array(0),
    headY: new Float32Array(0),
    bins: Array.from({ length: DEPTH_BUCKETS * 2 }, () => [] as number[]),
    selected: [] as number[],
    sparks: [] as number[],
    phases: new Map<string, number>(),
    wave: new Float32Array(0),
  });
  const [choices, setChoices] = useState<BranchActivity[]>([]);
  const [chosen, setChosen] = useState('');
  const [pending, setPending] = useState<BranchActivity | null>(null);
  const [error, setError] = useState('');
  const [size, setSize] = useState({ width: 800, height: 400 });
  const [downloaded, setDownloaded] = useState<{ hash: string; rows: BranchActivity[] } | null>(null);
  // Mirrors of the camera so the footer can label its own buttons. The camera
  // itself stays in a ref: it changes every frame and must not re-render.
  const [spread, setSpread] = useState(FIT.spread);
  const [spanLabel, setSpanLabel] = useState('');
  // Reduced motion stops the animation loop, so a camera change has nothing to
  // repaint it. This is the one bit of state the camera keeps in React: without
  // it the zoom buttons are dead for exactly the viewers least able to tell
  // that they are supposed to do something.
  const [nudge, setNudge] = useState(0);
  const repaintIfStill = () => { if (store.settings.peek().reducedMotion) setNudge(v => v + 1); };
  const manifest = store.catalogManifest.value;
  const ready = !perf?.window || !!perf.branchOverview || downloaded?.hash === perf.planHash;
  const rows = useMemo(() => downloaded?.hash === perf?.planHash ? downloaded!.rows : perf ? branchActivityOf(perf) : [], [downloaded, perf?.branchOverview, perf?.planHash, !!perf?.window]);
  const index = useMemo(() => new BranchActivityIndex(rows), [rows]);
  const t = store.time.value;
  const active = useMemo(() => index.at(t), [index, t]);
  // Dense desktop lines need no labels. When grouping, reserve a full text
  // row: hundreds of two-branch labels would be less readable than the lines.
  const compact = size.width < 600 || size.height < 240 || active.length > 1024;
  const capacity = compact ? Math.max(1, Math.floor((size.height - 52) / 22)) : 1024;
  const groups = groupBranches(active, capacity);
  const grouped = groups.some(group => group.length > 1);
  const buffering = store.buffering.value;
  /**
   * When a change of playhead has to restart the drawing effect.
   *
   * Only when the animation loop is not running. `store.time` ticks fifteen
   * times a second, and having it in the effect's dependencies tore the loop
   * down and re-entered `draw` fifteen extra times a second on top of the
   * sixty it was already doing — measured as one frame in a hundred taking two
   * vsync intervals at Kubernetes' peak. With reduced motion the loop stops
   * after each frame, so there the playhead is the only thing that can ask for
   * a repaint and it has to stay.
   */
  const seekRedraw = store.settings.value.reducedMotion ? t : 0;

  useEffect(() => { setChoices([]); setChosen(''); setPending(null); setError(''); store.branchOverviewOpen.value = false; }, [perf?.planHash]);
  useEffect(() => {
    if (!open || ready || !manifest?.overview || !perf?.window) return;
    const abort = new AbortController();
    const hash = perf.planHash;
    setError('');
    void loadBranchOverview(perf.window.manifestUrl, manifest.overview, abort.signal)
      .then(rows => { if (!abort.signal.aborted) setDownloaded({ hash, rows }); })
      .catch(error => { if (!abort.signal.aborted) setError(String(error instanceof Error ? error.message : error)); });
    return () => abort.abort();
  }, [open, ready, manifest?.overview, perf?.planHash, perf?.window?.manifestUrl]);
  useEffect(() => {
    if (!open || !canvas.current) return;
    // Opening is the one moment the camera moves on its own initiative; see
    // the `ready` branch in `draw`.
    camera.current = { ...FIT };
    setSpread(FIT.spread);
    const el = canvas.current;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!pending || !perf || buffering || Math.abs(t - pending.end) > 0.1) return;
    const thread = perf.threads.find(th => th.id === pending.id);
    if (!thread?.nodeIdxs.length) return;
    const node = perf.nodes[thread.nodeIdxs.at(-1)!];
    if (!node) return;
    selectThread(thread.idx);
    selectNode(node.idx);
    const renderer = getRenderer();
    if (renderer) {
      renderer.manual = { x: node.x, y: node.y, scale: Math.max(0.5, renderer.viewport().scale) };
      store.manualCamera.value = true;
    }
    store.branchOverviewOpen.value = false;
    setPending(null);
  }, [pending, perf, buffering, t]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => { setPending(null); setError('This branch could not be opened. Try again when the history finishes loading.'); }, 20000);
    return () => clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (!open || !canvas.current) return;
    const el = canvas.current, ctx = el.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    // Only when it has actually changed. Assigning `width` resets the backing
    // store even to the same value, and this effect re-runs fifteen times a
    // second because `store.time` does — so the old code was reallocating and
    // clearing a 3072x1888 buffer fifteen times a second for nothing. Every
    // context property this draw depends on is set inside `draw`, so there is
    // nothing to lose by not resetting it.
    const wantW = Math.round(size.width * dpr), wantH = Math.round(size.height * dpr);
    if (el.width !== wantW) el.width = wantW;
    if (el.height !== wantH) el.height = wantH;
    const width = size.width, height = size.height;
    const s = scratch.current;
    let frame = 0;
    let tints: string[] = [];
    let tintKey = '';

    const draw = (stamp: number) => {
      const settings = store.settings.peek();
      const motion = !settings.reducedMotion;
      const dt = Math.min(0.12, Math.max(0, (stamp - s.last) / 1000));
      s.last = stamp;
      const clock = motion ? stamp / 1000 : 0;
      const now = player.t;
      const cam = camera.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      // Butt caps, round joins. A round cap on a hairline renders as a blob
      // noticeably brighter and taller than the line it ends, and since every
      // filament is clipped at the same left edge those blobs lined up into a
      // column of dots down the far past — visible magnified in
      // `x/ovshots/v4-*`. Joins stay round so the wander bends smoothly.
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';

      const padL = grouped ? 96 : 10, padR = 12, padV = 8;
      const plotX = padL, plotW = Math.max(48, width - padL - padR);
      const plotY = padV, plotH = Math.max(36, height - padV * 2);
      const spineY = plotY + plotH / 2;
      const halfH = Math.max(4, plotH / 2 - SPINE_GAP);

      const batch = groupBranches(index.at(now), capacity);
      const n = batch.length;
      if (s.yBase.length < n) {
        const cap = Math.max(1024, n * 2);
        s.yBase = new Float32Array(cap); s.amp = new Float32Array(cap); s.curtain = new Float32Array(cap);
        s.phase = new Float32Array(cap); s.freq = new Float32Array(cap);
        s.x0 = new Float32Array(cap); s.headY = new Float32Array(cap);
        s.tails = new Float64Array(cap); s.sorted = new Float64Array(cap);
      }
      const maxLane = Math.max(1, Math.ceil(n / 2));

      // --- Camera ---
      // Every group is a contiguous slice of a list already sorted by start, so
      // its first member is its earliest. Scanned rather than assumed: the
      // ordering is `BranchActivityIndex`'s business, not this file's.
      for (let i = 0; i < n; i++) {
        const g = batch[i]!;
        let v = g[0]?.start ?? now;
        for (let k = 1; k < g.length; k++) if (g[k]!.start < v) v = g[k]!.start;
        s.tails[i] = Math.max(0, now - v);
      }
      if (!cam.manual && n > 0) {
        // Quantile off a copy, because `sort` would shuffle the row order that
        // `s.tails` is indexed by. Into a buffer that is grown and reused, not
        // a fresh `slice` a frame — that was 5 KB of garbage sixty times a
        // second for one percentile.
        s.sorted.set(s.tails.subarray(0, n));
        const sorted = s.sorted.subarray(0, n);
        sorted.sort();
        const target = Math.min(Math.max(MIN_PAST_SECONDS, player.duration || 1e9), frameSpan(sorted, n));
        if (!cam.ready) {
          // Open wide and settle in. This is the framing gesture the graph's
          // director has and this view did not, and it is the direct answer to
          // "we can't zoom out like we do" — the field visibly opens up.
          cam.past = motion ? target * 1.9 : target;
          cam.ready = true;
        }
        cam.past += (target - cam.past) * (motion ? 1 - Math.exp(-dt * 2.4) : 1);
      }
      cam.past = Math.max(MIN_PAST_SECONDS, cam.past);
      const frontierX = plotX + plotW * cam.frontier;
      const pxPerSec = Math.max(1e-6, (frontierX - plotX) / cam.past);
      // Grouped mode gets even spacing, not the lens, and a wander damped to a
      // fraction of the row pitch. `capacity` above budgets 22 px a row so a
      // label fits, and the dense field's wander is far larger than that:
      // measured on a 390 px phone it swung rows +/-28 px through a 17 px pitch
      // and two "27 branches" labels landed on top of each other.
      const pitch = halfH / maxLane;
      const wanderCap = grouped ? Math.max(0.8, pitch * 0.16) : WANDER_MAX;
      const curtainCap = grouped ? Math.max(0.8, pitch * 0.2) : CURTAIN;
      const laneOff = laneOffsets(maxLane, grouped ? 0 : (SPREADS[cam.spread] ?? SPREADS[1]!), halfH, wanderCap + curtainCap);

      // --- The sheet ---
      // One low-frequency wave over the plot width, tabulated. It depends only
      // on x, and sampling it saves one `Math.sin` in three at six thousand
      // points a frame; six pixels of quantisation is invisible on a wave four
      // hundred pixels long.
      const WAVE_PX = 6;
      const waveCount = Math.ceil(plotW / WAVE_PX) + 2;
      if (s.wave.length < waveCount) s.wave = new Float32Array(waveCount * 2);
      for (let k = 0; k < waveCount; k++) s.wave[k] = Math.sin((plotX + k * WAVE_PX) / 420 + clock * 0.33);
      const waveTop = waveCount - 1;

      /**
       * One filament, from its own first commit to the playhead.
       *
       * The whole visual argument of this view is in here, so the things it
       * deliberately does *not* do are worth naming:
       *
       * - It never touches the spine and never reaches another filament. The
       *   packed record is `{ id, label, start, end }` — no parent, no merge
       *   target — so a curve leaving MASTER would assert a branch point and a
       *   curve landing on it would assert a merge, and for a dormant thread
       *   the second is usually false. That is invariant 2, and a convergent
       *   fan was the best-looking option on the list before it was ruled out.
       * - It stops at the playhead, because the rest of the interval has not
       *   happened. That is invariant 3, and it is also why every active head
       *   lands on one vertical frontier.
       *
       * What it does do is wander. y in this view is row order and carries no
       * value at all — only x is time — which is what makes the curvature and
       * its animation free of any claim.
       */
      const filament = (i: number) => {
        const x0 = s.x0[i]!, yb = s.yBase[i]!, amp = s.amp[i]!, curtain = s.curtain[i]!, ph = s.phase[i]!, freq = s.freq[i]!;
        const len = frontierX - x0;
        // ~55 px a segment, capped at nine: beyond that the extra points are
        // invisible and they are the dominant cost at 600 filaments.
        const segs = len < 4 ? 1 : Math.max(1, Math.min(9, Math.round(len / 55)));
        let y = yb;
        for (let k = 0; k <= segs; k++) {
          const x = x0 + (len * k) / segs;
          const w = ((x - frontierX) / 130) * freq;
          const sheet = s.wave[Math.min(waveTop, Math.max(0, Math.round((x - plotX) / WAVE_PX)))]!;
          y = yb + Math.sin(ph + w + clock * 0.9) * amp + Math.sin(ph * 1.7 - w * 0.55 + clock * 0.55) * amp * 0.6 + sheet * curtain;
          if (y < plotY) y = plotY; else if (y > plotY + plotH) y = plotY + plotH;
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        s.headY[i] = y;
      };

      // --- Per-filament scalars, binned by depth and by side of the spine ---
      for (const bin of s.bins) bin.length = 0;
      s.selected.length = 0;
      s.sparks.length = 0;
      const base = crowdAlpha(n);
      for (let i = 0; i < n; i++) {
        const group = batch[i]!;
        const side = (i & 1) ? -1 : 1;
        const lane = (i >> 1) + 1;
        const spacing = Math.abs(laneOff[lane]! - laneOff[lane - 1]!);
        s.yBase[i] = spineY + side * (SPINE_GAP + laneOff[lane]!);
        // Tied to local lane spacing so the sparse core near the spine ripples
        // visibly while the sub-pixel far field only shimmers, but with a floor
        // — at 600 threads the outer spacing is 0.35 px and an amplitude that
        // small is no curvature at all. Filaments crossing each other is fine:
        // y is row order, so a crossing asserts nothing.
        s.amp[i] = Math.min(wanderCap, Math.max(Math.min(1.6, wanderCap), spacing * 2.6));
        // The far field swings furthest, so the top and bottom edges of the
        // whole field breathe. Killing those two straight edges is most of what
        // stops this reading as a chart.
        s.curtain[i] = curtainCap * (lane / maxLane) * side;
        const id = group[0]?.id ?? String(i);
        let ph = s.phases.get(id);
        if (ph === undefined) { ph = phaseOf(id); if (s.phases.size < 4096) s.phases.set(id, ph); }
        s.phase[i] = ph;
        // A private wavelength as well as a private phase, off the same hash.
        // With one shared wavelength the mid-field settled into horizontal
        // banding — six hundred waves in step look like a weave, and that is
        // the texture this redesign was trying to get away from.
        s.freq[i] = 0.55 + (ph / (Math.PI * 2)) * 1.15;
        s.x0[i] = Math.max(plotX, frontierX - s.tails[i]! * pxPerSec);
        if (chosen && group.some(row => row.id === chosen)) { s.selected.push(i); continue; }
        const dr = depthOf(lane, maxLane);
        s.bins[Math.min(DEPTH_BUCKETS - 1, Math.floor((1 - dr) * DEPTH_BUCKETS)) * 2 + (side < 0 ? 0 : 1)]!.push(i);
        // Only where a spark is resolvable. In the far field the lanes are a
        // third of a pixel apart, so twenty flares there merge into one bright
        // dot on the frontier and read as an artefact, which is what the first
        // round's screenshots showed at the top corner.
        if (s.tails[i]! < FLARE_SECONDS && dr > 0.25) s.sparks.push(i);
      }

      // --- Colours ---
      // Twelve flat `rgba` strings, rebuilt only when the crowd changes. Flat,
      // not gradients: see `DEPTH_BUCKETS` for the nine-fold cost of the
      // gradient version this replaced.
      const key = base.toFixed(3);
      if (key !== tintKey) {
        tintKey = key;
        tints = [];
        for (let db = 0; db < DEPTH_BUCKETS; db++) {
          const dr = 1 - (db + 0.5) / DEPTH_BUCKETS;
          const alpha = base * (DEPTH_FLOOR + (1 - DEPTH_FLOOR) * dr);
          for (const side of [-1, 1]) {
            const [r, g, b] = laneTint(side, dr);
            tints.push(`rgba(${r},${g},${b},${alpha.toFixed(4)})`);
          }
        }
      }

      // --- Filaments ---
      // Every width stays under one device pixel so Skia keeps the hairline
      // path; see `DEPTH_BUCKETS`.
      for (let db = 0; db < DEPTH_BUCKETS; db++) {
        ctx.lineWidth = 0.55 + 0.45 * (1 - (db + 0.5) / DEPTH_BUCKETS);
        for (let k = 0; k < 2; k++) {
          const bin = s.bins[db * 2 + k]!;
          if (!bin.length) continue;
          ctx.strokeStyle = tints[db * 2 + k]!;
          ctx.beginPath();
          for (const i of bin) filament(i);
          ctx.stroke();
        }
      }

      // --- Heads on the frontier ---
      // Batched per depth bucket, one fill each, in a common near-ivory rather
      // than each filament's own tint: the frontier should read as the lit edge
      // of the field, not as six hundred separate dots.
      for (let db = 0; db < DEPTH_BUCKETS; db++) {
        const dr = 1 - (db + 0.5) / DEPTH_BUCKETS;
        const r = 0.4 + 1.1 * dr;
        ctx.fillStyle = `rgba(226,236,220,${Math.min(0.95, base * 0.85 * (DEPTH_FLOOR + (1 - DEPTH_FLOOR) * dr)).toFixed(4)})`;
        ctx.beginPath();
        for (let k = 0; k < 2; k++) for (const i of s.bins[db * 2 + k]!) ctx.rect(frontierX - r, s.headY[i]! - r, r * 2, r * 2);
        ctx.fill();
      }

      // --- Threads that have only just started ---
      // Read off age rather than diffed against the previous frame, so a
      // backward seek cannot make six hundred branches appear to be born at
      // once, and so a paused view still shows the ones that just arrived.
      if (s.sparks.length) {
        ctx.fillStyle = 'rgba(246,238,214,0.85)';
        ctx.beginPath();
        for (const i of s.sparks) {
          const r = 1 + 1.8 * (1 - s.tails[i]! / FLARE_SECONDS);
          ctx.rect(frontierX - r, s.headY[i]! - r, r * 2, r * 2);
        }
        ctx.fill();
      }

      // --- The playhead, as a veil ---
      ctx.strokeStyle = 'rgba(232,240,226,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(frontierX, plotY); ctx.lineTo(frontierX, plotY + plotH); ctx.stroke();

      // --- Selection, exempt from the depth falloff ---
      // The same exemption the renderer gives a selected thread or a focused
      // contributor: the point of picking one out of six hundred is that it
      // stops being atmosphere.
      if (s.selected.length) {
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (const i of s.selected) filament(i);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        for (const i of s.selected) ctx.rect(frontierX - 2.5, s.headY[i]! - 2.5, 5, 5);
        ctx.fill();
      }

      // --- MASTER ---
      // Three passes so it blooms rather than merely being 2 px wide, and it
      // stops at the playhead like everything else. Drawn last: at 600 threads
      // the nearest lanes are two pixels away and it has to win.
      const ivory = settings.highContrast ? '#ffffff' : '#f6e8c6';
      ctx.lineCap = 'round';
      ctx.strokeStyle = ivory;
      for (const [w, alpha] of [[9, 0.05], [4.5, 0.11], [1.8, 1]] as const) {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(plotX, spineY); ctx.lineTo(frontierX, spineY); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = ivory;
      ctx.beginPath(); ctx.arc(frontierX, spineY, motion ? 2.6 + Math.sin(clock * 1.6) * 0.5 : 2.8, 0, Math.PI * 2); ctx.fill();

      // At the head of the spine rather than at the far left, because the far
      // left is under the strongest part of the CSS scrim that fades the past
      // and the label went unreadable there. It also puts the one piece of
      // text in the frame where the eye already is.
      const name = perf?.source.defaultBranch?.toUpperCase() || 'MAIN';
      ctx.font = '11px system-ui';
      ctx.textBaseline = 'alphabetic';
      const nameW = ctx.measureText(name).width;
      const nameX = Math.max(plotX + 1, frontierX - 12 - nameW);
      ctx.fillStyle = 'rgba(9,13,18,0.82)';
      ctx.fillRect(nameX - 3, spineY - 18, nameW + 6, 14);
      ctx.fillStyle = ivory;
      ctx.fillText(name, nameX, spineY - 7);

      if (grouped) {
        // On `yBase`, not on the wandered head: a label on a strict grid can
        // never collide with its neighbour however the line moves.
        ctx.fillStyle = '#d9e1dd';
        for (let i = 0; i < n; i++) {
          const count = batch[i]!.length;
          ctx.fillText(`${count} ${count === 1 ? 'branch' : 'branches'}`, 8, s.yBase[i]! + 4);
        }
      }

      painted.current = { groups: batch, ys: s.headY };
      // The overlays that light the frontier and fade the past are CSS, so they
      // need to be told where the frontier went. Written only when it actually
      // moves — that is a style recalculation, and panning is rare.
      const pct = `${(cam.frontier * 100).toFixed(1)}%|${padL}`;
      if (pct !== shownFrontier.current && el.parentElement) {
        shownFrontier.current = pct;
        el.parentElement.style.setProperty('--gt-frontier', `${(cam.frontier * 100).toFixed(1)}%`);
        // In the key as well as in the write: the gutter changes when the view
        // groups and the frontier does not, and keying on the frontier alone
        // left the scrim starting 96 px in after a phone-width visit.
        el.parentElement.style.setProperty('--gt-gutter', `${padL}px`);
      }
      const secs = Math.round(cam.past);
      const label = secs >= 90 ? `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s` : `${secs}s`;
      if (label !== shownSpan.current) { shownSpan.current = label; setSpanLabel(label); }

      if (motion || player.playing) frame = requestAnimationFrame(draw);
    };
    s.last = performance.now();
    draw(s.last);
    return () => cancelAnimationFrame(frame);
  }, [open, index, size, capacity, grouped, chosen, seekRedraw, spread, nudge, store.settings.value.reducedMotion, store.settings.value.highContrast, perf?.source.defaultBranch]);

  if (!perf || !open) return null;
  const choose = (list: BranchActivity[]) => { pause(); setChoices(list); setChosen(list[0]?.id || ''); setError(''); };
  const zoom = (factor: number) => {
    const cam = camera.current;
    cam.manual = true;
    cam.past = Math.max(MIN_PAST_SECONDS, Math.min(Math.max(MIN_PAST_SECONDS, player.duration || 1e9), cam.past * factor));
    repaintIfStill();
  };
  const fit = () => { camera.current = { ...FIT, spread: camera.current.spread }; repaintIfStill(); };
  return <section class="branch-overview" aria-label="Branch activity overview" aria-busy={!ready && !error} data-testid="branch-overview">
    <header>
      <div><strong>Branch activity</strong><p data-testid="branch-overview-count">{ready ? `${active.length} branches with work in progress · ${groups.length} ${grouped ? 'groups' : 'lines'}` : error || 'Loading branch activity…'}</p></div>
      <button type="button" onClick={() => { store.branchOverviewOpen.value = false; setPending(null); }}>Back to graph</button>
    </header>
    <p class="overview-explanation">{perf.coverage.completeness === 'exact' ? 'Whole loaded history' : 'Known history'} · Each line is one branch drawn back from now — its length is how long that branch has been working, never a path to or from {perf.source.defaultBranch?.toUpperCase() || 'MAIN'}. Drag to pan, scroll to zoom, click a line to select it.</p>
    <div class="overview-field" data-grouped={grouped ? 'true' : undefined}>
    <canvas ref={canvas} role="img" aria-label={ready ? `${active.length} active branches represented by ${groups.length} ${grouped ? 'groups' : 'lines'}, each drawn back from the playhead. Use Choose a branch to inspect them.` : 'Loading branch activity'} data-testid="branch-overview-canvas"
      onWheel={e => { e.preventDefault(); zoom(e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP); }}
      onPointerDown={e => { drag.current = { x: e.clientX, from: camera.current.frontier, moved: 0 }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => {
        const d = drag.current;
        if (!d) return;
        d.moved = Math.max(d.moved, Math.abs(e.clientX - d.x));
        if (d.moved < 3) return;
        // Panning slides the playhead across the plot rather than moving time,
        // and it is clamped so the playhead cannot leave the frame. Every
        // active thread's head is on the playhead, so that clamp is what keeps
        // invariant 1 true under a camera: tails may run off the left edge,
        // heads never can.
        camera.current.manual = true;
        camera.current.frontier = Math.max(0.22, Math.min(0.97, d.from + (e.clientX - d.x) / Math.max(1, e.currentTarget.getBoundingClientRect().width)));
        repaintIfStill();
      }}
      onPointerUp={e => {
        const d = drag.current;
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (!d || d.moved >= 3) return;
        // Nearest painted row, not a division: lanes are no longer evenly
        // spaced, and they wander.
        const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
        const { groups: rows, ys } = painted.current;
        let best = -1, bestGap = Infinity;
        for (let i = 0; i < rows.length; i++) {
          const gap = Math.abs(ys[i]! - y);
          if (gap < bestGap) { bestGap = gap; best = i; }
        }
        const row = best >= 0 && bestGap < 16 ? rows[best] : undefined;
        if (row) choose(row);
      }} />
    <div class="overview-veil" aria-hidden="true" />
    </div>
    <footer>
      <button type="button" disabled={!active.length} onClick={() => choose(active)}>Choose a branch</button>
      <span class="overview-camera">
        <button type="button" data-testid="overview-zoom-out" aria-label="Frame more history" title="Frame more history" onClick={() => zoom(ZOOM_STEP)}>−</button>
        <button type="button" data-testid="overview-zoom-in" aria-label="Frame less history, larger" title="Frame less history, larger" onClick={() => zoom(1 / ZOOM_STEP)}>+</button>
        <button type="button" data-testid="overview-fit" onClick={fit}>Fit</button>
        <button type="button" data-testid="overview-spread" aria-label={`Vertical spread: ${SPREAD_NAMES[spread]}`} onClick={() => { const next = (camera.current.spread + 1) % SPREADS.length; camera.current.spread = next; setSpread(next); }}>{SPREAD_NAMES[spread]}</button>
        {/*
          * A plain span, not an `output`. `output` carries an implicit live
          * region, and this value changes on every frame the auto-framing is
          * easing — a screen reader would have read the number out loud a
          * dozen times for one camera move. Readable when navigated to,
          * silent otherwise.
          */}
        <span data-testid="overview-span">{spanLabel} back</span>
      </span>
      {choices.length > 0 && <>
        <label>Branch <select data-testid="overview-branch-select" value={chosen} onChange={e => setChosen(e.currentTarget.value)}>{choices.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
        <button type="button" disabled={!!pending} onClick={() => { const row = choices.find(r => r.id === chosen); if (row) { pause(); setPending(row); seek(row.end); } }}>{pending ? 'Opening…' : 'Trace branch'}</button>
      </>}
      {error && <span role="status">{error}</span>}
    </footer>
  </section>;
}
