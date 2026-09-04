import type { ChoreographyEvent, CompiledPerformance } from '@/model/types';
import { hash01 } from '@/model/prng';

/**
 * Procedural, original score. Voices are synthesized from the same event
 * plan the visuals use; nothing is sampled. The engine only exists after a
 * user gesture, is fully muteable, and carries a limiter so dense history
 * cannot clip. No information is available only through audio.
 */
export interface AudioLevels {
  master: number;
  effects: number;
  ambient: number;
  muted: boolean;
}

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16];
const ROOT_HZ = 196; // G3

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private fx: GainNode | null = null;
  private amb: GainNode | null = null;
  private ambFilter: BiquadFilterNode | null = null;
  private ambOscs: OscillatorNode[] = [];
  private scheduledUntil = -1;
  private lastT = -1;
  private perf: CompiledPerformance | null = null;
  private eventPtr = 0;
  private approachPtr = 0;
  private approaches: ChoreographyEvent[] = [];
  private intensity = 0;
  levels: AudioLevels = { master: 0.7, effects: 0.8, ambient: 0.5, muted: false };
  /** Dynamic range: 'quiet' | 'standard' | 'dramatic' */
  dynamics: 'quiet' | 'standard' | 'dramatic' = 'standard';

  get available(): boolean {
    return typeof window !== 'undefined' && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  }

  get started(): boolean {
    return !!this.ctx;
  }

  /** Must be called from a user gesture. */
  ensure(): boolean {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return true;
    }
    if (!this.available) return false;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    try {
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return false;
    }
    const ctx = this.ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 8;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    this.master = ctx.createGain();
    this.master.connect(limiter);
    limiter.connect(ctx.destination);
    this.fx = ctx.createGain();
    this.fx.connect(this.master);
    this.amb = ctx.createGain();
    this.ambFilter = ctx.createBiquadFilter();
    this.ambFilter.type = 'lowpass';
    this.ambFilter.frequency.value = 320;
    this.ambFilter.Q.value = 0.8;
    this.amb.connect(this.ambFilter);
    this.ambFilter.connect(this.master);
    // ambient bed: two detuned triangles an octave apart, very quiet
    for (const [freq, detune] of [
      [ROOT_HZ / 2, -6],
      [ROOT_HZ / 2, 6],
      [ROOT_HZ, 3],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = 0.11;
      o.connect(g);
      g.connect(this.amb);
      o.start();
      this.ambOscs.push(o);
    }
    this.applyLevels();
    return true;
  }

  applyLevels() {
    if (!this.ctx || !this.master || !this.fx || !this.amb) return;
    const now = this.ctx.currentTime;
    const range = this.dynamics === 'quiet' ? 0.6 : this.dynamics === 'dramatic' ? 1.25 : 1;
    this.master.gain.setTargetAtTime(this.levels.muted ? 0 : this.levels.master * range, now, 0.03);
    this.fx.gain.setTargetAtTime(this.levels.effects, now, 0.03);
    this.amb.gain.setTargetAtTime(this.levels.ambient * 0.6, now, 0.1);
  }

  setPerformance(p: CompiledPerformance | null) {
    this.perf = p;
    this.eventPtr = 0;
    this.approachPtr = 0;
    this.approaches = p ? p.events.filter((e) => e.type === 'MERGE_APPROACH').sort((a, b) => a.performanceStart - b.performanceStart) : [];
    this.scheduledUntil = -1;
    this.lastT = -1;
  }

  /** Called on seek/pause so nothing from the old position leaks. */
  reset() {
    this.scheduledUntil = -1;
    this.lastT = -1;
    this.eventPtr = 0;
    this.approachPtr = 0;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Schedule voices for events whose impact falls in (lastT, t + lookahead]. */
  schedule(t: number, rate: number, intensity: number) {
    const ctx = this.ctx;
    const p = this.perf;
    if (!ctx || !p || !this.fx || this.levels.muted) {
      this.lastT = t;
      return;
    }
    this.intensity += (intensity - this.intensity) * 0.1;
    if (this.ambFilter) this.ambFilter.frequency.setTargetAtTime(220 + 1400 * this.intensity * this.intensity, ctx.currentTime, 0.4);
    const lookahead = 0.16 * rate;
    if (this.lastT < 0 || t < this.lastT || t - this.lastT > 1.5) {
      // fresh start or seek: re-anchor the pointer just after t
      this.eventPtr = lowerBound(p.events, t);
      this.approachPtr = this.approaches.findIndex((e) => e.performanceStart > t);
      if (this.approachPtr < 0) this.approachPtr = this.approaches.length;
      this.scheduledUntil = t;
    }
    // Merge approaches are scheduled by their *start* so the swell rises before the hit.
    while (this.approachPtr < this.approaches.length && this.approaches[this.approachPtr]!.performanceStart <= t + lookahead) {
      const ev = this.approaches[this.approachPtr++]!;
      if (ev.performanceStart <= this.scheduledUntil && this.scheduledUntil > t) continue;
      const len = Math.max(0.3, Math.min(2.5, ev.performanceImpact - ev.performanceStart)) / Math.max(0.05, rate);
      const when = ctx.currentTime + Math.max(0, (ev.performanceStart - t) / Math.max(0.05, rate));
      swell(ctx, this.fx, when, len, 0.1 + 0.16 * ev.salience * ev.effectBudget);
    }
    const until = t + lookahead;
    const events = p.events;
    while (this.eventPtr < events.length && events[this.eventPtr]!.performanceImpact <= until) {
      const ev = events[this.eventPtr++]!;
      if (ev.performanceImpact <= this.scheduledUntil) continue;
      const when = ctx.currentTime + Math.max(0, (ev.performanceImpact - t) / Math.max(0.05, rate));
      this.voice(ev, when);
    }
    this.scheduledUntil = until;
    this.lastT = t;
  }

  private voice(ev: ChoreographyEvent, when: number) {
    const p = this.perf!;
    const fx = this.fx!;
    const ctx = this.ctx!;
    const node = p.nodes.find((n) => n.sha === ev.subjectIds[0]);
    const lane = node ? Math.min(PENTATONIC.length - 1, Math.abs(p.threads[node.threadIdx]?.lane ?? 0)) : 0;
    const degree = PENTATONIC[lane]!;
    const contributorJitter = node ? hash01(`voice:${p.contributors[node.contributorIdx]?.id ?? ''}`) : 0.5;
    const budget = ev.effectBudget;
    switch (ev.type) {
      case 'COMMIT_STEP': {
        const octave = node?.isSpine ? 1 : 2;
        pluck(ctx, fx, when, ROOT_HZ * octave * Math.pow(2, degree / 12), 0.16 + 0.06 * ev.salience, 0.22, contributorJitter);
        break;
      }
      case 'COMMIT_CLUSTER': {
        const count = 6;
        const span = Math.max(0.4, ev.performanceEnd - ev.performanceStart);
        for (let i = 0; i < count; i++) pluck(ctx, fx, when - (span * (count - i)) / count, ROOT_HZ * 2 * Math.pow(2, PENTATONIC[i % 5]! / 12), 0.07, 0.1, contributorJitter);
        break;
      }
      case 'DIVERGENCE':
        pluck(ctx, fx, when - 0.09, ROOT_HZ * 2 * Math.pow(2, (degree + 2) / 12), 0.12 * budget, 0.18, contributorJitter);
        pluck(ctx, fx, when, ROOT_HZ * 2 * Math.pow(2, (degree + 7) / 12), 0.16 * budget, 0.3, contributorJitter);
        swish(ctx, fx, when - 0.05, 0.25, 0.12 * budget);
        break;
      case 'THREAD_ACTIVATE':
        pluck(ctx, fx, when, ROOT_HZ * 2 * Math.pow(2, degree / 12), 0.1, 0.35, contributorJitter);
        break;
      case 'CONTRIBUTOR_ENTER':
        pluck(ctx, fx, when, ROOT_HZ * 4 * Math.pow(2, (degree + 4) / 12), 0.06, 0.4, contributorJitter);
        break;
      case 'MERGE_APPROACH':
        break; // scheduled by start in schedule()
      case 'MERGE_IMPACT':
      case 'MAJOR_MERGE':
      case 'OCTOPUS_MERGE': {
        const big = ev.type !== 'MERGE_IMPACT';
        thump(ctx, fx, when, big ? 0.55 * budget : 0.32 * budget, big ? 48 : 60);
        chord(ctx, fx, when, ROOT_HZ, big ? 0.16 * budget : 0.1 * budget, big ? 1.4 : 0.8);
        if (ev.type === 'OCTOPUS_MERGE') for (let i = 1; i < 3; i++) pluck(ctx, fx, when + i * 0.07, ROOT_HZ * 2 * Math.pow(2, PENTATONIC[(i * 2) % 5]! / 12), 0.1, 0.3, 0.5);
        break;
      }
      case 'TAG_LANDMARK':
        bell(ctx, fx, when, ROOT_HZ * 3, 0.16 * budget);
        break;
      case 'ERA_TRANSITION':
        chord(ctx, fx, when, ROOT_HZ / 2, 0.08, 2.4);
        break;
      case 'REPO_BIRTH':
      case 'MULTI_ROOT_REVEAL':
        bell(ctx, fx, when, ROOT_HZ * 2, 0.14);
        thump(ctx, fx, when, 0.18, 44);
        break;
      case 'REPO_PRESENT':
        chord(ctx, fx, when, ROOT_HZ, 0.14, 3.2);
        bell(ctx, fx, when + 0.3, ROOT_HZ * 3, 0.1);
        break;
      case 'QUIET_GAP':
        swish(ctx, fx, when - 0.6, 0.9, 0.05);
        break;
      default:
        break;
    }
  }
}

