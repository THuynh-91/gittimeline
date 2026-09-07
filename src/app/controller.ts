import { batch, effect } from '@preact/signals';
import { store, isBusy, updateSettings, toast, announce, type AppError, type CatalogQuestion } from './store';
import { Player } from '@/player/player';
import { AudioEngine } from '@/audio/engine';
import { renderProfile, StageRenderer, type ManualCamera } from '@/renderer/canvas';
import { renderPosterSvg } from '@/renderer/poster';
import { compileInWorker, type CompileHandle } from '@/player/compileClient';
import { parseRepoUrl, type RepoRef } from '@/github/url';
import { GitHubClient, GitHubError } from '@/github/adapter';
import { ApiCache } from '@/github/cache';
import { ingestRepository, probeRepository, type IngestOutcome } from '@/github/ingest';
import { formatReset } from '@/github/ratelimit';
import { willOutrunTheCeiling } from '@/choreography/pace';
import { buildShowcaseDataset } from '@/fixtures/showcase';
import { buildLandingDataset } from '@/fixtures/landing';
import { fixtureById } from '@/fixtures/corpus';
import type { CompiledPerformance, Dataset, PlaybackPreset } from '@/model/types';
import { buildShareHash, parseShareHash } from '@/export/share';
import { createArtifact, downloadBlob, parseArtifact, serializeArtifact } from '@/export/artifact';
import { gunzipIfNeeded, performanceFileFor, performanceMatchesRequest, readCompiledPerformance, type PerfDatasetRef } from '@/export/performance';
import { fmtClock } from '@/choreography/events';
import { mapMonotone } from '@/choreography/clock';
import { claimTokenFromUrl, SIGN_IN_FAILED } from './auth';
import { trackPerformanceStart } from './analytics';
import { CatalogSource } from '@/player/catalogSource';
import { validateManifest, type CatalogManifest } from '@/export/catalogPackage';
import { sampleCamera } from '@/choreography/camera';
import { catalogUrl, externalCatalog } from './catalogLocation';

/**
 * Orchestration: ingestion runs, compilation, the frame loop, keyboard,
 * sharing and export. UI components only call into this module.
 */
export const player = new Player();
export const audio = new AudioEngine();
export const cache = new ApiCache();
let renderer: StageRenderer | null = null;
let canvasEl: HTMLCanvasElement | null = null;
let catalogSource: CatalogSource | null = null;
let windowGeneration = 0;
let windowPending = false;
/**
 * How far ahead to fetch. Long enough that a 250 kbps connection finishes in
 * time — the slowest page measured was under a second on a fast link and a few
 * seconds throttled — and short enough that a viewer who seeks away has not
 * paid for much they will not watch.
 */
const WARM_LEAD_SECONDS = 8;
/**
 * How much a time page holds either side of the range it is named for.
 *
 * `package-catalog.mjs` slices each page with `lo = start - 8, hi = end + 8`,
 * so a page called 30..60 carries events, cues and clock marks from 22 to 68.
 * The resource index records the *nominal* range, so the window reports 30..60
 * and understates what it can actually draw by eight seconds at each end.
 *
 * That understatement is what forced a stop at every boundary: the moment the
 * clock passed 60 the plan was declared not to cover it, when in fact it did.
 */
const PAGE_OVERLAP_SECONDS = 8;
/**
 * How early to fetch the next page, in performance seconds before the nominal
 * boundary. Far enough inside the overlap that the swap lands while the old
 * plan is still authoritative, so playback never waits for it.
 */
const PRE_SWAP_SECONDS = 3;
/**
 * How long a clock page runs, matching `WINDOW_SECONDS` in
 * `scripts/package-catalog.mjs`. Used to size the runway ahead of the playhead
 * so geometry outlasts the clock rather than the two interrupting in turn.
 */
const PAGE_SECONDS = 30;
/**
 * The widest band the fetcher will ask for, per side.
 *
 * Separate from `MAX_VIEW_WIDTH`, which is a limit on what may be *shown* — the
 * renderer refuses any zoom revealing more than is resident, and that number
 * should not move. This is a limit on what is *fetched*, and Linux needs a
 * wider one: a trailing camera plus thirty seconds of runway at 957 units a
 * second does not fit in 32,000. The worker still refuses anything that would
 * exceed its 96 MB resident budget, and the widest band measured so far was
 * 11.7 MB.
 */
const MAX_FETCH_WIDTH = 48000;
/**
 * The page boundary already warmed. Not reset when a window is prepared: a
 * geometry refetch prepares a window without crossing a boundary, and clearing
 * this there is what made the speculation repeat every couple of seconds.
 */
let warmedKey: string | null = null;
let committingSeek = false;

/**
 * What to put in front of a viewer when an interval will not load.
 *
 * The worker's own refusals are written for people — "This interval is missing
 * from the catalog.", "This view contains too much detail. Zoom in and retry."
 * — and are shown as they are. A network failure is not written for anybody:
 * `fetch` rejects with `TypeError: Failed to fetch` in Chromium, `NetworkError
 * when attempting to fetch resource.` in Firefox and `Load failed` in WebKit.
 * Putting one of those on screen answers "my wifi dropped" with a fragment of
 * a specification.
 *
 * Found by pulling the network out mid-performance: the banner read
 * "Failed to fetch" beside a Retry button.
 */
function intervalError(error: unknown): string {
  const raw = error instanceof Error ? error.message.trim() : '';
  const platform = /failed to fetch|networkerror|load failed|network ?request ?failed|fetch failed|^err_|the operation was aborted/i.test(raw);
  // A bare HTTP status is no more written for a person than a `TypeError` is.
  // The first pass at this caught the `fetch` rejection shape and left
  // "History resource unavailable (404). Retry this interval." in place.
  const status = /^[^a-z]*\b(\d{3})\b/i.test(raw) || /\((\d{3})\)/.test(raw);
  if (!raw || platform || status) return 'That stretch of the history could not be downloaded. Check your connection and try again.';
  return raw;
}

/**
 * Where the geometry for a moment lives, and how much of it to ask for.
 *
 * `x = impact * xScale` and `impact` is performance time, so the x a given `t`
 * needs is `t * xScale` — a property of the layout, knowable without asking
 * the camera anything. That matters because the camera is not a reliable proxy
 * for the playhead: the closing tableau's compiled cue points at the midpoint
 * of the whole history, so aiming a fetch at it loaded geometry 20 million
 * units from the end of Linux and left the final shot with nothing in it. The
 * previous attempt at this used the live viewport instead, which is right
 * during playback and wrong in exactly the same place, because in the tableau
 * the viewport is parked somewhere unrelated to `t`.
 *
 * Manual camera is the one case where the viewer, not the clock, decides what
 * is on screen — so there, and only there, the viewport is the authority.
 *
 * Biased forward because time runs one way: the band is `[x - width, x +
 * width]`, and centring it on the playhead spends half of it on history the
 * camera will never revisit.
 */
function windowRequest(t: number, view: { cx: number; worldW: number } | null, manual = false): { t: number; x?: number; width?: number } {
  const p = player.perf;
  if (manual && view) {
    // The viewer is holding the camera, so the camera is the only thing that
    // says what has to be drawable.
    const lead = Math.min(6000, Math.max(2000, view.worldW));
    return { t, x: view.cx + lead, width: Math.max(view.worldW, 12000) };
  }
  if (!p || !(p.duration > 0) || !Number.isFinite(p.bounds?.maxX)) return { t };
  const xScale = p.bounds.maxX / p.duration;
  if (!Number.isFinite(xScale) || xScale <= 0) return { t };
  // Wide, and mostly ahead.
  //
  // The band is `[x - width, x + width]`. Time pages are thirty performance
  // seconds, so the goal is a band that outlasts one: if geometry runs out
  // before the clock does, the two take turns interrupting playback and the
  // viewer gets two stalls per page instead of none. At the maximum width the
  // worker will accept, and biased so roughly a sixth sits behind the
  // playhead, this carries about thirty-five seconds of travel on Kubernetes
  // against a thirty-second page — so the clock is always the thing that runs
  // out first, and the clock is the thing being warmed.
  //
  // The part behind is not spare: the frame holds the head at 60-70% across,
  // so a few thousand units of already-performed history are on screen to the
  // left of it and have to be drawable.
  // The camera trails the clock, and by how much depends on the history.
  //
  // `t * xScale` is where the *playhead* is. The camera is somewhere behind it,
  // because the shot holds the head of the main line at 60-70% across and the
  // dolly is smoothed — and on Linux it trails by a median 6,129 world units
  // and a 95th percentile of 10,798, against about 1,200 on Kubernetes, Rust
  // and VS Code. Biasing the band forward by two thirds of its width leaves
  // 5,440 units behind the playhead, which covers the second group and starves
  // the first: 58% of Linux's frames wanted geometry the band did not hold,
  // the band was refetched eighteen times a second, and playback ran at 0.75x
  // with twenty seconds of clock replayed over ten minutes.
  //
  // So the band is fitted to what has to be in it rather than to a fixed
  // fraction: the visible frame at its trailing edge, the playhead, and enough
  // runway past the playhead to outlast a clock page. Where that does not fit
  // the low edge wins, because geometry behind the playhead is on screen now
  // and geometry ahead of it is not yet needed.
  const tx = t * xScale;
  // Clamped, because right after a seek the camera is still at the moment it
  // was asked to leave. Measuring the gap then reads the distance *jumped* as
  // the distance *lagged*: seeking Linux to 80% put the camera 16.5 million
  // units behind the playhead, so the band was fitted around 16.5M while the
  // frame was at 32.6M and the stage drew nothing. A real trail is about
  // 11,000 units at the 95th percentile on the worst entry, so half the band
  // is a generous ceiling and a decisive one.
  const trail = view ? Math.max(0, tx - view.cx) + view.worldW / 2 : 0;
  const behind = Math.min(MAX_FETCH_WIDTH * 0.5, Math.max(6000, trail + 2000));
  const ahead = Math.max(12000, PAGE_SECONDS * xScale + 4000);
  const width = Math.min(MAX_FETCH_WIDTH, Math.max(6000, (behind + ahead) / 2));
  return { t, x: tx - behind + width, width };
}

