import { batch } from '@preact/signals';
import { store, updateSettings, toast, announce, type AppError } from './store';
import { Player } from '@/player/player';
import { AudioEngine } from '@/audio/engine';
import { StageRenderer } from '@/renderer/canvas';
import { compileInWorker, type CompileHandle } from '@/player/compileClient';
import { parseRepoUrl, type RepoRef } from '@/github/url';
import { GitHubClient, GitHubError } from '@/github/adapter';
import { ApiCache } from '@/github/cache';
import { ingestRepository, type IngestOutcome } from '@/github/ingest';
import { formatReset } from '@/github/ratelimit';
import { buildDemoDataset } from '@/fixtures/demo';
import { fixtureById } from '@/fixtures/corpus';
import type { CompiledPerformance, Dataset, PlaybackPreset } from '@/model/types';
import { buildShareHash, parseShareHash } from '@/export/share';
import { createArtifact, downloadBlob, parseArtifact, serializeArtifact } from '@/export/artifact';
import { fmtClock } from '@/choreography/events';

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
let recordedChunks: Blob[] = [];

export function presetFromSettings(): PlaybackPreset {
  const s = store.settings.value;
  return { id: 'cinematic', version: 1, targetDuration: s.targetDuration, reducedMotion: s.reducedMotion, aggregateAbove: 900 };
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
  audio.levels = { master: 0.7, effects: s.effectsLevel, ambient: s.ambientLevel, muted: s.muted };
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

export async function loadRepo(input: string, opts: { autoplay?: boolean; tip?: string | null; startAt?: number } = {}): Promise<void> {
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
  const r = newRun();
  partialDataset = null;
  batch(() => {
    store.mode.value = 'player';
    store.phase.value = 'FETCHING_METADATA';
    store.error.value = null;
    store.banner.value = null;
    store.progress.value = { phase: 'validating', message: 'Validating…', pagesLoaded: 0, commitsLoaded: 0, reportedTotal: null, rate: null, repoName: repo.slug, fromCache: false };
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
      maxPages: store.token.value ? 400 : 40,
      pinnedTip: opts.tip ?? null,
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
    const perf = await compileAndLoad(r, ds, { autoplay: opts.autoplay ?? true, startAt: opts.startAt, outcome: result.outcome, isDemo: false });
    if (perf && result.outcome === 'rate-limited') store.banner.value = { kind: 'rate-limited', message: `${ds.coverage.summary} GitHub’s request limit was reached; it resets ${formatReset(result.resetAt)}.` };
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
      const rateMsg = err.kind === 'rate-limited' ? ` It resets ${formatReset(err.rate?.resetAt ?? null)}. Anonymous requests are limited per network by GitHub; GitDance cannot bypass that.` : '';
      fail({ kind: err.kind, title: titles[err.kind] ?? 'Something went wrong', message: err.message + rateMsg, resetAt: err.rate?.resetAt ?? null, canPlayPartial: false, retry: err.kind !== 'not-found' && err.kind !== 'blocked' });
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

export async function loadArtifactFile(file: File) {
  const r = newRun();
  store.mode.value = 'player';
  store.phase.value = 'BUILDING_DAG';
  store.error.value = null;
  try {
    const { dataset, options } = await parseArtifact(file);
    if (run?.id !== r.id) return;
    if (options?.preset) updateSettings({ targetDuration: options.preset.targetDuration, seed: options.seed });
    lastRepo = null;
    await compileAndLoad(r, dataset, { autoplay: true, outcome: 'artifact', isDemo: false });
    store.banner.value = { kind: 'info', message: `Loaded from a .gitdance artifact (${dataset.coverage.summary})` };
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
  if (store.mode.value === 'landing') store.mode.value = 'player';
  syncRendererSettings();
  player.play();
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

export function panCamera(dx: number, dy: number) {
  if (!renderer) return;
  if (!renderer.manual) {
    renderer.zoomLock = null;
    store.cameraLocked.value = false;
    renderer.manual = renderer.currentManual();
    store.manualCamera.value = true;
    updateSettings({ autoCamera: false });
  }
  renderer.manual = { ...renderer.manual, x: renderer.manual.x - dx / renderer.manual.scale, y: renderer.manual.y - dy / renderer.manual.scale };
}

export function zoomCamera(factor: number, sx?: number, sy?: number) {
  if (!renderer) return;
  if (!renderer.manual) {
    renderer.zoomLock = null;
    store.cameraLocked.value = false;
    renderer.manual = renderer.currentManual();
    store.manualCamera.value = true;
    updateSettings({ autoCamera: false });
  }
  const m = renderer.manual;
  const before = sx != null && sy != null ? renderer.screenToWorld(sx, sy) : null;
  const scale = Math.max(0.05, Math.min(12, m.scale * factor));
  renderer.manual = { ...m, scale };
  if (before && sx != null && sy != null) {
    const after = renderer.screenToWorld(sx, sy);
    renderer.manual = { ...renderer.manual, x: renderer.manual.x + (before.x - after.x), y: renderer.manual.y + (before.y - after.y) };
  }
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
    duration: s.targetDuration,
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
  downloadBlob(blob, `${perf ? `${perf.source.owner}-${perf.source.name}` : 'gitdance'}-${fmtClock(player.t).replace(':', 'm')}s.png`);
  toast('PNG saved');
}

export async function exportArtifact() {
  const ds = store.dataset.value;
  if (!ds) return;
  const artifact = createArtifact(ds, { preset: presetFromSettings(), seed: store.settings.value.seed });
  const blob = await serializeArtifact(artifact, true);
  downloadBlob(blob, `${ds.source.owner}-${ds.source.name}.gitdance`);
  toast('Artifact saved');
}

export function exportTranscript() {
  const perf = store.perf.value;
  if (!perf) return;
  const text = [`# ${perf.source.owner}/${perf.source.name} — GitDance transcript`, '', perf.coverage.summary, '', ...perf.transcript].join('\n');
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
    downloadBlob(blob, `${perf ? `${perf.source.owner}-${perf.source.name}` : 'gitdance'}.webm`);
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
    case 'r':
    case 'R':
      toggleReducedMotion();
      return true;
    case 'e':
    case 'E':
      store.panel.value = store.panel.value === 'events' ? 'none' : 'events';
      return true;
    case 'i':
    case 'I':
      store.panel.value = store.panel.value === 'data' ? 'none' : 'data';
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
    seek: (t: number) => seek(t),
    play: () => play(),
    pause: () => pause(),
  };
  (window as unknown as { __gitdance: typeof api }).__gitdance = api;
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
  if (share.duration) updateSettings({ targetDuration: share.duration });
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
  await loadDemo({ autoplay: true, landing: true });
}