function lowerBound(events: ChoreographyEvent[], t: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.performanceImpact <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function pluck(ctx: AudioContext, out: AudioNode, when: number, freq: number, gain: number, decay: number, timbre: number) {
  if (when < ctx.currentTime - 0.05) return;
  const t0 = Math.max(when, ctx.currentTime);
  const o = ctx.createOscillator();
  o.type = timbre < 0.33 ? 'sine' : timbre < 0.66 ? 'triangle' : 'sine';
  o.frequency.value = freq;
  o.detune.value = (timbre - 0.5) * 14;
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = freq * 2.01;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  const g2 = ctx.createGain();
  g2.gain.value = 0.25 + timbre * 0.3;
  o.connect(g);
  o2.connect(g2);
  g2.connect(g);
  g.connect(out);
  o.start(t0);
  o2.start(t0);
  o.stop(t0 + decay + 0.05);
  o2.stop(t0 + decay + 0.05);
}

function thump(ctx: AudioContext, out: AudioNode, when: number, gain: number, freq: number) {
  const t0 = Math.max(when, ctx.currentTime);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 2.2, t0);
  o.frequency.exponentialRampToValueAtTime(freq, t0 + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
  o.connect(g);
  g.connect(out);
  o.start(t0);
  o.stop(t0 + 0.6);
  // short noise transient
  const n = noise(ctx, 0.12);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(gain * 0.35, t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 900;
  n.connect(f);
  f.connect(ng);
  ng.connect(out);
  n.start(t0);
  n.stop(t0 + 0.2);
}

function chord(ctx: AudioContext, out: AudioNode, when: number, root: number, gain: number, length: number) {
  const t0 = Math.max(when, ctx.currentTime);
  for (const semi of [0, 7, 12, 16]) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = root * Math.pow(2, semi / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain / 3, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, t0);
    f.frequency.exponentialRampToValueAtTime(300, t0 + length);
    o.connect(f);
    f.connect(g);
    g.connect(out);
    o.start(t0);
    o.stop(t0 + length + 0.1);
  }
}

function bell(ctx: AudioContext, out: AudioNode, when: number, freq: number, gain: number) {
  const t0 = Math.max(when, ctx.currentTime);
  for (const [ratio, amp, decay] of [
    [1, 1, 1.6],
    [2.4, 0.4, 1.0],
    [5.1, 0.15, 0.5],
  ] as const) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq * ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain * amp, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    o.connect(g);
    g.connect(out);
    o.start(t0);
    o.stop(t0 + decay + 0.05);
  }
}

