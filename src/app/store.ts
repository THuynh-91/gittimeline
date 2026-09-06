import { signal, computed } from '@preact/signals';
import type { ChoreographyEvent, CompiledPerformance, Dataset } from '@/model/types';
import type { IngestOutcome, IngestProgress } from '@/github/ingest';
import type { RateInfo } from '@/github/ratelimit';
import type { RecentRepo } from '@/github/cache';
import type { Quality } from '@/renderer/canvas';
import type { CatalogManifest } from '@/export/catalogPackage';

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

/**
 * The phase, said out loud.
 *
 * `AppPhase` is a state name for code to switch on. It was also being put
 * straight into the live region on the loading panel, so a screen reader
 * announced "FETCHING_TOPOLOGY" and "DEGRADED_READY" — an identifier, read
 * either as one mangled word or spelled out letter by letter, to the one
 * viewer who has nothing else to go on. The panel's visible stage list says
 * the same things in English; this is that list's equivalent for the people
 * who cannot see it.
 */
export function phaseSpoken(phase: AppPhase): string {
  switch (phase) {
    case 'IDLE': return 'Ready for a repository';
    case 'VALIDATING_URL': return 'Checking the address';
    case 'FETCHING_METADATA': return 'Reading the repository';
    case 'FETCHING_TOPOLOGY': return 'Mapping known commits';
    case 'BUILDING_DAG': return 'Finding parallel threads';
    case 'LAYING_OUT': return 'Laying out the history';
    case 'CHOREOGRAPHING': return 'Composing the performance';
    case 'READY': return 'Ready to play';
    case 'PLAYING': return 'Playing';
    case 'PAUSED': return 'Paused';
    case 'DEGRADED_READY': return 'Ready to play, with part of the history';
    case 'RATE_LIMITED': return "Stopped: GitHub's request limit was reached";
    case 'OFFLINE_CACHED': return 'Playing a locally cached copy';
    case 'CANCELLED': return 'Cancelled';
    case 'ERROR_RECOVERABLE': return 'Something went wrong, and it can be retried';
    case 'ERROR_FATAL': return 'Something went wrong';
  }
}

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
  /**
   * The nameplate riding the end of the main line.
   *
   * On by default: the straight ivory line is what every other thing on the
   * stage is described relative to, and a first-time viewer has no way to know
   * which one it is. Once you do, it is one more object between you and the
   * picture, so it comes off.
   */
  showSpineLabel: boolean;
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
  showSpineLabel: true,
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
/**
 * A catalog entry that has been clicked but not yet started.
 *
 * The same question the scope chooser asks of a repository nobody has fetched
 * yet — how much of this do you want? — asked of one whose plan is already
 * built. Everything here is measured rather than predicted, because the plan
 * exists: the length is what it runs, `nodes` is what actually arrives, and
 * `years` is the plan's own clock cut at each January.
 */
export interface CatalogQuestion {
  file: string;
  /** What the performance is called once it starts. */
  label: string;
  durationSeconds: number;
  /** Arrivals drawn one at a time. Far fewer than `commits` on a big history. */
  nodes: number;
  /** Commits the history holds, drawn or gathered into a ribbon. */
  commits: number;
  /** What the click pulls down, which is the same for every answer. */
  bytes: number;
  /** Seconds from click to first frame, measured at build time; null if never timed. */
  openSeconds: number | null;
  /** Calendar years worth offering, each with the seconds it occupies. */
  years: Array<[number, number]>;
}

export interface ScopeQuestion {
  displayName: string;
  estimatedCommits: number | null;
  firstYear: number | null;
  lastYear: number | null;
  /**
   * Why we are asking: too many commits, too dense to show in full, or —
   * `catalog` — because the viewer has picked something off the shelf and the
   * whole of it is long enough to be worth choosing rather than assuming.
   */
  reason: 'large' | 'dense' | 'catalog';
  mergeRatio: number | null;
  /** Set only when `reason` is `catalog`: the plan this question is about. */
  plan?: CatalogQuestion | null;
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
  buffering: signal(false),
  catalogManifest: signal<CatalogManifest | null>(null),
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
  /**
   * The calendar years a span covers, or null when the whole history is playing.
   *
   * Both ends inclusive. The coverage badge reads it, because "2016 · partial"
   * is the only thing on screen that distinguishes a span from a performance
   * that happens to have been seeked into.
   */
  span: signal<{ from: number; to: number } | null>(null),
  /**
   * The same span as two performance times, for everything that shows a clock.
   *
   * `span` is the years, which is what the viewer chose. This is where those
   * years land in the plan, which is what the readouts need — the clock was
   * reading the whole plan's, so choosing 2015 to 2017 of a nine-minute
   * history opened at `04:10 / 09:00`, ran, and stopped dead at `05:30` with
   * the playhead a little past the middle of the scrubber. Nothing was wrong;
   * it was being described against the wrong length.
   */
  spanSeconds: signal<{ start: number; end: number } | null>(null),
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

export function toast(message: string, ms = 2600) {
  store.toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  // Long enough to read what it says. 2.6 seconds is right for "Signed in" and
  // wrong for a sentence explaining that something did not work and what still
  // does, so the caller can ask for longer.
  toastTimer = window.setTimeout(() => (store.toast.value = null), ms);
}

export function announce(message: string) {
  store.announcement.value = message;
}
