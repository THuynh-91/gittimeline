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
  muted: boolean;
}

/**
 * The score is written, not scattered. A slow four-chord progression in A minor
 * runs underneath the whole performance, turning over every few phrases, and
 * every voice draws its pitches from the chord currently sounding. A thread's
 * lane picks which chord tone it takes, so two branches running in parallel
 * harmonize instead of colliding, and a merge simply plays the chord.
 */
const PROGRESSION: number[][] = [
  [0, 3, 7, 12, 15, 19], // i
  [8, 12, 15, 20, 24, 27], // VI
  [5, 8, 12, 17, 20, 24], // iv
  [10, 14, 17, 22, 26, 29], // VII
];
const CHORD_SECONDS = 7.5;
const ROOT_HZ = 220; // A3

function chordAt(t: number): number[] {
  return PROGRESSION[Math.floor(Math.max(0, t) / CHORD_SECONDS) % PROGRESSION.length]!;
}

function noteHz(semitones: number, octave = 1): number {
  return ROOT_HZ * octave * Math.pow(2, semitones / 12);
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private fx: GainNode | null = null;
  private scheduledUntil = -1;
  private lastT = -1;
  private perf: CompiledPerformance | null = null;
  private eventPtr = 0;
  private approachPtr = 0;
  private approaches: ChoreographyEvent[] = [];
  private intensity = 0;
  private voiceSlot = -1;
  private voiceCount = 0;
  levels: AudioLevels = { master: 0.7, effects: 0.7, muted: true };
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
    // There is no ambient bed and no held tone of any kind. Every sound in
    // GitDance is a discrete event with a decay; nothing drones.
    this.applyLevels();
    return true;
  }

  applyLevels() {
    if (!this.ctx || !this.master || !this.fx) return;
    const now = this.ctx.currentTime;
    const range = this.dynamics === 'quiet' ? 0.6 : this.dynamics === 'dramatic' ? 1.25 : 1;
    this.master.gain.setTargetAtTime(this.levels.muted ? 0 : this.levels.master * range, now, 0.03);
    this.fx.gain.setTargetAtTime(this.levels.effects, now, 0.03);
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

  /** At most a handful of note-level voices per half second: dense history should read as a flurry, not a machine gun. */
  private takeVoice(at: number): boolean {
    const slot = Math.floor(at * 2);
    if (slot !== this.voiceSlot) {
      this.voiceSlot = slot;
      this.voiceCount = 0;
    }
    if (this.voiceCount >= 4) return false;
    this.voiceCount++;
    return true;
  }

  private voice(ev: ChoreographyEvent, when: number) {
    const p = this.perf!;
    const fx = this.fx!;
    const ctx = this.ctx!;
    const node = p.nodes.find((n) => n.sha === ev.subjectIds[0]);
    const chord = chordAt(ev.performanceImpact);
    const lane = node ? Math.abs(p.threads[node.threadIdx]?.lane ?? 0) : 0;
    const degree = chord[lane % chord.length]!;
    const contributorJitter = node ? hash01(`voice:${p.contributors[node.contributorIdx]?.id ?? ''}`) : 0.5;
    const budget = ev.effectBudget;
    switch (ev.type) {
      case 'COMMIT_STEP': {
        if (!this.takeVoice(ev.performanceImpact)) break;
        // The main line sings in the middle register; side threads answer above it.
        const octave = node?.isSpine ? 1 : 2;
        pluck(ctx, fx, when, noteHz(degree, octave), 0.075 + 0.03 * ev.salience, 1.6, contributorJitter);
        break;
      }
      case 'COMMIT_CLUSTER': {
        const count = 6;
        const span = Math.max(0.4, ev.performanceEnd - ev.performanceStart);
        for (let i = 0; i < count; i++) pluck(ctx, fx, when - (span * (count - i)) / count, noteHz(chord[i % chord.length]!, 2), 0.04, 0.9, contributorJitter);
        break;
      }
      case 'DIVERGENCE':
        // A rising pickup out of the chord: the branch asks a question.
        pluck(ctx, fx, when - 0.1, noteHz(chord[lane % chord.length]!, 2), 0.09 * budget, 1, contributorJitter);
        pluck(ctx, fx, when, noteHz(chord[(lane + 2) % chord.length]!, 2), 0.12 * budget, 1.6, contributorJitter);
        swish(ctx, fx, when - 0.05, 0.25, 0.06 * budget);
        break;
      case 'THREAD_ACTIVATE':
        pluck(ctx, fx, when, noteHz(degree, 2), 0.09, 1.4, contributorJitter);
        break;
      case 'CONTRIBUTOR_ENTER':
        pluck(ctx, fx, when, noteHz(chord[(lane + 1) % chord.length]!, 4), 0.045, 1.2, contributorJitter);
        break;
      case 'MERGE_APPROACH':
        break; // scheduled by start in schedule()
      case 'MERGE_IMPACT':
      case 'MAJOR_MERGE':
      case 'OCTOPUS_MERGE': {
        const big = ev.type !== 'MERGE_IMPACT';
        const vol = node ? node.mergeVolume : 0;
        // Weight follows the work absorbed, so a two-commit merge is a footstep
        // and a twenty-commit one is the downbeat of the phrase.
        const weight = Math.min(1, 0.22 + Math.log2(1 + vol) * 0.2);
        thump(ctx, fx, when, (big ? 0.42 : 0.26) * weight * budget, big ? 46 : 58);
        pad(ctx, fx, when, chord, (0.05 + 0.09 * weight) * budget, 1 + 1.6 * weight);
        // Roll the chord out of the impact: more voices the more work converged.
        const voices = Math.max(1, Math.min(6, Math.round(Math.log2(1 + vol) * 1.3)));
        for (let i = 0; i < voices; i++) {
          pluck(ctx, fx, when + i * 0.05, noteHz(chord[i % chord.length]!, i < 3 ? 1 : 2), (big ? 0.085 : 0.06) * weight * budget, 2.2, 0.4);
        }
        break;
      }
      case 'TAG_LANDMARK':
        // A cadence: the root arrives high over the sounding chord.
        bell(ctx, fx, when, noteHz(0, 4), 0.12 * budget);
        pad(ctx, fx, when, chord, 0.06, 2.4);
        break;
      case 'ERA_TRANSITION':
        // The harmony turns over: a low root under a new colour.
        pluck(ctx, fx, when, noteHz(chordAt(ev.performanceImpact + CHORD_SECONDS)[0]!, 0.5), 0.085, 3.2, 0.3);
        pad(ctx, fx, when + 0.12, chordAt(ev.performanceImpact + CHORD_SECONDS), 0.055, 3);
        break;
      case 'REPO_BIRTH':
      case 'MULTI_ROOT_REVEAL':
        bell(ctx, fx, when, noteHz(0, 2), 0.12);
        thump(ctx, fx, when, 0.16, 44);
        break;
      case 'REPO_PRESENT':
        // Final cadence: home to the tonic, held.
        pad(ctx, fx, when, PROGRESSION[0]!, 0.1, 3.4);
        bell(ctx, fx, when + 0.35, noteHz(0, 4), 0.085);
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
  // A struck string: partials slightly sharp of the harmonic series, the higher
  // ones dying away first, plus a short hammer knock. This is what makes it read
  // as a piano rather than a beep.
  const body = ctx.createGain();
  body.gain.value = 1;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.setValueAtTime(Math.min(9000, freq * 9), t0);
  tone.frequency.exponentialRampToValueAtTime(Math.max(320, freq * 2.2), t0 + decay * 0.8);
  body.connect(tone);
  tone.connect(out);

  const partials: Array<[number, number, number]> = [
    [1, 1, 1],
    [2, 0.4, 0.62],
    [3, 0.2, 0.42],
    [4, 0.11, 0.3],
    [5, 0.06, 0.22],
    [6, 0.035, 0.16],
  ];
  const inharmonicity = 0.00045 + timbre * 0.0004;
  for (const [ratio, amp, decayScale] of partials) {
    const f = freq * ratio * Math.sqrt(1 + inharmonicity * ratio * ratio);
    if (f > 12000) continue;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    const d = Math.max(0.09, decay * decayScale);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * amp), t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g);
    g.connect(body);
    o.start(t0);
    o.stop(t0 + d + 0.05);
  }
  // Hammer knock: a very short filtered noise burst that gives the attack its felt.
  const n = noise(ctx, 0.05);
  const nf = ctx.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = Math.min(6000, freq * 3.5);
  nf.Q.value = 0.9;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(gain * 0.5, t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
  n.connect(nf);
  nf.connect(ng);
  ng.connect(body);
  n.start(t0);
  n.stop(t0 + 0.08);
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
  ng.gain.setValueAtTime(gain * 0.12, t0);
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

/** A soft sustained voicing of a chord: the harmonic bed under an event. */
function pad(ctx: AudioContext, out: AudioNode, when: number, semitones: number[], gain: number, length: number) {
  const t0 = Math.max(when, ctx.currentTime);
  for (const semi of semitones.slice(0, 4)) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = noteHz(semi, 1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain / 3, t0 + 0.05);
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
  o.type = 'triangle';
  o.frequency.value = ROOT_HZ / 2;
  const o2 = ctx.createOscillator();
  o2.type = 'triangle';
  o2.frequency.value = ROOT_HZ / 2;
  o2.detune.value = 8;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(180, t0);
  f.frequency.exponentialRampToValueAtTime(1500, end);
  f.Q.value = 1.6;
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