async function prepareCatalogWindow(t: number, manual = false, opts: { seek?: boolean } = {}) {
  const source = catalogSource;
  if (!source) return;
  const generation = ++windowGeneration;
  windowPending = true;
  /**
   * Stop the show only if the show cannot go on.
   *
   * This froze playback for the whole of every window preparation, and most
   * preparations do not need it: the clock pages are thirty seconds and the
   * geometry band is refetched as the camera travels, so the common case is a
   * plan that already covers the playhead being replaced by a wider one. There
   * is nothing to wait for there — the frame that is on screen is correct and
   * stays correct until the new plan lands.
   *
   * Measured on Kubernetes at 120 seconds of playback: seven stops, one every
   * seventeen seconds, each 43-99ms. The prefetch had already taken the
   * download out of them — a warmed page answers in 100ms against 100ms cold —
   * because what is left is assembling the plan and structured-cloning it back
   * across the worker boundary, which no amount of fetching ahead removes.
   *
   * So the remaining stalls are not waits for data; they are waits for a swap
   * that did not need to be waited for. What genuinely needs the freeze is a
   * seek into an interval nobody has loaded, where continuing would draw a
   * moment the plan cannot describe.
   */
  const held = player.perf;
  // Judged on where the clock *is*, not on what is being asked for. A
  // pre-swap asks for a moment a few seconds ahead precisely so that it can
  // be fetched while the playhead is still somewhere the current plan
  // describes; testing the requested time instead would call every one of
  // those uncovered and reintroduce the stop it exists to avoid.
  const w = held?.window;
  const covered = !!w && player.t >= w.start - PAGE_OVERLAP_SECONDS && player.t < w.end + PAGE_OVERLAP_SECONDS;
  if (!covered) player.buffered = false;
  /**
   * Load around what the renderer is actually looking at.
   *
   * This asked for the viewport only when the viewer had taken the camera,
   * and left the worker to fall back on `sampleCamera(camera, t).x` otherwise.
   * That was the same position the renderer used, until the auto camera
   * started correcting the shot to keep the head of the main line between
   * three fifths and seven tenths across — after which the two disagree by
   * however far that correction reaches.
   *
   * On a windowed plan they disagree enormously, because the camera track in
   * a streamed assembly is nearly flat: measured on Kubernetes, the cue read a
   * constant 83,226 for the whole of one thirty-second page, then 109,012 for
   * the next, while the renderer swept smoothly from 69,471 to 100,829 across
   * the same stretch. So geometry was fetched centred up to 33,000 world units
   * from the frame, and the frame was left with three of the plan's 1,053
   * nodes in it. That is the reported "missing a lot of nodes", "missing
   * connections", and a main line with holes in it — one cause, not three.
   *
   * Only where the viewport is evidence about the moment being asked for:
   * during playback, and wherever the viewer is holding the camera. On the
   * first fetch of an entry there is no window yet and the renderer is still
   * showing whatever came before; on a jump to an unrelated time it is showing
   * the place being jumped away from. Both would aim this at the wrong part of
   * the history and then need a second fetch to undo it, so both fall back to
   * the cue, which is at least an estimate *of the requested time*.
   */
  const live = renderer?.viewport() ?? null;
  try {
    /**
     * Aimed ahead of the camera, not centred on it.
     *
     * The worker loads `[x - width, x + width]`, so centring on the camera
     * spends half the band on history already behind the playhead, which the
     * camera will never return to. Measured on Kubernetes: about 2,600 units
     * of runway, a refetch every three or four seconds, and twenty-five short
     * stalls in ninety seconds of playback — which is the stuttering that was
     * reported. Only one of those was a change of *time* page; the rest were
     * geometry being fetched again for a camera that had merely moved.
     *
     * Time only runs one way here and `x = impact * xScale`, so the camera
     * only ever travels right. Biasing the band forward by most of its own
     * width turns 2,600 units of runway into roughly 14,000 — about seventeen
     * seconds of performance, which is the same order as the thirty-second
     * time page, so geometry and clock now tend to be refetched together
     * rather than in alternation.
     *
     * `width` is per side and the worker clamps it to [6000, 16000], so this
     * asks for 24,000 units in total against a 96 MB resident budget, and the
     * budget still refuses anything it cannot hold.
     */
    const perf = await source.prepare(windowRequest(t, live, manual));
    if (source !== catalogSource || generation !== windowGeneration) return;
    const selected = player.perf?.nodes[store.selectedNode.value ?? -1]?.sha;
    const thread = player.perf?.threads[store.selectedThread.value ?? -1]?.id;
    player.perf = perf;
    batch(() => {
      store.perf.value = perf;
      store.selectedNode.value = selected ? perf.nodes.findIndex(n=>n.sha===selected) : null;
      if(store.selectedNode.value === -1)store.selectedNode.value=null;
      store.selectedThread.value = thread ? perf.threads.findIndex(th=>th.id===thread) : null;
      if(store.selectedThread.value === -1)store.selectedThread.value=null;
      store.hoverNode.value = null;
    });
    renderer?.setPerformance(perf,t);
    syncRendererSettings();
    captionPtr = perf.events.findIndex(e=>e.performanceImpact>t);
    if(captionPtr<0)captionPtr=perf.events.length;
    // A pre-swap is a change of plan, not a change of time: the clock is
    // mid-page and must stay there. Only a request made *for* a moment moves
    // the playhead to it.
    // Never backwards, and never during playback.
    //
    // `t` is captured when the request is issued and the clock keeps running
    // while it is in flight, so seeking to it on arrival replays whatever
    // elapsed. Harmless at one refetch per page and ruinous at eighteen a
    // second: on Linux this rewound 1,030 frames and replayed 20.4 seconds of
    // clock in a ten-minute run. A request made *for* a moment — a seek — must
    // still land on it, which is what `opts.seek` distinguishes; an ordinary
    // refetch is a change of plan and has no business moving the playhead.
    if (opts.seek !== false && !player.playing) {
      committingSeek = true;
      if(Math.abs(player.t-t)>.001) player.seek(t);
      committingSeek = false;
    }
    player.buffered = true;
    store.banner.value = null;
  } catch(error) {
    if(source!==catalogSource||generation!==windowGeneration)return;
    player.pause();
    // A pre-swap that fails costs nothing: the page in hand still covers the
    // playhead — that is the condition under which it was issued — so pausing
    // and putting an error in front of somebody is answering a question they
    // did not ask. Measured: six seconds offline stopped the show at t=27.0
    // holding a page good to t=38, with the network back by t=31.
    if (opts.seek === false) return;
    // And Retry has to resume where it stopped. Omitting the options here
    // moved the playhead 27.0 -> 31.0, because `t` is the moment the failed
    // request was aimed at rather than the moment the viewer is watching.
    const at = player.t;
    store.banner.value={kind:'info',message:intervalError(error),action:{label:'Retry',run:()=>void prepareCatalogWindow(at,manual,opts)}};
  } finally {
    if(source===catalogSource&&generation===windowGeneration)windowPending=false;
  }
}
/**
 * A seek always moves the clock. Whether it can be *drawn* is a separate
 * question.
 *
 * This refused the seek and fetched instead, so on a slow link the scrubber
 * went dead: ten drags 120ms apart moved nothing and said nothing, because
 * each request superseded the one before it and none ever landed to release
 * the playhead. A scrubber that does not move is broken however good the
 * reason.
 *
 * So the clock goes where it was sent, `buffered` says the stage cannot draw
 * it yet, and the frame loop holds the last good frame under "Loading this
 * part of history…" until the window arrives — which is what that notice is
 * for and what every video player does.
 */
player.beforeSeek = (t) => {
  if(!catalogSource||committingSeek)return true;
  const w=player.perf?.window;
  const at=Math.max(0,Math.min(player.duration,t));
  if(!windowPending&&w&&at>=w.start-PAGE_OVERLAP_SECONDS&&at<w.end+PAGE_OVERLAP_SECONDS)return true;
  void prepareCatalogWindow(at,false,{seek:false});
  return true;
};

interface Run {
  id: number;
  abort: AbortController;
  compile: CompileHandle | null;
}
let run: Run | null = null;
let runCounter = 0;
let lastRepo: RepoRef | null = null;
let lastInputForRetry: string | null = null;
/**
 * The page a performance was started from, so cancelling it can go back there.
 *
 * This was a boolean — `returnToLanding` — and cancel read it as
 * `if (!store.perf.value || returnToLanding)`. Opening something from the
 * selection page set neither: the flag was only assigned by `loadRepo`, and
 * `store.perf` was already non-null because the landing page keeps a demo
 * compiled behind the hero. So cancelling a large catalog entry left the mode
 * on 'player' with the old performance still loaded, and the viewer was
 * dropped into "an example history" they had never asked for instead of back
 * on the shelf they were browsing.
 *
 * A route rather than a flag, captured at the moment the stage is taken.
 */
let startedFrom: 'landing' | 'catalog' | 'signin' = 'landing';

/** Take the stage, remembering the page being left so cancel can return to it. */
function enterPlayer() {
  const from = store.mode.value;
  if (from !== 'player') startedFrom = from;
  store.mode.value = 'player';
}
let partialDataset: Dataset | null = null;
let recompileTimer: number | null = null;
let recorder: MediaRecorder | null = null;
/** The repository a scope question is about, held while the viewer decides. */
let pendingScope: { repo: RepoRef; autoplay: boolean; startAt?: number; tip?: string | null } | null = null;
/**
 * How many commits make a repository worth asking about before fetching it.
 *
 * Size is only half the question — see `willOutrunTheCeiling` for the other
 * half, which is whether the history is dense enough that showing all of it
 * would have to go faster than the eye follows.
 */
const SCOPE_THRESHOLD = 3500;
let recordedChunks: Blob[] = [];

/**
 * A stretch of a performance, named by the calendar years it covers.
 *
 * Both ends are inclusive years, so `{ from: 2016, to: 2016 }` is that year and
 * nothing else. Years rather than instants because a year is what somebody
 * picks off a shelf, and because the plan's own clock is the thing being cut:
 * `timeMap` turns any date into the moment that date lands on stage, so a span
 * costs one lookup and no compilation at all.
 */
export interface SpanChoice {
  from: number;
  to: number;
}

/**
 * The window the clock is allowed to run inside, or null for the whole plan.
 *
 * Not `player.loop`, which wraps: reaching the end of a span is the end of what
 * was asked for, and silently starting it again is a different offer. The frame
 * loop stops on this instead.
 */
let spanWindow: { start: number; end: number } | null = null;

/** Where a span's years fall in the plan, in performance seconds. */
function spanWindowOf(perf: CompiledPerformance, span: SpanChoice): { start: number; end: number } | null {
  const map = perf.timeMap;
  if (!map.length) return null;
  const firstYear = new Date(map[0]![0]).getUTCFullYear();
  const lastYear = new Date(map[map.length - 1]![0]).getUTCFullYear();
  // The opening and the closing belong to whichever span touches them. The
  // clock reserves a head and a tail either side of the first and last
  // arrivals, and a span that started at the first commit's impact would skip
  // the establishing shot the performance was built to open on.
  const start = span.from <= firstYear ? 0 : mapMonotone(map, Date.UTC(span.from, 0, 1));
  const end = span.to >= lastYear ? perf.duration : mapMonotone(map, Date.UTC(span.to + 1, 0, 1));
  if (!(end > start + 0.5)) return null;
  return { start, end };
}

/**
 * How long each calendar year of a plan occupies on stage, in seconds.
 *
 * This is the whole of what a span costs, and it is not derivable from the
 * dates: the clock gives every visible arrival the same beat, so a year's share
 * of the running time is its share of the *commits*, not its share of the
 * calendar. Node's 2015 and its 2024 are the same length of year and nowhere
 * near the same length of show.
 *
 * Read off a loaded plan, which is why it is exposed on the debug hook: the
 * catalog indexer opens every entry anyway, and this is the one measurement it
 * cannot take from the dataset beside it.
 */
export function planYears(perf: CompiledPerformance): Array<[number, number]> {
  const map = perf.timeMap;
  if (!map.length) return [];
  const firstYear = new Date(map[0]![0]).getUTCFullYear();
  const lastYear = new Date(map[map.length - 1]![0]).getUTCFullYear();
  if (!Number.isFinite(firstYear) || !Number.isFinite(lastYear) || lastYear - firstYear > 400) return [];
  const out: Array<[number, number]> = [];
  for (let y = firstYear; y <= lastYear; y++) {
    const w = spanWindowOf(perf, { from: y, to: y });
    if (w) out.push([y, Math.round((w.end - w.start) * 10) / 10]);
  }
  return out;
}

/**
 * Arrivals per second — the pace a plan actually plays at.
 *
 * The choreographer gives every visible commit `SECONDS_PER_NODE`, so this
 * comes out near 7.7 for any history large enough for length to be set by the
 * arrivals rather than by the target, and lower for the small ones. It is on
 * the card because it is the one fact about a performance that says whether it
 * can be followed, and it used to be catastrophically wrong: while a
 * thirty-five minute ceiling existed, Linux's 332,279 arrivals were delivered
 * in 2,100 seconds — 158 a second, against a suite that asserts nine.
 */
export function planPace(perf: CompiledPerformance): number {
  return perf.duration > 0 ? perf.nodes.length / perf.duration : 0;
}

/**
 * Arrivals per second past which the eye stops counting — `tests/unit/pacing.test.ts`.
 *
 * A span is a *window* on a plan, and a window changes nothing about density:
 * measured across the shipped catalog, every entry's arrivals are spread
 * evenly enough through its plan that any stretch of it lands within a tenth of
 * the whole. So a span cannot be made legible by being shorter — only by being
 * played slower, which is what this is for.
 *
 * On today's catalog it never fires, and that is a measurement rather than an
 * assumption: with no ceiling on length every plan is paced at 0.13s an arrival
 * and comes in at 5.6 to 7.7 a second, so `min(1, ...)` is 1 for all twelve and
 * a span plays at the pace it was written for. It stays because the guard is
 * one line and the failure it prevents — a span that smears — is the one this
 * whole feature exists to avoid.
 */
const LEGIBLE_ARRIVALS_PER_SECOND = 9;

const LENGTH_BIAS = { brief: 0.62, natural: 1, extended: 1.55 } as const;

export function presetFromSettings(): PlaybackPreset {
  const s = store.settings.value;
  return {
    id: 'cinematic',
    version: 1,
    targetDuration: store.durationOverride.value ?? 0,
    lengthBias: LENGTH_BIAS[s.lengthMode],
    reducedMotion: s.reducedMotion,
    aggregateAbove: 900,
  };
}

/* ---------------- renderer lifecycle ---------------- */

export function attachCanvas(canvas: HTMLCanvasElement): boolean {
  canvasEl = canvas;
  try {
    renderer = new StageRenderer(canvas);
  } catch {
    renderer = null;
    store.rendererMode.value = 'poster';
    store.banner.value = { kind: 'fallback', message: 'Canvas rendering is unavailable here, so the performance is shown as a static poster with a navigable event list.' };
    return false;
  }
  syncRendererSettings();
  if (store.perf.value) renderer.setPerformance(store.perf.value);
  return true;
}

