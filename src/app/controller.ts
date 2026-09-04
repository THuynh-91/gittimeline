import { batch } from '@preact/signals';
import { store, updateSettings, toast, announce, type AppError } from './store';
import { Player } from '@/player/player';
import { AudioEngine } from '@/audio/engine';
import { StageRenderer, type ManualCamera } from '@/renderer/canvas';
import { renderPosterSvg } from '@/renderer/poster';
import { compileInWorker, type CompileHandle } from '@/player/compileClient';
import { parseRepoUrl, type RepoRef } from '@/github/url';
import { GitHubClient, GitHubError } from '@/github/adapter';
import { ApiCache } from '@/github/cache';
import { ingestRepository, probeRepository, type IngestOutcome } from '@/github/ingest';
import { formatReset } from '@/github/ratelimit';
import { willOutrunTheCeiling } from '@/choreography/pace';
import { buildDemoDataset } from '@/fixtures/demo';
import { fixtureById } from '@/fixtures/corpus';
import type { CompiledPerformance, Dataset, PlaybackPreset } from '@/model/types';
import { buildShareHash, parseShareHash } from '@/export/share';
import { createArtifact, downloadBlob, parseArtifact, serializeArtifact } from '@/export/artifact';
import { fmtClock } from '@/choreography/events';
import { claimTokenFromUrl } from './auth';

/**
 * Orchestration: ingestion runs, compilation, the frame loop, keyboard,
 * sharing and export. UI components only call into this module.
 */
export const player = new Player();
export const audio = new AudioEngine();
export const cache = new ApiCache();
let renderer: StageRenderer | null = null;
let canvasEl: HTMLCanvasElement | null = null;

