import { signal, computed } from '@preact/signals';
import type { ChoreographyEvent, CompiledPerformance, Dataset } from '@/model/types';
import type { IngestOutcome, IngestProgress } from '@/github/ingest';
import type { RateInfo } from '@/github/ratelimit';
import type { RecentRepo } from '@/github/cache';
import type { Quality } from '@/renderer/canvas';

/**
 * Explicit application state (spec §20.3). Playback time is published at a
 * throttled rate so UI re-renders never sit inside the frame loop.
 */
export type AppPhase =
  | 'IDLE'
  | 'VALIDATING_URL'
  | 'FETCHING_METADATA'
  | 'FETCHING_TOPOLOGY'
  | 'BUILDING_DAG'
  | 'LAYING_OUT'
  | 'CHOREOGRAPHING'
  | 'READY'
  | 'PLAYING'
  | 'PAUSED'
  | 'DEGRADED_READY'
  | 'RATE_LIMITED'
  | 'OFFLINE_CACHED'
  | 'CANCELLED'
  | 'ERROR_RECOVERABLE'
  | 'ERROR_FATAL';

export type PanelId = 'none' | 'inspector' | 'settings' | 'help';

export interface Settings {
  lengthMode: 'brief' | 'natural' | 'extended';
  reducedMotion: boolean;
  noFlash: boolean;
  highContrast: boolean;
  muted: boolean;
  effectsLevel: number;
  dynamics: 'quiet' | 'standard' | 'dramatic';
  labels: 'minimal' | 'landmarks' | 'all';
  showGlyphs: boolean;
  autoCamera: boolean;
  quality: Quality;
  includeBranches: boolean;
  seed: string;
  timelineScale: 'performance' | 'historical';
  spoilerFree: boolean;
  loopPerformance: boolean;
  captions: boolean;
  keyboardStep: 'beat' | 'commit' | 'second';
  /** Where the commit ledger sits. */
  railDock: 'top' | 'left' | 'right';
  /**
   * The two things a viewer can take off the stage.
   *
   * Both default on, because a first-time visitor needs to know what they are
   * looking at. Once you do, the commit ledger and the player furniture are
   * the only things between you and the picture — so they come off, and what
   * is left is the performance.
   */
  showRail: boolean;
  showControls: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lengthMode: 'natural',
  reducedMotion: false,
  noFlash: false,
  highContrast: false,
  muted: false,
  effectsLevel: 0.7,
  dynamics: 'dramatic',
  labels: 'landmarks',
  showGlyphs: true,
  autoCamera: true,
  quality: 'full',
  includeBranches: true,
  seed: 'gitdance',
  timelineScale: 'performance',
  spoilerFree: false,
  loopPerformance: false,
  captions: true,
  keyboardStep: 'beat',
  railDock: 'top',
  showRail: true,
  showControls: true,
};

export interface AppError {
  kind: string;
  title: string;
  message: string;
  resetAt: number | null;
  canPlayPartial: boolean;
  retry: boolean;
}

export interface Banner {
  kind: 'partial' | 'rate-limited' | 'offline' | 'degraded' | 'fallback' | 'info';
  message: string;
  /** Optional call to action, e.g. re-fetching a cached repository. */
  action?: { label: string; run: () => void };
}

/** What we learned about a large repository before committing to fetching it. */
export interface ScopeQuestion {
  displayName: string;
  estimatedCommits: number | null;
  firstYear: number | null;
  lastYear: number | null;
  /** Why we are asking: too many commits, or too dense to show in full. */
  reason: 'large' | 'dense';
  mergeRatio: number | null;
}

const SETTINGS_KEY = 'gittimeline.settings.v1';

function loadSettings(): Settings {
  let stored: Partial<Settings> = {};
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<Settings>;
  } catch {
    stored = {};
  }
  const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const prefersContrast = typeof matchMedia === 'function' && matchMedia('(prefers-contrast: more)').matches;
  return { ...DEFAULT_SETTINGS, reducedMotion: prefersReduced, highContrast: prefersContrast, ...stored };
}

export const store = {
  phase: signal<AppPhase>('IDLE'),
  mode: signal<'landing' | 'player' | 'catalog' | 'signin'>('landing'),
  input: signal(''),
  inputError: signal<string | null>(null),
  progress: signal<IngestProgress | null>(null),
  compileStage: signal<string | null>(null),
  error: signal<AppError | null>(null),
  banner: signal<Banner | null>(null),
  perf: signal<CompiledPerformance | null>(null),
  dataset: signal<Dataset | null>(null),
  outcome: signal<IngestOutcome | 'synthetic' | 'artifact' | null>(null),
  rate: signal<RateInfo | null>(null),
  time: signal(0),
  playing: signal(false),
  /** Playback rate. 1x is the pace the performance is actually built for. */
  speed: signal(1),
  settings: signal<Settings>(typeof localStorage !== 'undefined' ? loadSettings() : DEFAULT_SETTINGS),
  selectedNode: signal<number | null>(null),
  hoverNode: signal<number | null>(null),
  selectedThread: signal<number | null>(null),
  contributorFocus: signal<string | null>(null),
  panel: signal<PanelId>('none'),
  recent: signal<RecentRepo[]>([]),
  rendererMode: signal<'canvas' | 'poster'>('canvas'),
  manualCamera: signal(false),
  cameraLocked: signal(false),
  caption: signal<ChoreographyEvent | null>(null),
  cameraState: signal<string>('intimate'),
  token: signal<string | null>(null),
  chromeHidden: signal(false),
  announcement: signal(''),
  storage: signal<{ usage: number; quota: number } | null>(null),
  isDemo: signal(false),
  loopRange: signal<{ start: number; end: number } | null>(null),
  /** Explicit duration from a share link, overriding the derived one. */
  durationOverride: signal<number | null>(null),
  scope: signal<ScopeQuestion | null>(null),
  /**
   * Where the travel slider is, 0..1, or null when not travelling.
   *
   * Anything that must follow the *camera* rather than the clock has to read a
   * signal: while the performance is over and the viewer is travelling the
   * finished picture, time does not move, so a component watching the playhead
   * never re-renders and quietly keeps showing the moment the clock stopped.
   */
  travelAt: signal<number | null>(null),
  recording: signal(false),
  toast: signal<string | null>(null),
};

export const isBusy = computed(() => {
  const p = store.phase.value;
  return p === 'VALIDATING_URL' || p === 'FETCHING_METADATA' || p === 'FETCHING_TOPOLOGY' || p === 'BUILDING_DAG' || p === 'LAYING_OUT' || p === 'CHOREOGRAPHING';
});

export function updateSettings(patch: Partial<Settings>) {
  const next = { ...store.settings.value, ...patch };
  store.settings.value = next;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

let toastTimer: number | null = null;
/**
 * Whether the performance has finished playing.
 *
 * Reads signals, so components calling it re-render when it changes. It gates
 * the controls that only make sense while something is still moving.
 */
export function performanceEnded(): boolean {
  const perf = store.perf.value;
  if (!perf) return false;
  if (store.playing.value || store.loopRange.value) return false;
  return store.time.value >= perf.duration - 0.05;
}

export function toast(message: string) {
  store.toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (store.toast.value = null), 2600);
}

export function announce(message: string) {
  store.announcement.value = message;
}