export function detachCanvas() {
  renderer = null;
  canvasEl = null;
}

export function resizeRenderer() {
  renderer?.resize();
}

export function getRenderer(): StageRenderer | null {
  return renderer;
}

function syncRendererSettings() {
  if (!renderer) return;
  const s = store.settings.value;
  const shopWindow = store.mode.value === 'landing';
  renderer.settings = {
    ...renderer.settings,
    reducedMotion: s.reducedMotion,
    noFlash: s.noFlash,
    noShake: s.noShake,
    highContrast: s.highContrast,
    quality: s.quality,
    // No text on the stage behind the form. The renderer writes branch names,
    // aggregate captions and tags over the history in the same size and weight
    // as the page's own copy, and at the landing's framing they land at eye
    // level — "fix/i18n-410" and "7 commits converge" reading as if they were
    // part of the sentence asking for a URL. The picture keeps its shape and
    // its light; it just stops talking over the page.
    labels: shopWindow ? 'minimal' : s.labels,
    showGlyphs: s.showGlyphs,
    showSpineLabel: s.showSpineLabel,
    contributorFocus: store.contributorFocus.value,
    selectedNode: store.selectedNode.value,
    hoverNode: store.hoverNode.value,
    selectedThread: store.selectedThread.value,
  };
  // Behind the landing form the performance is the page. It is framed to fill
  // the canvas and barely veiled: the copy takes its contrast from a pool of
  // dark directly under it rather than from a blanket over the whole stage.
  // 0.85 was that blanket, and it took a picture that was already far too
  // small and made it faint as well.
  // Behind the form the history is scenery. 0.92 was tuned to win a contrast
  // measurement and won the page along with it — the thing you are meant to
  // read was competing with the thing behind it. It sits back down.
  renderer.attenuation = shopWindow ? 0.62 : 1;
  renderer.shopWindow = shopWindow;
  audio.levels = { master: s.effectsLevel, effects: s.effectsLevel, muted: s.muted };
  audio.dynamics = s.dynamics;
  audio.applyLevels();
}

/* ---------------- frame loop ---------------- */

let rafId = 0;
let lastFrame = 0;
let uiTick = 0;
let captionPtr = 0;
let running = false;

function frame(now: number) {
  rafId = requestAnimationFrame(frame);
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  const perf = player.perf;
  /**
   * "Loading this part of history…" is derived, not announced.
   *
   * Three places used to raise and lower this by hand, and they disagreed: a
   * per-frame check would put the notice up, the playhead would drift back
   * inside the loaded window on its own, and the request that finally arrived
   * had been issued for a moment it *did* cover — so it took nothing down and
   * the notice stayed on screen for good, over a stage that was drawing
   * perfectly well. That deadlock reached the end of every streamed entry and
   * three tests caught it.
   *
   * `player.buffered` is the one fact — the stage cannot draw the moment the
   * clock is on — so the notice is now exactly that fact, recomputed every
   * frame. No sequence of window changes can leave the two disagreeing.
   */
  if (catalogSource) {
    const waiting = !player.buffered;
    if (store.buffering.peek() !== waiting) {
      store.buffering.value = waiting;
      syncAudioToPlayback();
    }
  }

  // Whether the plan in hand can describe the moment being drawn, asked every
  // frame rather than once.
  //
  // `prepareCatalogWindow` decided that when it was issued and never revisited
  // it, and `windowPending` then suppressed the whole block below — so once a
  // request was in flight the stage kept drawing whatever the clock reached,
  // out of a plan that had stopped covering it. A tenth of a second when the
  // link is quick, and 10.8 seconds of a page 0..30 being drawn for times past
  // 30 when it is not. `sampleCamera` clamps past a page's last cue, so the
  // dolly stops dead while the nameplate slides across the frame and then
  // snaps back.
  if(catalogSource&&perf?.window){
    const w=perf.window;
    const inside=player.t>=w.start-PAGE_OVERLAP_SECONDS&&player.t<w.end+PAGE_OVERLAP_SECONDS;
    if(!inside){
      player.buffered=false;
      if(!windowPending)void prepareCatalogWindow(player.t);
    }
  }
  if(catalogSource&&perf?.window&&!windowPending&&player.buffered){
    const t=Math.min(perf.duration,player.t+(player.playing?dt*player.rate:0));
    const v=renderer?.viewport();
    const manual=!!renderer?.manual;
    // Both from the live viewport, for the reason above: the cue is not where
    // the camera is. `half` carries a margin so the refetch is started while
    // there is still geometry either side, rather than once the gap is
    // already on screen.
    const x=v?v.cx:sampleCamera(perf.camera,t).x;
    // A little more than half the frame, so the fetch starts while there is
    // still geometry either side rather than once a gap is already on screen.
    const half=v?Math.min(16000,v.worldW)/2+1500:3000;
    // The clock has genuinely left what this plan can draw. `PAGE_OVERLAP` on
    // the low side because a page carries eight seconds before its nominal
    // start, and after a pre-swap the playhead is legitimately sitting there.
    const outside=t>=perf.window.end+PAGE_OVERLAP_SECONDS&&t<perf.duration
      ||t<perf.window.start-PAGE_OVERLAP_SECONDS;
    const starved=x-half<perf.window.minX||x+half>perf.window.maxX;
    if(outside||starved)void prepareCatalogWindow(t,manual);
    // Swap to the next page before the clock reaches it.
    //
    // Arriving at the boundary and *then* asking is what produced the last
    // three stops in two minutes — 47ms each, at 30s, 60s and 90s exactly.
    // Asking three seconds early puts the request inside the overlap, where
    // the old plan still describes the playhead, so the swap is silent and
    // the clock never waits. `seek: false` because this is a change of plan,
    // not a jump.
    else if(player.playing&&t>=perf.window.end-PRE_SWAP_SECONDS&&perf.window.end<perf.duration){
      const key=`swap:${perf.window.end}`;
      if(key!==warmedKey){
        warmedKey=key;
        void prepareCatalogWindow(Math.min(perf.duration,perf.window.end+1),manual,{seek:false});
      }
    }
    // Otherwise, get ahead of the next one.
    //
    // A window that is *needed* is a window being waited for, and waiting is
    // the stutter. This asks for the same thing several seconds early, on a
    // channel that does not stop playback and does not cancel the request the
    // stage is using; by the time the playhead arrives the pages are decoded
    // and the real call is a cache hit. Once per target, so a steady state
    // does not re-ask every frame.
    else if(player.playing){
      const ahead=Math.min(perf.duration,t+WARM_LEAD_SECONDS);
      // Keyed on the boundary being approached, so this happens once per page
      // however many times geometry is refetched on the way to it. Keying it
      // on a time bucket instead re-issued the same speculation every couple
      // of seconds, because an ordinary refetch reset the marker.
      const key=`warm:${perf.window.end}`;
      if(ahead>=perf.window.end&&t<perf.window.end&&key!==warmedKey){
        warmedKey=key;
        void catalogSource.warm?.(windowRequest(ahead,v??null,manual));
      }
    }
  }
  player.advance(dt);
  // A span ends where it said it would. `player.loop` would wrap here, which
  // is a different promise from the one the card made, so the stop is here
  // instead — one comparison a frame, and the same freeze the end of a whole
  // performance already produces.
  if (spanWindow && player.playing && player.t >= spanWindow.end) {
    player.seek(spanWindow.end);
    player.pause();
  }
  const t = player.t;
  if (renderer) {
    if(player.buffered)renderer.render(t, dt);
    const cam = renderer.camera;
    if (cam && cam.state !== store.cameraState.peek()) store.cameraState.value = cam.state;
  }
  if (perf && player.playing && player.buffered) {
    const idx = Math.min(perf.waveform.length - 1, Math.floor((t / Math.max(1e-6, perf.duration)) * (perf.waveform.length - 1)));
    audio.schedule(t, player.rate, perf.waveform[idx] ?? 0);
  }
  uiTick += dt;
  if (uiTick > 1 / 15 || !player.playing) {
    uiTick = 0;
    if (Math.abs(store.time.peek() - t) > 0.001) store.time.value = t;
    updateCaption(t);
  }
}

function updateCaption(t: number) {
  const perf = player.perf;
  if (!perf) return;
  const events = perf.events;
  if (captionPtr >= events.length || (captionPtr > 0 && events[captionPtr - 1]!.performanceImpact > t)) captionPtr = 0;
  let current = store.caption.peek();
  while (captionPtr < events.length && events[captionPtr]!.performanceImpact <= t) {
    const ev = events[captionPtr++]!;
    if (ev.type === 'MERGE_IMPACT' || ev.type === 'MAJOR_MERGE' || ev.type === 'OCTOPUS_MERGE' || ev.type === 'DIVERGENCE' || ev.type === 'TAG_LANDMARK' || ev.type === 'QUIET_GAP' || ev.type === 'REPO_BIRTH' || ev.type === 'REPO_PRESENT' || ev.type === 'UNKNOWN_SPAN' || ev.type === 'AGGREGATE_SPAN' || ev.type === 'ERA_TRANSITION' || ev.type === 'UNMERGED_TIP' || ev.type === 'MULTI_ROOT_REVEAL') current = ev;
  }
  if (current !== store.caption.peek()) {
    store.caption.value = current;
    if (current && current.type !== 'COMMIT_STEP') announce(current.caption);
  }
}

export function startLoop() {
  if (running) return;
  running = true;
  lastFrame = 0;
  rafId = requestAnimationFrame(frame);
}

export function stopLoop() {
  running = false;
  cancelAnimationFrame(rafId);
}

/**
 * The music plays during a performance and at no other time.
 *
 * `audio.reset()` used to be the whole of this, and for a synthesised score it
 * was enough — there was nothing to hear between events. A recording keeps
 * playing until something stops it, so pausing left the soundtrack running
 * over a frozen picture and going back to the landing page left it playing
 * over the form. Neither is a performance, so neither gets music.
 */
function syncAudioToPlayback() {
  // `PLAYING` rather than `player.playing`, because the two are not the same
  // thing while a repository is still being fetched and compiled: the clock
  // can be running against a performance that has nothing on screen yet, and
  // music over a loading screen is music with nothing to accompany.
  const performing = store.mode.value === 'player' && player.playing && player.buffered && !!store.perf.value && store.phase.value === 'PLAYING';
  if (performing) audio.resume();
  else audio.suspend();
}

player.on('play', () => {
  store.playing.value = true;
  store.phase.value = 'PLAYING';
  syncAudioToPlayback();
});
player.on('pause', () => {
  store.playing.value = false;
  if (store.phase.value === 'PLAYING') store.phase.value = 'PAUSED';
  syncAudioToPlayback();
});
player.on('seek', () => {
  audio.reset();
  captionPtr = 0;
  store.time.value = player.t;
  updateCaption(player.t);
});
player.on('end', () => {
  store.playing.value = false;
  store.phase.value = 'PAUSED';
  // Running out of history is a way of stopping, and the music has to hear
  // about it. Only `pause` was wired to the soundtrack, and reaching the last
  // commit does not raise `pause` — so the rock kept playing over a finished,
  // motionless picture.
  syncAudioToPlayback();
  if (store.mode.value === 'landing') {
    // Reaching the end of the landing path does not rewind it. The next seed
    // generates a different history, so what follows is new work arriving
    // rather than the same half-minute again — and the seam falls where the
    // stage is naturally empty, which is the only place a change of history
    // does not read as a glitch.
    landingSeed++;
    // Fade through the change rather than cutting. A different history has a
    // different shape, and swapping it in on one frame is the only moment the
    // landing page can look like it restarted — which is the one thing it must
    // never look like. The fade is short enough to read as the camera moving
    // on and long enough to hide the swap.
    crossFadeStage(() => void loadDemo({ autoplay: true, landing: true }));
  } else if (store.settings.value.loopPerformance) {
    player.seek(0);
    player.play();
  }
});

/* ---------------- loading ---------------- */

function newRun(): Run {
  cancelRun();
  const r: Run = { id: ++runCounter, abort: new AbortController(), compile: null };
  run = r;
  return r;
}

export function cancelRun() {
  catalogSource?.dispose();
  catalogSource=null;
  windowGeneration++;
  windowPending=false;
  player.buffered=true;
  store.buffering.value=false;
  store.catalogManifest.value=null;
  if (!run) return;
  run.abort.abort();
  run.compile?.cancel();
  run = null;
}

export function cancel() {
  cancelRun();
  batch(() => {
    store.phase.value = store.perf.value ? 'READY' : 'CANCELLED';
    store.progress.value = null;
    store.compileStage.value = null;
    store.error.value = null;
    // Nothing was loaded, or the viewer backed out of a load that replaced
    // what was on stage: either way the page they came from is the only
    // honest destination.
    store.mode.value = startedFrom;
  });
  syncRendererSettings();
}