interface Run {
  id: number;
  abort: AbortController;
  compile: CompileHandle | null;
}
let run: Run | null = null;
let runCounter = 0;
let lastRepo: RepoRef | null = null;
let lastInputForRetry: string | null = null;
let returnToLanding = false;
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
  renderer.settings = {
    ...renderer.settings,
    reducedMotion: s.reducedMotion,
    noFlash: s.noFlash,
    highContrast: s.highContrast,
    quality: s.quality,
    labels: s.labels,
    showGlyphs: s.showGlyphs,
    contributorFocus: store.contributorFocus.value,
    selectedNode: store.selectedNode.value,
    hoverNode: store.hoverNode.value,
    selectedThread: store.selectedThread.value,
  };
  renderer.attenuation = store.mode.value === 'landing' ? 0.85 : 1;
  audio.levels = { master: 0.7, effects: s.effectsLevel, muted: s.muted };
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
  player.advance(dt);
  const t = player.t;
  if (renderer) {
    renderer.render(t, dt);
    const cam = renderer.camera;
    if (cam && cam.state !== store.cameraState.peek()) store.cameraState.value = cam.state;
  }
  if (perf && player.playing) {
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

player.on('play', () => {
  store.playing.value = true;
  store.phase.value = 'PLAYING';
  audio.resume();
});
player.on('pause', () => {
  store.playing.value = false;
  if (store.phase.value === 'PLAYING') store.phase.value = 'PAUSED';
  audio.reset();
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
  if (store.settings.value.loopPerformance || store.mode.value === 'landing') {
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
    if (!store.perf.value || returnToLanding) store.mode.value = 'landing';
  });
  returnToLanding = false;
  syncRendererSettings();
}

function stageLabel(stage: string): string {
  return { graph: 'Reading the commit graph…', threads: 'Finding parallel threads…', activity: 'Measuring activity…', clock: 'Setting the tempo…', layout: 'Laying out the stage…', events: 'Writing the choreography…', camera: 'Directing the camera…', done: 'Ready' }[stage] ?? stage;
}

async function compileAndLoad(r: Run, dataset: Dataset, opts: { autoplay: boolean; startAt?: number; outcome: IngestOutcome | 'synthetic' | 'artifact'; isDemo: boolean }): Promise<CompiledPerformance | null> {
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

function loadPerformance(perf: CompiledPerformance, dataset: Dataset, opts: { autoplay: boolean; startAt?: number; outcome: IngestOutcome | 'synthetic' | 'artifact'; isDemo: boolean }) {
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
    const degraded = opts.outcome === 'partial' || opts.outcome === 'rate-limited' || opts.outcome === 'offline-cached';
    store.phase.value = degraded ? 'DEGRADED_READY' : 'READY';
    if (store.rendererMode.value === 'poster') {
      /* keep the poster banner */
    } else if (opts.outcome === 'rate-limited') store.banner.value = { kind: 'rate-limited', message: `${perf.coverage.summary} GitHub’s request limit was reached; retry ${formatReset(null)}.` };
    else if (opts.outcome === 'offline-cached') store.banner.value = { kind: 'offline', message: `Served from your local cache. ${perf.coverage.summary}` };
    else if (opts.outcome === 'partial') store.banner.value = { kind: 'partial', message: perf.coverage.summary };
    else store.banner.value = null;
  });
  player.load(perf, opts.startAt ?? 0);
  releaseCamera();
  captionPtr = 0;
  renderer?.setPerformance(perf);
  audio.setPerformance(perf);
  syncRendererSettings();
  startLoop();
  announce(`${perf.source.owner}/${perf.source.name} is ready: ${perf.stats.commits} commits, ${perf.stats.threads} threads, ${Math.round(perf.duration)} seconds.`);
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

export async function loadDemo(opts: { autoplay: boolean; landing: boolean; startAt?: number } = { autoplay: true, landing: false }) {
  if (!opts.landing) primeAudio();
  const r = newRun();
  lastRepo = null;
  partialDataset = null;
  const ds = buildDemoDataset();
  batch(() => {
    store.mode.value = opts.landing ? 'landing' : 'player';
    if (store.rendererMode.value !== 'poster') store.banner.value = null;
    store.error.value = null;
  });
  await compileAndLoad(r, ds, { autoplay: opts.autoplay, startAt: opts.startAt, outcome: 'synthetic', isDemo: true });
  // Behind the landing form, open on the demo's most alive moment. The first
  // second of any history is a single commit on an otherwise empty stage,
  // which is the least interesting thing the app can show.
  if (opts.landing && opts.startAt == null) seekToLiveliest();
}

/**
 * Jump to where the current performance looks like something.
 *
 * The widest parallel phrase is the most *interesting* moment, but early in a
 * history it can still be three commits on an empty stage. Taking the later of
 * that and roughly two-thirds through means most of the graph has been drawn
 * and the picture still has movement in it, rather than the settled, dimmed
 * final tableau.
 */
function seekToLiveliest() {
  const p0 = store.perf.value;
  if (!p0) return;
  const widest = p0.events
    .filter((e) => e.type === 'PARALLEL_PHRASE')
    .sort((a, b) => b.performanceEnd - b.performanceStart - (a.performanceEnd - a.performanceStart))[0];
  const phrase = widest ? Math.max(0, widest.performanceStart - 1.5) : 0;
  player.seek(Math.max(phrase, p0.duration * 0.62));
}

/**
 * Back to the landing page, with something worth looking at behind it.
 *
 * Returning used to leave whatever had been loaded frozen on the stage, so the
 * page a visitor came back to was a still frame of a finished performance
 * rather than the moving one they arrived at.
 */
export function showLanding() {
  if (store.isDemo.value && store.perf.value) {
    store.mode.value = 'landing';
    releaseCamera();
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
  store.mode.value = 'player';
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
  returnToLanding = store.mode.value === 'landing';
  primeAudio();
  batch(() => {
    store.mode.value = 'player';
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
    store.mode.value = 'player';
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
 */
export async function loadCatalogEntry(file: string, label: string) {
  const r = newRun();
  batch(() => {
    store.mode.value = 'player';
    store.error.value = null;
    store.banner.value = null;
    store.phase.value = 'FETCHING_TOPOLOGY';
    store.progress.value = { phase: 'normalizing', message: `Opening ${label}`, pagesLoaded: 0, commitsLoaded: 0, reportedTotal: null, rate: null, repoName: label, fromCache: true };
  });
  primeAudio();
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}catalog/${file}`, { signal: r.abort.signal });
    if (!res.ok) throw new Error(`catalog entry unavailable (${res.status})`);
    const { dataset } = await parseArtifact(await res.blob());
    if (run?.id !== r.id) return;
    lastRepo = null;
    await compileAndLoad(r, dataset, { autoplay: true, outcome: 'artifact', isDemo: false });
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

export async function loadArtifactFile(file: File) {
  const r = newRun();
  store.mode.value = 'player';
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
  if (fromLanding) store.mode.value = 'player';
  const atEnd = player.t >= player.duration - 1e-3;
  if (fromLanding || atEnd) restart();
  syncRendererSettings();
  player.play();
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
  player.seek(0);
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
    announce(`${l.kind}: ${l.label} at ${fmtClock(l.time)}`);
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

export function zoomCamera(factor: number, sx?: number, sy?: number) {
  const m = takeManualCamera();
  if (!m || !renderer) return;
  const before = sx != null && sy != null ? renderer.screenToWorld(sx, sy) : null;
  const scale = Math.max(0.05, Math.min(12, m.scale * factor));
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
      announce(`Thread ${th.label ?? th.id}, ${th.nodeIdxs.length} commits, ${th.ending}`);
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
    get waveform() {
      return store.perf.value ? Array.from(store.perf.value.waveform) : null;
    },
    get nodeX() {
      return store.perf.value ? store.perf.value.nodes.map((n) => n.x) : null;
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
  if (claimTokenFromUrl()) toast('Signed in with GitHub — about 5,000 requests an hour');
  await loadDemo({ autoplay: true, landing: true });
}
