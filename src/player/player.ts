import type { CompiledPerformance, Landmark } from '@/model/types';
import { mapMonotone } from '@/choreography/clock';

/**
 * Playback clock over a compiled performance. The player owns performance
 * time only; every visual is sampled from `t`, so seek is a plain assignment
 * and pause is an exact freeze.
 */
export type PlayerEvent = 'time' | 'play' | 'pause' | 'seek' | 'end' | 'load';

export class Player {
  perf: CompiledPerformance | null = null;
  t = 0;
  playing = false;
  rate = 1;
  loop: { start: number; end: number } | null = null;
  private listeners = new Map<PlayerEvent, Set<() => void>>();

  on(ev: PlayerEvent, fn: () => void): () => void {
    const set = this.listeners.get(ev) ?? new Set();
    set.add(fn);
    this.listeners.set(ev, set);
    return () => set.delete(fn);
  }

  private emit(ev: PlayerEvent) {
    this.listeners.get(ev)?.forEach((fn) => fn());
  }

  load(perf: CompiledPerformance | null, startAt = 0) {
    this.perf = perf;
    this.t = perf ? Math.min(Math.max(0, startAt), perf.duration) : 0;
    this.playing = false;
    this.emit('load');
    this.emit('time');
  }

  get duration(): number {
    return this.perf?.duration ?? 0;
  }

  play() {
    if (!this.perf) return;
    if (this.t >= this.duration - 1e-3) this.t = this.loop ? this.loop.start : 0;
    this.playing = true;
    this.emit('play');
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.emit('pause');
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    if (!this.perf) return;
    this.t = Math.min(Math.max(0, t), this.duration);
    this.emit('seek');
    this.emit('time');
  }

  seekBy(dt: number) {
    this.seek(this.t + dt);
  }

  /** Seek by historical date (ms) using the serialized monotone map. */
  seekHistorical(ms: number) {
    if (!this.perf) return;
    this.seek(mapMonotone(this.perf.timeMap, ms));
  }

  historicalAt(t = this.t): number | null {
    if (!this.perf || !this.perf.timeMap.length) return null;
    return mapMonotone(this.perf.timeMap, t, true);
  }

  /** Advance by real seconds. Returns true when time changed. */
  advance(dtReal: number): boolean {
    if (!this.playing || !this.perf) return false;
    const next = this.t + dtReal * this.rate;
    const end = this.loop ? this.loop.end : this.duration;
    if (next >= end) {
      if (this.loop) {
        this.t = this.loop.start + ((next - this.loop.start) % Math.max(1e-3, this.loop.end - this.loop.start));
        this.emit('seek');
      } else {
        this.t = this.duration;
        this.playing = false;
        this.emit('time');
        this.emit('end');
        return true;
      }
    } else this.t = next;
    this.emit('time');
    return true;
  }

  private landmarks(): Landmark[] {
    return this.perf?.landmarks ?? [];
  }

  nextLandmark(): Landmark | null {
    return this.landmarks().find((l) => l.time > this.t + 0.05) ?? null;
  }

  prevLandmark(): Landmark | null {
    const list = this.landmarks().filter((l) => l.time < this.t - 0.6);
    return list[list.length - 1] ?? null;
  }

  /** Next/previous commit impact around the playhead. */
  stepCommit(dir: 1 | -1): number | null {
    const nodes = this.perf?.nodes;
    if (!nodes || !nodes.length) return null;
    if (dir > 0) {
      const nd = nodes.find((n) => n.impact > this.t + 0.02);
      return nd ? nd.impact : null;
    }
    let best: number | null = null;
    for (const n of nodes) if (n.impact < this.t - 0.02) best = n.impact;
    return best;
  }

  /** Beat length (seconds) at the playhead, for keyboard stepping. */
  beatLength(): number {
    const tm = this.perf?.tempoMap;
    if (!tm || !tm.length) return 0.5;
    let bpm = tm[0]![1];
    for (const [start, b] of tm) if (start <= this.t) bpm = b;
    return 60 / bpm;
  }
}