function stageLabel(stage: string): string {
  return { graph: 'Reading the commit graph…', threads: 'Finding parallel threads…', activity: 'Measuring activity…', clock: 'Setting the tempo…', layout: 'Laying out the stage…', events: 'Writing the choreography…', camera: 'Directing the camera…', done: 'Ready' }[stage] ?? stage;
}

async function compileAndLoad(r: Run, dataset: Dataset, opts: { autoplay: boolean; startAt?: number; outcome: IngestOutcome | 'synthetic' | 'artifact'; isDemo: boolean; backdrop?: boolean; span?: SpanChoice | null }): Promise<CompiledPerformance | null> {
  store.phase.value = 'BUILDING_DAG';
  const handle = compileInWorker(dataset, { preset: presetFromSettings(), seed: store.settings.value.seed }, (stage) => {
    if (run?.id !== r.id) return;
    store.compileStage.value = stageLabel(stage);
    store.phase.value = stage === 'layout' ? 'LAYING_OUT' : stage === 'events' || stage === 'camera' ? 'CHOREOGRAPHING' : store.phase.value;
  });
  r.compile = handle;
  let perf: CompiledPerformance;
  try {
    perf = await handle.promise;
  } catch (err) {
    if (run?.id !== r.id) return null;
    fail({ kind: 'compile', title: 'Could not compose this history', message: err instanceof Error ? err.message : String(err), resetAt: null, canPlayPartial: false, retry: true });
    return null;
  }
  if (run?.id !== r.id) return null;
  loadPerformance(perf, dataset, opts);
  return perf;
}

/**
 * `dataset` is null when the plan was precompiled and shipped: a `.gtperf`
 * carries the performance, not the commits it was made from. Everything the
 * stage draws comes from the plan; the dataset is what the inspector and the
 * commit rail read, and `loadCatalogEntry` fetches it separately, afterwards,
 * when it is small enough to be worth the bytes.
 */
function loadPerformance(perf: CompiledPerformance, dataset: Dataset | null, opts: { autoplay: boolean; startAt?: number; outcome: IngestOutcome | 'synthetic' | 'artifact'; isDemo: boolean; backdrop?: boolean; span?: SpanChoice | null }) {
  batch(() => {
    store.perf.value = perf;
    store.dataset.value = dataset;
    store.outcome.value = opts.outcome;
    store.isDemo.value = opts.isDemo;
    store.selectedNode.value = null;
    store.selectedThread.value = null;
    store.progress.value = null;
    store.compileStage.value = null;
    store.error.value = null;
    store.caption.value = null;
    // A new history is a new performance, and it was paced to be watched at
    // 1x. Carrying the last repository's 4x over to it means the first thing a
    // viewer sees of something they just chose is a blur they did not ask for.
    store.speed.value = 1;
    const degraded = opts.outcome === 'partial' || opts.outcome === 'rate-limited' || opts.outcome === 'offline-cached';
    store.phase.value = degraded ? 'DEGRADED_READY' : 'READY';
    if (store.rendererMode.value === 'poster') {
      /* keep the poster banner */
    } else if (opts.outcome === 'rate-limited') store.banner.value = { kind: 'rate-limited', message: `${perf.coverage.summary} GitHub’s request limit was reached; retry ${formatReset(null)}.` };
    else if (opts.outcome === 'offline-cached') store.banner.value = { kind: 'offline', message: `Served from your local cache. ${perf.coverage.summary}` };
    else if (opts.outcome === 'partial') store.banner.value = { kind: 'partial', message: perf.coverage.summary };
    else store.banner.value = null;
  });
  // A span is playing part of this plan and nothing else — no second download,
  // no second compile, no second anything. The years become two performance
  // times through the map the plan already carries, and the clock is told where
  // to start and where to stop.
  spanWindow = opts.span ? spanWindowOf(perf, opts.span) : null;
  store.span.value = spanWindow && opts.span ? { from: opts.span.from, to: opts.span.to } : null;
  store.spanSeconds.value = spanWindow ? { start: spanWindow.start, end: spanWindow.end } : null;
  player.load(perf, spanWindow ? spanWindow.start : (opts.startAt ?? 0));
  // Behind the form the performance is scenery, and scenery moves slowly. At
  // full pace the landing page is a scrolling wall of arrivals competing with
  // the one thing it is asking you to do, which is read a sentence and type a
  // URL. In the player it stays at 1x, where it is the thing being watched.
  //
  // A span is the third case, and the reason it is here rather than left at 1x
  // is worth stating: cutting the timeline does not thin the arrivals out. Play
  // a tenth of a plan and you get a tenth of the arrivals in a tenth of the
  // time, at exactly the density you started with. Only the rate moves that
  // number, so a span that would smear is slowed until it does not.
  player.rate = opts.isDemo && store.mode.peek() === 'landing' ? 0.22 : spanWindow ? Math.min(1, LEGIBLE_ARRIVALS_PER_SECOND / Math.max(1e-6, planPace(perf))) : 1;
  if (!opts.isDemo) store.speed.value = player.rate;
  // Every performance somebody actually started passes through here, and the
  // landing backdrop is the one nobody did — counting it would turn "how often
  // is a visualization started" into "how many people arrived". It is flagged
  // by its caller rather than read off the current mode, because a compile
  // that finishes after the viewer has clicked through to another page would
  // otherwise be counted as a performance they chose.
  //
  // What may then be said about the repository is entirely `analytics.ts`'s
  // decision. An artifact is either one of ours or a file the viewer supplied,
  // and the allowlist there is what tells those two apart.
  if (!opts.backdrop) {
    const source = opts.isDemo ? 'demo' : perf.source.provider === 'synthetic' ? 'fixture' : opts.outcome === 'artifact' ? 'artifact' : 'repository';
    trackPerformanceStart(source, `${perf.source.owner}/${perf.source.name}`, perf.stats.commits);
  }
  releaseCamera();
  captionPtr = 0;
  renderer?.setPerformance(perf);
  audio.setPerformance(perf);
  syncRendererSettings();
  startLoop();
  announce(`${perf.source.owner}/${perf.source.name} is ready: ${perf.stats.commits} commits, ${perf.stats.threads} threads, ${Math.round(perf.duration)} seconds.`, true);
  if (opts.autoplay) {
    if (store.mode.value === 'landing') player.play(); // soft performance behind the form: no audio, no mode change
    else play();
  }
}

function fail(error: AppError) {
  batch(() => {
    store.error.value = error;
    store.phase.value = error.retry ? 'ERROR_RECOVERABLE' : 'ERROR_FATAL';
    store.progress.value = null;
    store.compileStage.value = null;
    if (error.kind === 'rate-limited') store.phase.value = 'RATE_LIMITED';
  });
}

/**
 * Which path the landing page is currently showing.
 *
 * Advanced rather than reset. The landing history is generated from this, so
 * the next one is a different shape instead of the same one again — which is
 * the difference between a background that is alive and a thirty-second loop
 * that visibly rewinds.
 */
let landingSeed = 0;

export async function loadDemo(opts: { autoplay: boolean; landing: boolean; startAt?: number } = { autoplay: true, landing: false }) {
  if (!opts.landing) primeAudio();
  const r = newRun();
  lastRepo = null;
  partialDataset = null;
  // The scripted demo is a tour of the motion language and stays exactly as
  // written — it is what `?demo=1` and gallery mode show, and those have to be
  // reproducible. Behind the form the requirement is the opposite one: never
  // the same twice, and never seen to start over.
  const ds = opts.landing ? buildLandingDataset(String(landingSeed)) : buildShowcaseDataset();
  batch(() => {
    store.mode.value = opts.landing ? 'landing' : 'player';
    if (store.rendererMode.value !== 'poster') store.banner.value = null;
    store.error.value = null;
  });
  await compileAndLoad(r, ds, { autoplay: opts.autoplay, startAt: opts.startAt, outcome: 'synthetic', isDemo: true, backdrop: opts.landing });
  // Behind the landing form, open on the demo's most alive moment. The first
  // second of any history is a single commit on an otherwise empty stage,
  // which is the least interesting thing the app can show.
  if (opts.landing && opts.startAt == null) seekToLiveliest();
}

/**
 * Jump to where the current performance looks like something.
 *
 * The first attempt at this took the *longest* parallel phrase, which picks
 * the history's longest-lived branch — one extra line beside the spine, for
 * months. Long is not the same as busy. What makes a frame worth looking at is
 * how many threads are open at once, so this counts exactly that across the
 * performance and takes the widest moment, backing off a couple of seconds so
 * the page opens on threads still arriving rather than mid-merge.
 *
 * A third of the way in is the floor: some histories fan out immediately, and
 * their busiest instant is one where almost nothing has been drawn yet — busy
 * and empty at the same time.
 */
function seekToLiveliest() {
  const p0 = store.perf.value;
  if (!p0 || p0.duration <= 0) return;
  const STEPS = 240;
  const openAt = (t: number) => {
    let open = 0;
    for (const th of p0.threads) if (th.start <= t && th.end >= t) open++;
    return open;
  };
  let bestT = 0;
  let bestOpen = -1;
  for (let i = 0; i < STEPS; i++) {
    const t = (p0.duration * i) / (STEPS - 1);
    const open = openAt(t);
    // Strictly greater keeps the earliest of a plateau, which is the moment the
    // stage is filling rather than the one where it has started emptying.
    if (open > bestOpen) {
      bestOpen = open;
      bestT = t;
    }
  }
  // Open here and then run on. An earlier version also stopped at the far end
  // of this stretch and jumped back, which kept the picture busy and made the
  // landing page a four-second loop with a visible rewind in it — a worse
  // fault than the one it fixed. The path continues to its end and a
  // differently seeded one follows it, so nothing is ever seen twice.
  player.seek(Math.max(p0.duration * 0.34, Math.min(bestT - 2, p0.duration - 4)));
}

/**
 * Back to the landing page, with something worth looking at behind it.
 *
 * Returning used to leave whatever had been loaded frozen on the stage, so the
 * page a visitor came back to was a still frame of a finished performance
 * rather than the moving one they arrived at.
 */
export function showLanding() {
  store.mode.value = 'landing';
}

/**
 * The landing page is never still, and never has music.
 *
 * Both of those were being enforced at the call sites, and ten places set
 * `store.mode`. Escape sets it. Cancelling a load sets it. Failing to load
 * sets it. Every one had to remember to restart the demo and stop the
 * soundtrack, and the ones that forgot produced exactly the two faults you
 * would predict: a frozen picture behind the form, and a rock track playing
 * over it.
 *
 * So the mode drives it instead. There is nothing left for a call site to
 * forget, and a new one cannot reintroduce either fault.
 */
let lastMode = store.mode.peek();
effect(() => {
  const mode = store.mode.value;
  if (mode === lastMode) return;
  lastMode = mode;
  if (mode === 'landing') {
    audio.suspend();
    startLandingDemo();
  } else {
    syncAudioToPlayback();
  }
});

/**
 * Dip the stage, change what is on it, bring it back.
 *
 * The renderer's veil is already there for the landing page, so this borrows
 * it: darken to black over a beat, swap, and lift. Nothing else in the app
 * needs this — a performance the viewer chose should cut cleanly to the next
 * one — so it lives here beside the only thing that does.
 */
