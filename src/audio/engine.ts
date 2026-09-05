import type { CompiledPerformance } from '@/model/types';
import { characterOf, registerFor, type Register } from './score';

/**
 * The soundtrack.
 *
 * This was a synthesiser. A piano piece was derived from the repository's own
 * hash — key, mode, a four-bar turnaround, a melody that walked the scale —
 * with a small orchestra answering individual events: harp on every commit,
 * woodwind at a branch point, timpani and brass on every merge. Every voice
 * was tied to something true about the history, all of it was measured and
 * spaced against the corpus, and it was still hard to listen to. That is the
 * only test a soundtrack has to pass, and it failed it repeatedly.
 *
 * So it plays real recorded music instead, and there are no sound effects at
 * all. Nothing is triggered by a commit, a merge or a tag. The repository
 * chooses *which* track — a project that merges a pull request every other
 * commit gets something relentless, a long quiet one gets something unhurried
 * — and after that the music is simply music.
 *
 * The honest cost of that trade: a recording cannot follow the timeline. It
 * does not accelerate through a busy year and it does not land a cymbal on a
 * merge, because a fixed recording has its own tempo and time-stretching one
 * in a browser sounds worse than the problem it solves. It is a soundtrack
 * over the performance rather than a score of it, which is what was actually
 * asked for.
 *
 * Playback is an ordinary HTMLAudioElement. Web Audio bought nothing here: no
 * synthesis, no analysis, no scheduling, and an audio element streams a large
 * file without holding it in memory.
 */
export interface AudioLevels {
  master: number;
  effects: number;
  muted: boolean;
}

interface Track {
  id: string;
  file: string;
  title: string;
  artist: string;
  register: Register;
  sourceUrl: string;
  licence: { name: string; url: string; credit: string };
}

let catalogue: Track[] | null = null;
let catalogueFetch: Promise<Track[]> | null = null;

/** The shipped tracks, fetched once. Absent means the build has no music. */
async function loadCatalogue(): Promise<Track[]> {
  if (catalogue) return catalogue;
  if (!catalogueFetch) {
    catalogueFetch = fetch(`${import.meta.env.BASE_URL}music/index.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        catalogue = Array.isArray(j?.tracks) ? (j.tracks as Track[]) : [];
        return catalogue;
      })
      .catch(() => {
        catalogue = [];
        return catalogue;
      });
  }
  return catalogueFetch;
}

export class AudioEngine {
  private el: HTMLAudioElement | null = null;
  private perf: CompiledPerformance | null = null;
  private wanted: Track | null = null;
  /** True while the viewer is scrubbing: the music holds rather than lurches. */
  private scrubbing = false;
  /**
   * Whether a performance is actually running. The music is *for* the
   * performance, so it plays during one and at no other time — not over the
   * landing form, not over a paused frame, not while a repository is loading.
   * Every path that could start playback checks this, because there are
   * several of them (starting the element, changing the volume, picking a new
   * track) and any one of them getting it wrong is music in a silent room.
   */
  private enabled = false;

  levels: AudioLevels = { master: 0.7, effects: 0.7, muted: false };
  dynamics: 'quiet' | 'standard' | 'dramatic' = 'dramatic';

  get available(): boolean {
    return typeof window !== 'undefined' && typeof Audio !== 'undefined';
  }

  get started(): boolean {
    return !!this.el;
  }

  /** Whether sound is actually coming out, for diagnostics and tests. */
  get playing(): boolean {
    return !!this.el && !this.el.paused && this.el.volume > 0 && this.enabled;
  }

  /** The track now playing, for the credit the licence requires. */
  get nowPlaying(): { title: string; artist: string; licence: Track['licence'] } | null {
    return this.wanted ? { title: this.wanted.title, artist: this.wanted.artist, licence: this.wanted.licence } : null;
  }

  /** Must be called from a user gesture, like any audio on the web. */
  ensure(): boolean {
    if (this.el) {
      if (this.el.paused && this.wants) void this.el.play().catch(() => {});
      return true;
    }
    if (!this.available) return false;
    this.el = new Audio();
    this.el.loop = true;
    this.el.preload = 'none';
    this.applyLevels();
    void this.choose();
    return true;
  }

  applyLevels() {
    if (!this.el) return;
    const range = this.dynamics === 'quiet' ? 0.55 : this.dynamics === 'dramatic' ? 1 : 0.8;
    this.el.volume = Math.max(0, Math.min(1, this.levels.muted ? 0 : this.levels.master * range));
    if (this.wants) void this.el.play().catch(() => {});
    else this.el.pause();
  }

  setPerformance(p: CompiledPerformance | null) {
    this.perf = p;
    void this.choose();
  }

  /**
   * Pick the track this repository should get, and start it if it changed.
   *
   * Only a change of *track* restarts anything — reloading the same register
   * mid-session would drop the needle for no reason the viewer can see.
   */
  private async choose(): Promise<void> {
    const tracks = await loadCatalogue();
    if (!tracks.length || !this.el) return;
    const register: Register = this.perf ? registerFor(characterOf(this.perf)) : 'driving';
    const pick = tracks.find((t) => t.register === register) ?? tracks[0]!;
    if (this.wanted?.id === pick.id) return;
    this.wanted = pick;
    this.el.src = `${import.meta.env.BASE_URL}music/${pick.file}`;
    this.el.currentTime = 0;
    if (this.wants) void this.el.play().catch(() => {});
  }

  /**
   * Scrubbing and fast-forwarding used to drag the score through at speed,
   * which is unpleasant and tells the viewer nothing. The music holds instead,
   * and picks up where it left off.
   */
  setScrubbing(active: boolean) {
    if (this.scrubbing === active) return;
    this.scrubbing = active;
    if (!this.el) return;
    if (this.wants) void this.el.play().catch(() => {});
    else this.el.pause();
  }

  /** Called on seek and pause. A recording has nothing to re-schedule. */
  reset() {
    /* nothing to unwind: playback is continuous and independent of the clock */
  }

  /** Everything that has to be true before a single sound comes out. */
  private get wants(): boolean {
    return this.enabled && !this.levels.muted && !this.scrubbing;
  }

  /** No performance is running. Called on pause, on landing, on load. */
  suspend() {
    this.enabled = false;
    this.el?.pause();
  }

  /** A performance is running. */
  resume() {
    this.enabled = true;
    if (this.el && this.wants) void this.el.play().catch(() => {});
  }

  /**
   * Kept so the frame loop's call site is unchanged. There is deliberately
   * nothing to do per frame any more: the whole point of this rewrite is that
   * the repository no longer makes noises.
   */
  schedule(_t: number, _rate: number, _intensity: number) {
    /* a recording needs no scheduling */
  }
}