function swell(ctx: AudioContext, out: AudioNode, when: number, length: number, gain: number) {
  const t0 = Math.max(when, ctx.currentTime);
  const end = Math.max(t0 + 0.2, when + length);
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = ROOT_HZ / 2;
  const o2 = ctx.createOscillator();
  o2.type = 'sawtooth';
  o2.frequency.value = ROOT_HZ / 2;
  o2.detune.value = 8;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(180, t0);
  f.frequency.exponentialRampToValueAtTime(2200, end);
  f.Q.value = 3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, end);
  g.gain.exponentialRampToValueAtTime(0.0001, end + 0.12);
  o.connect(f);
  o2.connect(f);
  f.connect(g);
  g.connect(out);
  o.start(t0);
  o2.start(t0);
  o.stop(end + 0.2);
  o2.stop(end + 0.2);
}

function swish(ctx: AudioContext, out: AudioNode, when: number, length: number, gain: number) {
  const t0 = Math.max(when, ctx.currentTime);
  const n = noise(ctx, length);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(600, t0);
  f.frequency.exponentialRampToValueAtTime(3200, t0 + length);
  f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + length * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  n.connect(f);
  f.connect(g);
  g.connect(out);
  n.start(t0);
  n.stop(t0 + length + 0.1);
}

let noiseBuffer: AudioBuffer | null = null;
function noise(ctx: AudioContext, length: number): AudioBufferSourceNode {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    // deterministic xorshift noise (no Math.random)
    let s = 0x9e3779b9;
    for (let i = 0; i < data.length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      data[i] = ((s >>> 0) / 4294967296) * 2 - 1;
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  void length;
  return src;
}