function crossFadeStage(swap: () => void) {
  if (!renderer) {
    swap();
    return;
  }
  const settled = renderer.attenuation;
  const DOWN = 420;
  const UP = 620;
  const started = performance.now();
  let swapped = false;
  const step = () => {
    if (!renderer || store.mode.peek() !== 'landing') {
      if (renderer) renderer.attenuation = settled;
      if (!swapped) swap();
      return;
    }
    const dt = performance.now() - started;
    if (dt < DOWN) {
      renderer.attenuation = settled * (1 - dt / DOWN);
    } else {
      if (!swapped) {
        swapped = true;
        swap();
      }
      const up = Math.min(1, (dt - DOWN) / UP);
      renderer.attenuation = settled * up;
      if (up >= 1) {
        renderer.attenuation = settled;
        return;
      }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Put something moving behind the form.
 *
 * If the demo is already loaded it is rewound to its liveliest stretch rather
 * than reloaded — recompiling to show the same thing is a second of black for
 * no reason. Anything else on the stage is a repository the viewer chose to
 * watch, and it is not the landing page's job to keep showing that.
 */
function startLandingDemo() {
  if (store.isDemo.peek() && store.perf.peek()) {
    releaseCamera();
    // The landing framing is a renderer setting, not a consequence of loading:
    // coming back from the catalog reuses the demo already in memory, so
    // nothing else here would put the shop window back.
    syncRendererSettings();
    seekToLiveliest();
    player.play();
    return;
  }
  void loadDemo({ autoplay: true, landing: true });
}

export async function loadFixture(id: string, autoplay = true) {
  const fx = fixtureById(id);
  if (!fx) {
    toast(`Unknown fixture “${id}”`);
    return;
  }
  primeAudio();
  const r = newRun();
  lastRepo = null;
  enterPlayer();
  await compileAndLoad(r, fx.build(), { autoplay, outcome: 'synthetic', isDemo: false });
}

/** Turn any ingestion failure into an honest, actionable error card. */
function reportGitHubError(err: unknown) {
  if (!(err instanceof GitHubError)) {
    fail({ kind: 'unknown', title: 'Something went wrong', message: err instanceof Error ? err.message : String(err), resetAt: null, canPlayPartial: false, retry: true });
    return;
  }
  if (err.kind === 'aborted') return;
  const titles: Record<string, string> = {
    'not-found': 'Repository not available',
    'rate-limited': 'GitHub rate limit reached',
    'secondary-limit': 'GitHub asked us to slow down',
    'empty-repository': 'No commits yet',
    network: 'GitHub unreachable',
    offline: 'You are offline',
    blocked: 'Repository unavailable',
    server: 'GitHub error',
    malformed: 'Unexpected response',
    unauthorized: 'Token rejected',
  };
  const rateMsg = err.kind === 'rate-limited' ? ` It resets ${formatReset(err.rate?.resetAt ?? null)}. Anonymous requests are limited per network by GitHub; GitTimeline cannot bypass that.` : '';
  fail({ kind: err.kind, title: titles[err.kind] ?? 'Something went wrong', message: err.message + rateMsg, resetAt: err.rate?.resetAt ?? null, canPlayPartial: false, retry: err.kind !== 'not-found' && err.kind !== 'blocked' });
}

/** Continue a load once the viewer has chosen how much history to fetch. */
/**
 * Ask which part of a catalog entry to watch, before starting it.
 *
 * The shelf used to carry this question on every card — a dropdown and a second
 * button under each one — which turned eleven projects into eleven small forms
 * and buried the thing a card is actually for. A card is a project and has one
 * action; *how much of it* is the next question, and it belongs after the
 * click, where the scope chooser has always asked it.
 *
 * Nothing has been fetched at this point and nothing needs to be. Every answer
 * downloads the same one plan.
 */
export function askCatalogScope(q: CatalogQuestion) {
  pendingCatalog = q;
  const years = q.years.map(([y]) => y);
  store.scope.value = {
    displayName: q.label,
    estimatedCommits: null,
    firstYear: years.length ? Math.min(...years) : null,
    lastYear: years.length ? Math.max(...years) : null,
    reason: 'catalog',
    mergeRatio: null,
    plan: q,
  };
}

/** The entry a catalog question is about, held while the viewer decides. */
let pendingCatalog: CatalogQuestion | null = null;

/** Answer it: a span of years, or null for the whole history. */
export function chooseCatalogSpan(span: SpanChoice | null) {
  const pending = pendingCatalog;
  store.scope.value = null;
  pendingCatalog = null;
  if (!pending) return;
  void loadCatalogEntry(pending.file, span ? `${pending.label} · ${spanLabel(span)}` : pending.label, span);
}

/** Put the question away and leave the viewer where they were. */
export function dismissScope() {
  store.scope.value = null;
  pendingCatalog = null;
  pendingScope = null;
}

/** `2019`, or `2022–2026`. */
export function spanLabel(span: SpanChoice): string {
  return span.from === span.to ? String(span.from) : `${span.from}–${span.to}`;
}

export function chooseScope(choice: { since: string | null; until: string | null; label: string }) {
  const pending = pendingScope;
  store.scope.value = null;
  pendingScope = null;
  if (!pending) return;
  void runIngest(pending.repo, { autoplay: pending.autoplay, tip: pending.tip ?? null, startAt: pending.startAt, since: choice.since, until: choice.until, scopeLabel: choice.label });
}

export async function loadRepo(input: string, opts: { autoplay?: boolean; tip?: string | null; startAt?: number; forceRefresh?: boolean } = {}): Promise<void> {
  const parsed = parseRepoUrl(input);
  if (!parsed.ok) {
    store.inputError.value = parsed.hint;
    return;
  }
  store.inputError.value = null;
  const repo = parsed.repo;
  lastRepo = repo;
  lastInputForRetry = input;
  primeAudio();
  batch(() => {
    enterPlayer();
    store.phase.value = 'FETCHING_METADATA';
    store.error.value = null;
    store.banner.value = null;
    store.scope.value = null;
  });

  // Anything already fetched plays immediately. Re-reading a repository you
  // watched yesterday should not cost a single request, so the stored dataset
  // is used as-is and refreshing is an explicit choice.
  if (!opts.forceRefresh) {
    const cached = await cache.getDataset(repo.slug);
    if (cached?.dataset?.commits.length) {
      const r0 = newRun();
      const perf = await compileAndLoad(r0, cached.dataset, { autoplay: opts.autoplay ?? true, startAt: opts.startAt, outcome: cached.dataset.coverage.completeness === 'exact' ? 'complete' : 'partial', isDemo: false });
      // Said once and gone. A permanent bar for a thing that went *right* is
      // just clutter over the stage; the banners that stay are the ones
      // reporting that the history is partial, which the viewer needs.
      // Re-fetching lives in Settings.
      if (perf) toast(`Loaded from your last visit — no requests used.`);
      return;
    }
  }

  const probeRun = newRun();
  const probeClient = new GitHubClient({
    cache: cache.available ? cache : null,
    token: store.token.value,
    signal: probeRun.abort.signal,
    onRate: (rate) => {
      if (run?.id === probeRun.id) store.rate.value = rate;
    },
  });
  store.progress.value = { phase: 'metadata', message: 'Reading repository…', pagesLoaded: 0, commitsLoaded: 0, reportedTotal: null, rate: null, repoName: repo.slug, fromCache: false };
  try {
    const probe = await probeRepository(repo, probeClient);
    if (run?.id !== probeRun.id) return;
    const tooBig = (probe.estimatedCommits ?? 0) > SCOPE_THRESHOLD;
    // Dense is not the same as large. A merge-heavy history can keep nearly
    // every commit on stage, because a junction only collapses when the branch
    // was a routine pull request — so it can outrun the ceiling at a size that
    // would be comfortable for a linear project.
    const tooDense = willOutrunTheCeiling(probe.estimatedCommits, probe.mergeRatio, presetFromSettings().lengthBias);
    if (tooBig || tooDense) {
      // Ask before spending hundreds of requests on something unwatchable.
      pendingScope = { repo, autoplay: opts.autoplay ?? true, startAt: opts.startAt, tip: opts.tip ?? null };
      batch(() => {
        store.progress.value = null;
        store.scope.value = {
          displayName: probe.displayName,
          estimatedCommits: probe.estimatedCommits,
          firstYear: probe.firstYear,
          lastYear: probe.lastYear,
          reason: tooDense ? 'dense' : 'large',
          mergeRatio: probe.mergeRatio,
        };
      });
      return;
    }
  } catch (err) {
    if (run?.id !== probeRun.id) return;
    reportGitHubError(err);
    return;
  }
  await runIngest(repo, { autoplay: opts.autoplay ?? true, tip: opts.tip ?? null, startAt: opts.startAt, since: null, until: null });
}

async function runIngest(repo: RepoRef, opts: { autoplay: boolean; tip: string | null; startAt?: number; since: string | null; until: string | null; scopeLabel?: string }): Promise<void> {
  const r = newRun();
  partialDataset = null;
  batch(() => {
    enterPlayer();
    store.phase.value = 'FETCHING_TOPOLOGY';
    store.error.value = null;
    store.progress.value = { phase: 'metadata', message: 'Reading repository…', pagesLoaded: 0, commitsLoaded: 0, reportedTotal: null, rate: null, repoName: repo.slug, fromCache: false };
  });
  const client = new GitHubClient({
    cache: cache.available ? cache : null,
    token: store.token.value,
    signal: r.abort.signal,
    onRate: (rate) => {
      if (run?.id === r.id) store.rate.value = rate;
    },
  });
  try {
    const result = await ingestRepository(repo, {
      client,
      signal: r.abort.signal,
      includeBranches: store.settings.value.includeBranches,
      maxPages: store.token.value ? 600 : 40,
      pinnedTip: opts.tip,
      since: opts.since,
      until: opts.until,
      onProgress: (p) => {
        if (run?.id !== r.id) return;
        store.progress.value = p;
        store.phase.value = p.phase === 'metadata' || p.phase === 'validating' ? 'FETCHING_METADATA' : 'FETCHING_TOPOLOGY';
      },
    });
    if (run?.id !== r.id) return;
    const ds = result.dataset;
    void cache.putDataset({ slug: repo.slug, dataset: ds, fetchedAt: Date.now(), tip: ds.source.selectedTipSha });
    void cache.touchRecent({ slug: repo.slug, name: repo.slug, lastOpened: Date.now(), commits: ds.commits.length }).then(refreshRecent);
    const perf = await compileAndLoad(r, ds, { autoplay: opts.autoplay, startAt: opts.startAt, outcome: result.outcome, isDemo: false });
    if (perf && result.outcome === 'rate-limited') store.banner.value = { kind: 'rate-limited', message: `${ds.coverage.summary} GitHub’s request limit was reached; it resets ${formatReset(result.resetAt)}.` };
    else if (perf && opts.scopeLabel && opts.since) store.banner.value = { kind: 'partial', message: `Showing ${opts.scopeLabel}. ${ds.coverage.summary}` };
  } catch (err) {
    if (run?.id !== r.id) return;
    if (err instanceof GitHubError) {
      if (err.kind === 'aborted') return;
      // Offline or rate-limited with a cached dataset: offer it truthfully.
      const cached = await cache.getDataset(repo.slug);
      if (cached && (err.kind === 'offline' || err.kind === 'network' || err.kind === 'rate-limited')) {
        partialDataset = cached.dataset;
        const message = err.kind === 'rate-limited' ? `GitHub’s request limit is exhausted (resets ${formatReset(err.rate?.resetAt ?? null)}). A cached copy from ${new Date(cached.fetchedAt).toLocaleString()} is available.` : `${err.message} A cached copy from ${new Date(cached.fetchedAt).toLocaleString()} is available.`;
        fail({ kind: err.kind, title: err.kind === 'rate-limited' ? 'GitHub rate limit reached' : 'GitHub unreachable', message, resetAt: err.rate?.resetAt ?? null, canPlayPartial: true, retry: true });
        return;
      }
      reportGitHubError(err);
      return;
    }
    fail({ kind: 'unknown', title: 'Something went wrong', message: err instanceof Error ? err.message : String(err), resetAt: null, canPlayPartial: false, retry: true });
  }
}

export async function playCachedPartial() {
  if (!partialDataset) return;
  const r = newRun();
  store.error.value = null;
  await compileAndLoad(r, partialDataset, { autoplay: true, outcome: 'offline-cached', isDemo: false });
}

export function retry() {
  if (lastInputForRetry) void loadRepo(lastInputForRetry, { autoplay: true });
}

/**
 * Play a history that was fetched ahead of time and shipped with the site.
 *
 * This is the answer to "can I share my token so other people get a higher
 * rate limit". A token in the client is readable by anyone who opens the
 * network tab, so instead the fetching happened once at build time and the
 * result is a static file: a visitor watches a large repository with no token
 * and no GitHub requests at all. The artifact still goes through the same
 * normalizer as live data, so nothing about the truth model is relaxed.
 *
 * Fetching ahead of time only ever removed half the wait, though, and much the
 * smaller half. The other half is `compilePerformance`: ripgrep 0.5s, React
 * 2.0s, CPython 20s, VS Code 36s, Kubernetes 142s, Rust 639s, and Linux and
 * Chromium never finished at all. So the compile is done ahead of time too. If
 * a `.gtperf.gz` sits beside the dataset, the plan inside it goes straight to
 * the player and the compiler never runs at all — see
 * `src/export/performance.ts` for what is in that file and why.
 *
 * The dataset path below is still here and still correct, because a shipped
 * plan can be absent (nothing has built one yet) or inapplicable (the viewer
 * has asked for a different length, or their system asks for reduced motion,
 * and a plan baked at one pace cannot honestly answer for another). Either way
 * the entry opens; it just opens the way it used to.
 */
export async function loadCatalogEntry(file: string, label: string, span: SpanChoice | null = null, startAt=0, autoplay=true, identity:string|null=null) {
  const r = newRun();
  batch(() => {
    enterPlayer();
    store.error.value = null;
    store.banner.value = null;
    store.phase.value = 'FETCHING_TOPOLOGY';
    store.progress.value = { phase: 'normalizing', message: `Opening ${label}`, pagesLoaded: 0, commitsLoaded: 0, reportedTotal: null, rate: null, repoName: label, fromCache: true };
  });
  primeAudio();
  try {
    const manifestUrl=catalogUrl(file.replace(/\.gittimeline\.gz$/,'.pages/manifest.json'));
    const response=await fetch(manifestUrl,{signal:r.abort.signal});
    // A 200 is not enough to conclude there is a package here.
    //
    // Single-page hosts answer a missing path with index.html and a 200 — the
    // dev preview does, and so does any host given an SPA fallback. Trusting
    // `response.ok` then hands HTML to `JSON.parse`, and the throw escapes
    // before the whole-plan fallback below is ever reached: every unpackaged
    // entry on the shelf fails to open at all, rather than opening the old way.
    // Requiring the content type is what distinguishes "no package" from "a
    // package that failed".
    const looksLikeManifest = response.ok && (response.headers.get('content-type') ?? '').includes('json');
    if(looksLikeManifest){
      const manifest=await response.json() as CatalogManifest;
      validateManifest(manifest);
      if(identity&&identity!==manifest.summary.planHash)throw new Error('This shared catalog revision is no longer published. Open the current history from Selection.');
      if(run?.id!==r.id)return;
      catalogSource=new CatalogSource(manifestUrl,manifest);
      store.catalogManifest.value=manifest;
      const t=span?(manifest.years.find(([y])=>y===span.from)?.[1]??0):startAt;
      const perf=await catalogSource.prepare({t});
      if(run?.id!==r.id)return;
      lastRepo=null;
      loadPerformance(perf,null,{autoplay,outcome:'artifact',isDemo:false,span,startAt:t});
      if(store.settings.value.seed!==perf.seed||store.durationOverride.value||store.settings.value.lengthMode!=='natural')store.banner.value={kind:'info',message:'This curated history uses its published composition. Playback speed and date range remain adjustable.'};
      return;
    }
    // Anything else that is not a plain absence is a real failure worth naming.
    if(!response.ok&&response.status!==404)throw new Error(`Catalog unavailable (${response.status}).`);
    if (externalCatalog) throw new Error('This published history is missing its playback package. Please retry after the catalog is repaired.');
    const ready = await loadPrecompiledPlan(r, file);
    if (run?.id !== r.id) return;
    if (ready?.matches) {
      lastRepo = null;
      loadPerformance(ready.perf, null, { autoplay: true, outcome: 'artifact', isDemo: false, span });
      toast(`${label} — fetched and composed ahead of time`);
      void hydrateInspectorDataset(r, ready.dataset);
      return;
    }
    const res = await fetch(catalogUrl(file), { signal: r.abort.signal });
    if (!res.ok) {
      // The dataset is gone and the plan is the wrong one. Play it anyway and
      // say so: the histories large enough to have had their dataset pruned
      // are exactly the ones somebody most wants to see, and refusing them
      // over a length preference helps nobody.
      if (ready) {
        lastRepo = null;
        loadPerformance(ready.perf, null, { autoplay: true, outcome: 'artifact', isDemo: false, span });
        store.banner.value = {
          kind: 'partial',
          message: `${label} ships at one length, so this is not the length you chose. Everything on stage is exact.`,
        };
        void hydrateInspectorDataset(r, ready.dataset);
        return;
      }
      throw new Error(`catalog entry unavailable (${res.status})`);
    }
    const { dataset } = await parseArtifact(await res.blob());
    if (run?.id !== r.id) return;
    lastRepo = null;
    await compileAndLoad(r, dataset, { autoplay: true, outcome: 'artifact', isDemo: false, span });
    toast(`${label} — fetched ahead of time, no requests used`);
  } catch (err) {
    if (run?.id !== r.id) return;
    fail({
      kind: 'artifact',
      title: 'Could not open that history',
      message: err instanceof Error ? err.message : String(err),
      resetAt: null,
      canPlayPartial: false,
      retry: false,
    });
  }
}

/**
 * Fetch the shipped plan for a catalog entry, if there is one this build can
 * use.
 *
 * Every way this can decline returns null rather than throwing, because none
 * of them is an error: an entry nothing has precompiled yet, a plan left over
 * from an older engine, a viewer whose settings ask for a different show. The
 * caller falls back to the dataset and the entry opens regardless. Only a plan
 * that is *present and broken* is worth saying anything about, and that goes
 * to the console rather than to the viewer, who has lost a second and nothing
 * else.
 *
 * The filename is derived rather than looked up. `index.json` is written by a
 * separate step that knows about datasets and thumbnails, and teaching it
 * about plans as well would mean a catalog could be indexed and precompiled in
 * either order and be wrong in one of them. A file that is either there or not
 * there cannot get out of step with itself.
 */
async function loadPrecompiledPlan(r: Run, file: string): Promise<{ perf: CompiledPerformance; dataset: PerfDatasetRef | null; matches: boolean } | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  let res: Response;
  try {
    res = await fetch(catalogUrl(performanceFileFor(file)), { signal: r.abort.signal });
  } catch {
    return null;
  }
  if (!res.ok || !res.body) return null;
  let ref: PerfDatasetRef | null = null;
  try {
    const perf = await readCompiledPerformance(await gunzipIfNeeded(res.body), (h) => {
      ref = h.dataset;
    });
    // A precompiled plan is one plan. Someone who has chosen a different
    // length, pinned a duration, or whose system asks for reduced motion is
    // asking for a different one, and playing this one and calling it theirs
    // would be a quiet lie about what they are watching.
    //
    // So the mismatch is reported rather than swallowed, and the caller
    // decides: compile the requested plan from the dataset if there is one, or
    // — when the dataset was pruned because nothing was ever going to fetch it
    // — offer this plan and say plainly that it is not the length asked for.
    // Refusing outright would be the third option and the worst of them: a
    // catalog entry that opens for most people and 404s for anyone with
    // reduced motion turned on.
    const matches = performanceMatchesRequest(perf, store.settings.value.seed, presetFromSettings());
    return { perf, dataset: ref, matches };
  } catch (err) {
    if (r.abort.signal.aborted) return null;
    console.warn('Precompiled performance could not be used; compiling from the dataset instead.', err);
    return null;
  }
}

/**
 * How large a dataset is worth fetching a second time, in bytes.
 *
 * A plan says where every commit lands and nothing about what any of them
 * said. Subjects, parent lists and links to GitHub live in the dataset, and
 * the inspector and the commit rail read them from there — so with a shipped
 * plan alone the stage is complete and the reading matter beside it is blank.
 * Fetching the dataset afterwards fills that back in, and it starts only once
 * the performance is already playing, so nobody is waiting on it.
 *
 * The limit is not really about bandwidth. Reading an artifact ends in one
 * synchronous pass through `buildDataset`, and that pass cannot be broken up:
 * ripgrep and React come back in about a second, CPython's 133,027 commits
 * take six, and six seconds of frozen stage in the middle of a performance
 * that is already running is a worse thing to hand somebody than a rail
 * without subjects. So the line is drawn where the pause stops being a hitch
 * and starts being a stall — which on the shipped catalog means ripgrep,
 * mdBook, React and Node.js fill in, and the six larger histories do not.
 *
 * The right fix is for the rail to ask for the subjects it is about to show
 * rather than for the whole history to be re-read to supply them. Until then
 * this is the honest half: everything on stage is exact for every entry, and
 * the panel beside it is complete for the ones where completing it is free.
 */
const HYDRATE_MAX_BYTES = 8_000_000;

async function hydrateInspectorDataset(r: Run, ref: PerfDatasetRef | null) {
  if (!ref || ref.bytes > HYDRATE_MAX_BYTES) return;
  try {
    const res = await fetch(catalogUrl(ref.file), { signal: r.abort.signal });
    if (!res.ok) return;
    const { dataset } = await parseArtifact(await res.blob());
    // The run may have moved on several times while this was in flight, and a
    // dataset for a history nobody is watching any more must never land on top
    // of the one they are.
    if (run?.id !== r.id || dataset.contentHash !== ref.contentHash) return;
    store.dataset.value = dataset;
  } catch {
    /* the rail keeps its blank subjects; nothing on stage depends on this */
  }
}

export async function loadArtifactFile(file: File) {
  const r = newRun();
  enterPlayer();
  store.phase.value = 'BUILDING_DAG';
  store.error.value = null;
  try {
    const { dataset, options } = await parseArtifact(file);
    if (run?.id !== r.id) return;
    if (options?.preset) {
      store.durationOverride.value = options.preset.targetDuration > 0 ? options.preset.targetDuration : null;
      updateSettings({ seed: options.seed });
    }
    lastRepo = null;
    await compileAndLoad(r, dataset, { autoplay: true, outcome: 'artifact', isDemo: false });
    toast(`Loaded from a .gittimeline artifact`);
  } catch (err) {
    if (run?.id !== r.id) return;
    fail({ kind: 'artifact', title: 'Could not import artifact', message: err instanceof Error ? err.message : String(err), resetAt: null, canPlayPartial: false, retry: false });
  }
}

export async function refreshRecent() {
  store.recent.value = await cache.listRecent();
}

/* ---------------- settings that change compilation ---------------- */

export function scheduleRecompile() {
  if (recompileTimer) clearTimeout(recompileTimer);
  recompileTimer = window.setTimeout(() => {
    recompileTimer = null;
    const ds = store.dataset.value;
    if (!ds) return;
    const wasPlaying = player.playing;
    const frac = player.duration ? player.t / player.duration : 0;
    const r = newRun();
    void compileAndLoad(r, ds, { autoplay: wasPlaying, outcome: store.outcome.value ?? 'synthetic', isDemo: store.isDemo.value }).then((perf) => {
      if (perf) player.seek(frac * perf.duration);
    });
  }, 250);
}

export function applySettingsToRuntime() {
  syncRendererSettings();
}

/** Start the audio graph while a user gesture is still fresh (browsers require it); no-op when muted. */
function primeAudio() {
  if (!store.settings.value.muted && navigator.userActivation?.isActive !== false) audio.ensure();
}

/* ---------------- playback controls ---------------- */

export function play() {
  if (!player.perf) return;
  if (!store.settings.value.muted) audio.ensure();
  // Leaving the landing page starts the performance, it does not join one
  // already in progress: the demo has been playing quietly behind the form.
  const fromLanding = store.mode.value === 'landing';
  if (fromLanding) enterPlayer();
  // The end of a span is an end, so pressing play there starts it again rather
  // than resuming into the part the viewer did not ask for.
  const atEnd = player.t >= (spanWindow ? spanWindow.end : player.duration) - 1e-3;
  if (fromLanding || atEnd) restart();
  syncRendererSettings();
  player.play();
  syncAudioToPlayback();
}

/**
 * Hand the camera back to the director.
 *
 * Manual framing outlives whatever it was framing. A viewer who zoomed into
 * one corner of a finished history and then loaded a different repository got
 * the new performance played entirely off-screen — it started at the
 * beginning, but the beginning was not where they were looking.
 */
function releaseCamera() {
  if (renderer) {
    renderer.manual = null;
    renderer.zoomLock = null;
  }
  store.manualCamera.value = false;
  store.cameraLocked.value = false;
  updateSettings({ autoCamera: true });
}

/**
 * Back to the top, and back to the director.
 *
 * Seeking alone is not enough. If the viewer had been travelling the finished
 * picture with the slider, the camera is parked in a corner under manual
 * control, and starting again would replay the whole history off-screen.
 */
function restart() {
  player.seek(spanWindow ? spanWindow.start : 0);
  releaseCamera();
  audio.reset();
}

export function pause() {
  player.pause();
}

export function togglePlay() {
  if (player.playing) pause();
  else play();
}

export function seek(t: number) {
  player.seek(t);
}

/**
 * Hold the music while the viewer drags the scrubber.
 *
 * Dragging used to pull the soundtrack through at whatever speed the pointer
 * moved, which is unpleasant and says nothing about the history. It holds and
 * picks up where it left off.
 */
export function setScrubbing(active: boolean) {
  audio.setScrubbing(active);
}

export function seekHistorical(ms: number) {
  player.seekHistorical(ms);
}

export function setSpeed(rate: number) {
  player.rate = rate;
  store.speed.value = rate;
}

export function stepUnit(dir: 1 | -1) {
  const s = store.settings.value.keyboardStep;
  if (s === 'commit') {
    const t = player.stepCommit(dir);
    if (t != null) player.seek(t);
    return;
  }
  const dt = s === 'second' ? 1 : player.beatLength();
  player.seekBy(dir * dt);
}

export function jumpLandmark(dir: 1 | -1) {
  const l = dir > 0 ? player.nextLandmark() : player.prevLandmark();
  if (l) {
    player.seek(l.time);
    announce(`${l.kind}: ${l.label} at ${fmtClock(l.time)}`, true);
  }
}

export function setLoop(range: { start: number; end: number } | null) {
  player.loop = range;
  store.loopRange.value = range;
}

export function toggleMute() {
  const muted = !store.settings.value.muted;
  updateSettings({ muted });
  if (!muted) audio.ensure();
  syncAudioToPlayback();
  syncRendererSettings();
  toast(muted ? 'Sound off' : 'Sound on');
}

/**
 * Cycles: free look → follow at the zoom you chose → full auto.
 * Zoom out, press the camera button, and the performance keeps playing at that
 * wider view instead of springing back.
 */
export function toggleAutoCamera() {
  if (!renderer) return;
  if (renderer.manual) {
    renderer.zoomLock = renderer.manual.scale;
    renderer.manual = null;
    updateSettings({ autoCamera: true });
    store.manualCamera.value = false;
    store.cameraLocked.value = true;
    toast('Following at your zoom level — press C again for auto framing');
    return;
  }
  if (renderer.zoomLock != null) {
    renderer.zoomLock = null;
    updateSettings({ autoCamera: true });
    store.manualCamera.value = false;
    store.cameraLocked.value = false;
    toast('Auto camera');
    return;
  }
  renderer.manual = renderer.currentManual();
  updateSettings({ autoCamera: false });
  store.manualCamera.value = true;
  store.cameraLocked.value = false;
  toast('Free look — drag to pan, wheel to zoom, C to follow at this zoom');
}

export function toggleReducedMotion() {
  updateSettings({ reducedMotion: !store.settings.value.reducedMotion });
  syncRendererSettings();
  scheduleRecompile();
  toast(store.settings.value.reducedMotion ? 'Reduced motion on' : 'Reduced motion off');
}

/**
 * Take the camera off the director, starting from exactly where it is now.
 *
 * Continuity is the point: whatever framing you were looking at is the framing
 * you keep, so taking control never moves the picture under you.
 */
function takeManualCamera(): ManualCamera | null {
  if (!renderer) return null;
  if (!renderer.manual) {
    renderer.zoomLock = null;
    store.cameraLocked.value = false;
    renderer.manual = renderer.currentManual();
    store.manualCamera.value = true;
    updateSettings({ autoCamera: false });
  }
  return renderer.manual;
}

export function panCamera(dx: number, dy: number) {
  const m = takeManualCamera();
  if (!m || !renderer) return;
  renderer.manual = { ...m, x: m.x - dx / m.scale, y: m.y - dy / m.scale };
}

/**
 * The furthest out the viewer may go: the whole picture, plus a margin.
 *
 * Derived from the history rather than fixed, because "too far out" means
 * something different for eleven commits and for a million.
 */
function minimumScale(): number {
  const perf = store.perf.peek();
  if (!renderer || !perf) return 0.05;
  const b = perf.bounds;
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const vp = renderer.viewport();
  const fit = Math.min((vp.worldW * vp.scale) / w, (vp.worldH * vp.scale) / h);
  // A quarter again beyond a perfect fit: enough air to see that the history
  // ends, not enough to lose it.
  return fit / 1.25;
}

export function zoomCamera(factor: number, sx?: number, sy?: number) {
  const m = takeManualCamera();
  if (!m || !renderer) return;
  const before = sx != null && sy != null ? renderer.screenToWorld(sx, sy) : null;
  // How far out you may go: far enough to see the whole history with a margin
  // around it, and not one scroll further.
  //
  // The floor used to be a fixed 0.05, which on a large history is a hundred
  // times further out than the picture — the performance became a hairline in
  // the middle of an empty screen and there was no way back except scrolling
  // until it happened to fit. A "frame the whole history" button existed to
  // rescue people from that, which is a button that exists because a limit
  // does not. The limit is better: you cannot get lost, so nothing has to find
  // you.
  const scale = Math.max(minimumScale(), Math.min(12, m.scale * factor));
  renderer.manual = { ...m, scale };
  if (before && sx != null && sy != null) {
    const after = renderer.screenToWorld(sx, sy);
    renderer.manual = { ...renderer.manual, x: renderer.manual.x + (before.x - after.x), y: renderer.manual.y + (before.y - after.y) };
  }
}

/**
 * Reviewing the finished picture.
 *
 * When the performance ends the director frames the whole history at once,
 * which is the right final image and the wrong way to look at any particular
 * part of it. These let a viewer travel the finished piece from end to end at
 * whatever magnification they are already at, rather than having to choose
 * between seeing everything small and losing their place.
 */
let spanCache: { perf: CompiledPerformance; min: number; max: number } | null = null;

/** Horizontal extent of the whole picture, with a little air at both ends. */
export function contentSpan(): { min: number; max: number } | null {
  const p = store.perf.value;
  if (!p || !p.nodes.length) return null;
  if (spanCache && spanCache.perf === p) return spanCache;
  let min = Infinity;
  let max = -Infinity;
  for (const n of p.nodes) {
    if (n.x < min) min = n.x;
    if (n.x > max) max = n.x;
  }
  // No padding. The slider's ends are the first and last commit exactly: air
  // beyond them is travel that shows nothing, and at the right-hand end it
  // reads as the history having stopped early.
  spanCache = { perf: p, min, max };
  return spanCache;
}

/**
 * Where the camera sits along that extent, and how much of it is on screen.
 * The second number is what lets the control show the size of your window on
 * the history the way a scrollbar does.
 */
/**
 * The range the camera centre may occupy.
 *
 * The travel is bounded by the *window*, not by the centre: at either extreme
 * the edge of what you can see lines up with the edge of the history, so there
 * is no way to slide off into blank space. When the whole picture already fits
 * on screen the range collapses and there is nothing to travel.
 */
function exploreRange(worldW: number): { lo: number; hi: number; span: number } | null {
  const span = contentSpan();
  if (!span) return null;
  const width = Math.max(1, span.max - span.min);
  const half = Math.min(worldW, width) / 2;
  const lo = span.min + half;
  const hi = span.max - half;
  return { lo, hi: Math.max(lo, hi), span: width };
}

/**
 * Where the camera sits along that extent, and how much of it is on screen.
 * The second number is what lets the control show the size of your window on
 * the history the way a scrollbar does.
 */
/** Whether the viewer is holding the camera rather than the director. */
export function cameraIsManual(): boolean {
  return !!renderer?.manual;
}

export function exploreState(): { at: number; visible: number } | null {
  if (!renderer) return null;
  const vp = renderer.viewport();
  const r = exploreRange(vp.worldW);
  if (!r) return null;
  const travel = r.hi - r.lo;
  return {
    at: travel < 1e-6 ? 0.5 : Math.max(0, Math.min(1, (vp.cx - r.lo) / travel)),
    visible: Math.max(0.02, Math.min(1, vp.worldW / r.span)),
  };
}

/**
 * Travel to a fraction of the whole picture, holding the zoom you are at and
 * never letting the view leave the history.
 */
export function exploreTo(f: number) {
  const m = takeManualCamera();
  if (!m || !renderer) return;
  const r = exploreRange(renderer.viewport().worldW);
  if (!r) return;
  renderer.manual = { ...m, x: r.lo + Math.max(0, Math.min(1, f)) * (r.hi - r.lo) };
}

/**
 * The repository's own date at a point in the picture. Layout x is natural
 * historical time, so the nearest node's landing is the honest answer — and it
 * is a real commit's date rather than an interpolation between two.
 */
export function dateAtFraction(f: number): number | null {
  const p = store.perf.value;
  const r = renderer ? exploreRange(renderer.viewport().worldW) : null;
  if (!r || !p || !p.nodes.length) return null;
  const x = r.lo + Math.max(0, Math.min(1, f)) * (r.hi - r.lo);
  let best = p.nodes[0]!;
  let bestD = Infinity;
  for (const n of p.nodes) {
    const d = Math.abs(n.x - x);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return player.historicalAt(best.impact);
}

/** Re-fetch the current repository, ignoring anything already cached. */
export function refetchCurrent() {
  const src = store.perf.value?.source;
  if (!src || src.provider !== 'github') return;
  void loadRepo(`${src.owner}/${src.name}`, { autoplay: true, forceRefresh: true });
}

export function pickAt(sx: number, sy: number) {
  if (!renderer) return { node: null, aggregateEdge: null };
  return renderer.pick(sx, sy, player.t);
}

export function selectNode(idx: number | null) {
  store.selectedNode.value = idx;
  if (idx != null) store.panel.value = 'inspector';
  syncRendererSettings();
}

export function hoverNode(idx: number | null) {
  if (store.hoverNode.peek() !== idx) {
    store.hoverNode.value = idx;
    syncRendererSettings();
  }
}

export function selectThread(idx: number | null) {
  store.selectedThread.value = idx;
  syncRendererSettings();
}

export function focusContributor(id: string | null) {
  store.contributorFocus.value = id;
  syncRendererSettings();
}

/* ---------------- share & export ---------------- */

export function shareLink(): string {
  const perf = store.perf.value;
  const s = store.settings.value;
  const hash = buildShareHash({
    repo: lastRepo ? lastRepo.slug : null,
    tip: perf?.source.provider === 'github' ? perf.source.selectedTipSha : null,
    t: Math.round(player.t * 100) / 100,
    duration: store.durationOverride.value,
    seed: s.seed,
    focus: store.contributorFocus.value,
    reducedMotion: s.reducedMotion,
    demo: store.isDemo.value,
    autoplay: true,
  });
  return `${location.origin}${location.pathname}${hash}`;
}

export async function copyShareLink() {
  const link = shareLink();
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copied');
  } catch {
    toast('Copy failed — the link is shown in the Share panel');
  }
  return link;
}

export async function exportPng() {
  if (!renderer) return;
  const blob = await renderer.toBlob('image/png');
  if (!blob) return;
  const perf = store.perf.value;
  downloadBlob(blob, `${perf ? `${perf.source.owner}-${perf.source.name}` : 'gittimeline'}-${fmtClock(player.t).replace(':', 'm')}s.png`);
  toast('PNG saved');
}

export async function exportArtifact() {
  const ds = store.dataset.value;
  if (!ds) return;
  const artifact = createArtifact(ds, { preset: presetFromSettings(), seed: store.settings.value.seed });
  const blob = await serializeArtifact(artifact, true);
  downloadBlob(blob, `${ds.source.owner}-${ds.source.name}.gittimeline`);
  toast('Artifact saved');
}

export function exportTranscript() {
  if(catalogSource){
    const a=document.createElement('a');a.href=new URL(store.catalogManifest.value!.transcript,catalogSource.url).href;a.download='history-transcript.txt.gz';a.click();return;
  }
  const perf = store.perf.value;
  if (!perf) return;
  const text = [`# ${perf.source.owner}/${perf.source.name} — GitTimeline transcript`, '', perf.coverage.summary, '', ...perf.transcript].join('\n');
  downloadBlob(new Blob([text], { type: 'text/markdown' }), `${perf.source.owner}-${perf.source.name}-transcript.md`);
  toast('Transcript saved');
}

export function exportPlanJson() {
  const perf = store.perf.value;
  if (!perf) return;
  const plan = { engine: perf.engine, seed: perf.seed, preset: perf.preset, duration: perf.duration, planHash: perf.planHash, events: perf.events, camera: perf.camera, tempoMap: perf.tempoMap, timeMap: perf.timeMap, eras: perf.eras, coverage: perf.coverage };
  downloadBlob(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }), `${perf.source.owner}-${perf.source.name}-plan.json`);
  toast('Plan JSON saved');
}

export function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!canvasEl && typeof canvasEl.captureStream === 'function';
}

export function toggleRecording() {
  if (recorder) {
    recorder.stop();
    return;
  }
  if (!canRecord() || !canvasEl) {
    toast('Video capture is not supported in this browser');
    return;
  }
  const stream = canvasEl.captureStream(60);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
  } catch {
    toast('Video capture failed to start');
    recorder = null;
    return;
  }
  recordedChunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) recordedChunks.push(e.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const perf = store.perf.value;
    downloadBlob(blob, `${perf ? `${perf.source.owner}-${perf.source.name}` : 'gittimeline'}.webm`);
    recorder = null;
    store.recording.value = false;
    toast('WebM saved (silent capture)');
  };
  recorder.start(250);
  store.recording.value = true;
  toast('Recording — press again to stop');
  if (!player.playing) play();
}

/* ---------------- keyboard ---------------- */

export function handleKey(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
  if (typing && e.key !== 'Escape') return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const hasPerf = !!player.perf;
  // A shortcut never eats a control's own key.
  //
  // Every one of these returns `true`, and the listener in `App` turns that
  // into `preventDefault()` — so any key claimed here is taken away from
  // whatever has focus. Space is the one that matters: it is how a keyboard
  // user presses a button, and because the landing page keeps a demo compiled
  // behind the form `hasPerf` is *always* true, so Space was claimed on every
  // screen. Measured, it activated nothing anywhere — not the catalog cards,
  // not the scope dialog's own button, not Cancel on a 153 MB download — and
  // silently paused the demo behind the page instead.
  const activatable =
    !!target && (target.tagName === 'BUTTON' || target.tagName === 'A' || target.getAttribute('role') === 'button');
  if (activatable && (e.key === ' ' || e.key === 'Enter')) return false;
  switch (e.key) {
    case ' ':
      if (!hasPerf) return false;
      togglePlay();
      return true;
    case 'ArrowLeft':
      if (!hasPerf) return false;
      if (e.shiftKey) jumpLandmark(-1);
      else stepUnit(-1);
      return true;
    case 'ArrowRight':
      if (!hasPerf) return false;
      if (e.shiftKey) jumpLandmark(1);
      else stepUnit(1);
      return true;
    case 'ArrowUp':
    case 'ArrowDown': {
      if (!hasPerf) return false;
      const perf = player.perf!;
      const active = perf.threads.filter((t) => t.start <= player.t);
      if (!active.length) return true;
      const cur = store.selectedThread.value;
      const i = cur == null ? -1 : active.findIndex((t) => t.idx === cur);
      const next = e.key === 'ArrowUp' ? (i <= 0 ? active.length - 1 : i - 1) : (i + 1) % active.length;
      const th = active[next]!;
      selectThread(th.idx);
      announce(`Thread ${th.label ?? th.id}, ${th.nodeIdxs.length} commits, ${th.ending}`, true);
      return true;
    }
    case 'm':
    case 'M':
      toggleMute();
      return true;
    case 'c':
    case 'C':
      if (!hasPerf) return false;
      toggleAutoCamera();
      return true;
    case '?':
      store.panel.value = store.panel.value === 'help' ? 'none' : 'help';
      return true;
    case 'Home':
      if (!hasPerf) return false;
      seek(0);
      return true;
    case 'End':
      if (!hasPerf) return false;
      seek(player.duration);
      return true;
    case 'Escape':
      // Outermost thing first. A dialog, and then a load in progress, both sit
      // in front of everything else on this list, and neither was consulted:
      // Escape on the scope chooser left it open, and Escape 8.7s into a
      // 153 MB download was swallowed — `handleKey` claimed the key, cancelled
      // the browser's default, and did nothing with it, so the load ran to
      // completion and started playing.
      if (store.scope.value) {
        dismissScope();
        return true;
      }
      if (store.error.value || isBusy.value) {
        cancel();
        return true;
      }
      if (store.panel.value !== 'none') store.panel.value = 'none';
      else if (store.selectedNode.value != null || store.selectedThread.value != null || store.contributorFocus.value) {
        selectNode(null);
        selectThread(null);
        focusContributor(null);
      } else if (store.mode.value === 'player' && !hasPerf) store.mode.value = 'landing';
      return true;
    default:
      return false;
  }
}

/* ---------------- test/debug hook ---------------- */

/** Read-only inspection surface for end-to-end tests and the choreography lab. Never used by the UI. */
export function installDebugHook() {
  const api = {
    get time() {
      return player.t;
    },
    get playing() {
      return player.playing;
    },
    get phase() {
      return store.phase.value;
    },
    get mode() {
      return store.mode.value;
    },
    get duration() {
      return player.duration;
    },
    get stats() {
      return store.perf.value?.stats ?? null;
    },
    get source() {
      const s = store.perf.value?.source;
      return s ? { provider: s.provider, slug: `${s.owner}/${s.name}` } : null;
    },
    get planHash() {
      return store.perf.value?.planHash ?? null;
    },
    /** Arrivals in the plan, and the pace they land at — what the card quotes. */
    get pace() {
      const p = store.perf.value;
      return p ? { nodes: p.nodes.length, perSecond: planPace(p) } : null;
    },
    /**
     * How long each calendar year of this plan runs, for the catalog indexer.
     *
     * The shelf has to price a span before anything is downloaded, and the only
     * place this can be measured is a loaded plan. The indexer opens every entry
     * anyway; this is read off the same open.
     */
    get years() {
      const p = store.perf.value;
      return p ? planYears(p) : null;
    },
    get camera() {
      return renderer?.camera ?? null;
    },
    get manualCamera() {
      return !!renderer?.manual;
    },
    get zoomLocked() {
      return renderer?.zoomLock != null;
    },
    get viewport() {
      return renderer?.viewport() ?? null;
    },
    /** The artifact this repository would export, base64, for the catalog build. */
    async artifact(): Promise<string | null> {
      const ds = store.dataset.value;
      if (!ds) return null;
      const blob = await serializeArtifact(createArtifact(ds, { preset: presetFromSettings(), seed: store.settings.value.seed }), true);
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    /** A static SVG of this history's shape. Exact, and large. */
    posterSvg(): string | null {
      const perf = store.perf.value;
      return perf ? renderPosterSvg(perf) : null;
    },
    get compileStage() {
      return store.compileStage.value;
    },
    get progress() {
      return store.progress.value;
    },
    get settings() {
      return store.settings.value;
    },
    get waveform() {
      return store.perf.value ? Array.from(store.perf.value.waveform) : null;
    },
    get nodeX() {
      return store.perf.value ? store.perf.value.nodes.map((n) => n.x) : null;
    },
    /** Answer the scope question with an arbitrary span, for the catalog build. */
    chooseScope(since: string | null, until: string | null, label: string) {
      chooseScope({ since, until, label });
    },
    /** Load a .gittimeline artifact straight from a URL, for experiments. */
    async loadArtifact(url: string) {
      const res = await fetch(url);
      const blob = await res.blob();
      await loadArtifactFile(new File([blob], 'artifact.gittimeline.gz'));
    },
    /** Force a target duration and recompile, to explore density. */
    setDuration(seconds: number) {
      store.durationOverride.value = seconds > 0 ? seconds : null;
      scheduleRecompile();
    },
    loadFixture(id: string) {
      void loadFixture(id);
    },
    zoom(factor: number) {
      zoomCamera(factor);
    },
    get audioStarted() {
      return audio.started;
    },
    /**
     * Per-pass timings and counts for the last frames drawn. Inert until
     * `enabled` is set, and the only way to ask "did the stage draw anything"
     * on a history too large to photograph.
     *
     * Reading the pixels back is the obvious way and it does not work here:
     * the stage is a `desynchronized` canvas, and above roughly forty thousand
     * nodes both `page.screenshot` and `canvas.toDataURL` stall indefinitely
     * rather than returning a blank image. `counts.nodesDrawn` costs nothing
     * and answers the same question.
     */
    get render() {
      return renderProfile;
    },
    /** The world rectangle the camera is looking at, and the window loaded for it. */
    get view() {
      const v = renderer?.viewport() ?? null;
      const w = store.perf.value?.window ?? null;
      const xs = store.perf.value?.nodes;
      let lo = null, hi = null;
      if (xs && xs.length) { lo = xs[0]!.x; hi = xs[0]!.x; for (const n of xs) { if (n.x < lo) lo = n.x; if (n.x > hi) hi = n.x; } }
      return v ? { ...v, window: w ? { start: w.start, end: w.end, minX: w.minX, maxX: w.maxX } : null, geomMinX: lo, geomMaxX: hi } : null;
    },
    /**
     * Where a catalog file actually lives, and whether that is off-site.
     *
     * The shelf used to be published with the site, so anything wanting it
     * could assume `/catalog/`. It is served from an object store now, and a
     * caller that still assumes the old path gets the SPA's `index.html` with
     * a 200 on it — which fails as a parse error somewhere far away rather
     * than as a missing file. Two end-to-end tests were doing exactly that.
     */
    catalogUrl: (file: string) => catalogUrl(file),
    /**
     * Whether the stage is waiting on a page of a streamed history.
     *
     * A seek into a part of a windowed plan that has not been fetched leaves
     * `player.buffered` false, and the frame loop then skips `render` outright
     * — so nothing is drawn, no frame is counted, and the clock does not move
     * until the page lands. Roughly a second against the object store. The
     * viewer is told ("Loading this part of history…"); a test counting drawn
     * nodes after a fixed wait is not, and read the gap as a blank stage.
     */
    get buffering() {
      return store.buffering.value;
    },
    get catalogIsRemote() {
      return externalCatalog;
    },
    /** Where the MAIN nameplate was drawn last frame. */
    get spineLabel() {
      return renderer?.spineLabel ?? null;
    },
    get music() {
      const now = audio.nowPlaying;
      return now ? { title: now.title, artist: now.artist, playing: audio.playing } : null;
    },
    /** Bodies (performers/pulses) travelling at the current time, with their screen positions. */
    bodies() {
      const perf = store.perf.value;
      if (!perf || !renderer) return [];
      const t = player.t;
      return perf.edges
        .filter((e) => e.start <= t && e.end >= t)
        .map((e) => {
          const f = (t - e.start) / Math.max(1e-6, e.end - e.start);
          const i = Math.min(e.pts.length / 2 - 1, Math.floor(f * (e.pts.length / 2 - 1)));
          const s = renderer!.worldToScreen(e.pts[i * 2]!, e.pts[i * 2 + 1]!);
          return { edge: e.idx, kind: e.kind, body: e.body, thread: e.threadIdx, contributor: e.contributorIdx, progress: f, x: s.x, y: s.y };
        });
    },
    events(type?: string) {
      const perf = store.perf.value;
      if (!perf) return [];
      return perf.events.filter((e) => !type || e.type === type).map((e) => ({ type: e.type, impact: e.performanceImpact, start: e.performanceStart, end: e.performanceEnd, caption: e.caption }));
    },
    setToken: (t: string | null) => (store.token.value = t || null),
    seek: (t: number) => seek(t),
    play: () => play(),
    pause: () => pause(),
  };
  (window as unknown as { __gittimeline: typeof api }).__gittimeline = api;
}

/* ---------------- boot ---------------- */

/** Render quality follows the device rather than asking the viewer to guess. */
function chooseQuality(): 'full' | 'reduced' | 'minimal' {
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  const small = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 500;
  if (cores <= 2 || mem <= 2) return 'minimal';
  if (cores <= 4 || small) return 'reduced';
  return 'full';
}

export async function boot() {
  installDebugHook();
  updateSettings({ quality: chooseQuality() });
  void refreshRecent();
  void cache.estimate().then((e) => (store.storage.value = e));
  const share = parseShareHash(location.hash);
  if (share.renderer === 'poster') {
    store.rendererMode.value = 'poster';
    store.banner.value = { kind: 'fallback', message: 'Poster mode: Canvas rendering is unavailable or was switched off, so the exact topology is drawn as a static SVG with a navigable event list.' };
  }
  if (share.reducedMotion != null) updateSettings({ reducedMotion: share.reducedMotion });
  if (share.duration) store.durationOverride.value = share.duration;
  if (share.seed) updateSettings({ seed: share.seed });
  if (share.focus) store.contributorFocus.value = share.focus;
  if (share.fixture) {
    await loadFixture(share.fixture, share.autoplay);
    if (share.t != null) player.seek(share.t);
    return;
  }
  if (share.repo) {
    store.input.value = share.repo;
    await loadRepo(share.repo, { autoplay: share.autoplay, tip: share.tip, startAt: share.t ?? 0 });
    return;
  }
  if (share.demo || share.gallery) {
    await loadDemo({ autoplay: share.autoplay || share.gallery, landing: false, startAt: share.t ?? 0 });
    if (share.gallery) store.chromeHidden.value = true;
    return;
  }
  // Landing: the demo performs softly behind the form.
  //
  // The URL is cleaned up first — the token must not sit in the address bar
  // for the length of a compile — but what it *says* waits until the demo is
  // loaded, since loading one is entitled to clear whatever the last one left
  // on screen. Announcing a sign-in before that is announcing it to the next
  // line of code.
  const signIn = claimTokenFromUrl();
  await loadDemo({ autoplay: true, landing: true });
  if (signIn === 'token') toast('Signed in with GitHub — about 5,000 requests an hour');
  else if (signIn === 'failed') toast(SIGN_IN_FAILED, 9000);
}
