import type { ChoreographyEvent, CompiledPerformance } from '@/model/types';
import { hash01 } from '@/model/prng';

/**
 * A small synthetic orchestra, written from the same event plan the visuals use.
 * Nothing is sampled and nothing drones: every sound is a struck or bowed
 * gesture with an envelope that ends.
 *
 * The sections, and what each is for:
 *
 *   piano      the piece itself. A left hand walking the chord and a right hand
 *              singing over it, played continuously on the performance's own
 *              beat grid, so the music has a pulse of its own rather than
 *              existing only where commits happen to land.
 *   strings    the harmony underneath, swelling in on each chord change and
 *              receding before the next.
 *   basses     one deep root per chord, giving the harmony a floor.
 *   brass      merges, weighted by how many commits actually converged.
 *   timpani    the impact under a merge, pitched to the chord root.
 *   cymbal     tags and the largest merges, as a filtered shimmer.
 *   harp       a light touch on branch events, sitting above the piano.
 *
 * Everything the repository does is an accent *over* the piece, deliberately
 * quiet: the music carries the room and the events colour it.
 *
 * Dynamics follow the repository's own activity curve, so a quiet era plays
 * quietly and a busy one opens up. Nothing is conveyed by sound alone.
 */
export interface AudioLevels {
  master: number;
  effects: number;
  muted: boolean;
}

/** A slow four-chord progression in A minor: i · VI · iv · VII. */
const PROGRESSION: number[][] = [
  [0, 3, 7, 12, 15, 19],
  [8, 12, 15, 20, 24, 27],
  [5, 8, 12, 17, 20, 24],
  [10, 14, 17, 22, 26, 29],
];
const CHORD_SECONDS = 7.5;
/** Below about an eighth of a second the ear stops hearing separate notes. */
const MIN_NOTE_GAP = 0.13;
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
  private hall: ConvolverNode | null = null;
  private hallSend: GainNode | null = null;
  private scheduledUntil = -1;
  private lastT = -1;
  private perf: CompiledPerformance | null = null;
  private eventPtr = 0;
  private approachPtr = 0;
  private approaches: ChoreographyEvent[] = [];
  private intensity = 0;
  private lastNoteAt = -Infinity;
  /** Beat onsets already committed to the piano, so accents can dodge them. */
  private pianoAt: number[] = [];
  private lastChordIndex = -1;
  /** Where each melodic voice currently sits within the sounding chord. */
  private leadIdx = 2;
  private counterIdx = 4;
  /** Beat-grid cursor for the piano piece. */
  private nextBeat = 0;
  private nextBeatTime = 0;

  levels: AudioLevels = { master: 0.7, effects: 0.7, muted: false };
  dynamics: 'quiet' | 'standard' | 'dramatic' = 'dramatic';

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
    limiter.threshold.value = -16;
    limiter.knee.value = 10;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.22;
    this.master = ctx.createGain();
    this.master.connect(limiter);
    limiter.connect(ctx.destination);
    this.fx = ctx.createGain();
    this.fx.connect(this.master);

    // A short synthetic hall. An orchestra in a dry room sounds like a synth;
    // a little tail is most of what makes a section read as a section.
    this.hall = ctx.createConvolver();
    this.hall.buffer = impulse(ctx, 2.1);
    this.hallSend = ctx.createGain();
    this.hallSend.gain.value = 0.32;
    this.hallSend.connect(this.hall);
    this.hall.connect(this.master);

    this.applyLevels();
    return true;
  }

  applyLevels() {
    if (!this.ctx || !this.master || !this.fx) return;
    const now = this.ctx.currentTime;
    const range = this.dynamics === 'quiet' ? 0.6 : this.dynamics === 'dramatic' ? 1.2 : 1;
    this.master.gain.setTargetAtTime(this.levels.muted ? 0 : this.levels.master * range, now, 0.04);
    this.fx.gain.setTargetAtTime(this.levels.effects, now, 0.04);
  }

  setPerformance(p: CompiledPerformance | null) {
    this.perf = p;
    this.eventPtr = 0;
    this.approachPtr = 0;
    this.approaches = p ? p.events.filter((e) => e.type === 'MERGE_APPROACH').sort((a, b) => a.performanceStart - b.performanceStart) : [];
    this.scheduledUntil = -1;
    this.lastT = -1;
    this.lastNoteAt = -Infinity;
    this.pianoAt = [];
    this.lastChordIndex = -1;
  }

  /** Called on seek/pause so nothing from the old position leaks. */
  reset() {
    this.scheduledUntil = -1;
    this.lastT = -1;
    this.eventPtr = 0;
    this.approachPtr = 0;
    this.lastNoteAt = -Infinity;
    this.pianoAt = [];
    this.lastChordIndex = -1;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private send(node: AudioNode) {
    if (this.hallSend) node.connect(this.hallSend);
  }

  schedule(t: number, rate: number, intensity: number) {
    const ctx = this.ctx;
    const p = this.perf;
    if (!ctx || !p || !this.fx || this.levels.muted) {
      this.lastT = t;
      return;
    }
    const out = this.fx;
    this.intensity += (intensity - this.intensity) * 0.08;
    const lookahead = 0.18 * rate;
    if (this.lastT < 0 || t < this.lastT || t - this.lastT > 1.5) {
      this.eventPtr = lowerBound(p.events, t);
      const idx = this.approaches.findIndex((e) => e.performanceStart > t);
      this.approachPtr = idx < 0 ? this.approaches.length : idx;
      this.scheduledUntil = t;
      this.lastChordIndex = Math.floor(Math.max(0, t) / CHORD_SECONDS);
      this.seekGrid(p.tempoMap, t);
      this.pianoAt = [];
    }
    // Only beats still near the playhead can collide with anything.
    while (this.pianoAt.length && this.pianoAt[0]! < t - 1) this.pianoAt.shift();
    const until = t + lookahead;

    // The harmony turns over: strings re-voice and the basses take the new root.
    const chordIndex = Math.floor(Math.max(0, t) / CHORD_SECONDS);
    if (chordIndex !== this.lastChordIndex) {
      this.lastChordIndex = chordIndex;
      const chord = chordAt(t);
      const when = ctx.currentTime + 0.02;
      const len = (CHORD_SECONDS * 0.92) / Math.max(0.05, rate);
      this.send(strings(ctx, out, when, chord, 0.026 + 0.05 * this.intensity, len));
      this.send(bass(ctx, out, when, noteHz(chord[0]!, 0.5), 0.045 + 0.02 * this.intensity, len * 0.7));
      this.leadIdx = 2;
      this.counterIdx = 4;
    }

    // The piece itself: walk the beat grid and play the piano up to the
    // lookahead horizon. This is what gives the score a pulse of its own.
    let guard = 0;
    while (this.nextBeatTime <= until && guard++ < 64) {
      const beatTime = this.nextBeatTime;
      const beat = this.nextBeat;
      const len = beatLengthAt(p.tempoMap, beatTime);
      this.nextBeat += 1;
      this.nextBeatTime = beatTime + len;
      if (beatTime < t - 0.05) continue;
      const when = ctx.currentTime + Math.max(0, (beatTime - t) / Math.max(0.05, rate));
      this.playBar(ctx, out, when, beatTime, beat, len / Math.max(0.05, rate));
    }

    // Merge approaches are scheduled by their start so the crescendo rises first.
    while (this.approachPtr < this.approaches.length && this.approaches[this.approachPtr]!.performanceStart <= until) {
      const ev = this.approaches[this.approachPtr++]!;
      if (ev.performanceStart <= this.scheduledUntil && this.scheduledUntil > t) continue;
      const len = Math.max(0.35, Math.min(2.6, ev.performanceImpact - ev.performanceStart)) / Math.max(0.05, rate);
      const when = ctx.currentTime + Math.max(0, (ev.performanceStart - t) / Math.max(0.05, rate));
      this.send(crescendo(ctx, out, when, chordAt(ev.performanceImpact), len, (0.03 + 0.06 * ev.salience) * ev.effectBudget));
    }

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

  /** Re-place the beat cursor after a seek, walking the tempo map from zero. */
  private seekGrid(tempoMap: Array<[number, number]>, t: number) {
    let time = 0;
    let beat = 0;
    let guard = 0;
    while (time < t && guard++ < 200000) {
      time += beatLengthAt(tempoMap, time);
      beat++;
    }
    this.nextBeat = beat;
    this.nextBeatTime = time;
  }

  /**
   * One beat of the piano piece.
   *
   * Left hand walks the chord in a rolling figure; right hand sings over it,
   * moving by step. How much of the texture is played follows the repository's
   * own activity, so a dormant year is a bare root and a busy one is the full
   * pattern — the music thins and thickens with the history rather than
   * repeating a loop.
   */
  private playBar(ctx: AudioContext, out: AudioNode, when: number, beatTime: number, beat: number, beatLen: number) {
    const chord = chordAt(beatTime);
    const inBar = beat % 4;
    const bar = Math.floor(beat / 4);
    const energy = Math.max(0, Math.min(1, this.intensity));
    const vel = 0.9 + 0.18 * (inBar === 0 ? 1 : inBar === 2 ? 0.4 : 0);

    // The piece has right of way: an accent that would land on top of a piano
    // note is dropped rather than blurring into it.
    this.pianoAt.push(beatTime);

    // Left hand: the root on the downbeat, the fifth halfway through the bar.
    if (inBar === 0) this.send(piano(ctx, out, when, noteHz(chord[0]!, 0.5), 0.062 * vel, 3.4));
    else if (inBar === 2) this.send(piano(ctx, out, when, noteHz(chord[2]!, 0.5), 0.042, 2.6));

    // Rolling figure, which only appears once there is something happening.
    if (energy > 0.22) {
      const tone = chord[(beat + 1) % 4]!;
      this.send(piano(ctx, out, when, noteHz(tone, 1), 0.03 + 0.016 * energy, 1.5));
    }
    // The off-beat only when there is room for it. At a fast tempo the eighths
    // would run into each other and the figure would stop reading as a figure.
    if (energy > 0.62 && beatLen > 0.42) {
      const tone = chord[(beat * 2 + 3) % chord.length]!;
      this.send(piano(ctx, out, when + beatLen * 0.5, noteHz(tone, 1), 0.022 + 0.012 * energy, 1.1));
      this.pianoAt.push(beatTime + beatLen * 0.5);
    }

    // Right hand: a phrase on the strong beats, stepping through the chord.
    const sings = inBar === 0 || (inBar === 2 && energy > 0.3) || (inBar === 3 && energy > 0.72);
    if (sings && hash01(`melody:${bar}:${inBar}`) > 0.18) {
      const pitch = this.step(chord, `bar:${bar}:${inBar}`, true);
      this.send(piano(ctx, out, when, noteHz(pitch, 2), (0.036 + 0.02 * energy) * vel, 2.4));
    }
  }

  /**
   * Notes need air. An accent is dropped, never stacked, if it would land
   * within MIN_NOTE_GAP of the previous accent or of any note the piano has
   * already committed to. The piece has right of way: on a busy history most
   * commits pass without a sound of their own rather than blurring the pulse.
   *
   * `span` reserves a gesture that occupies time, such as a rolled cluster.
   */
  private takeVoice(at: number, span = 0): boolean {
    if (at - this.lastNoteAt < MIN_NOTE_GAP) return false;
    for (const beat of this.pianoAt) {
      if (beat > at + span + MIN_NOTE_GAP) break;
      if (beat > at - MIN_NOTE_GAP) return false;
    }
    this.lastNoteAt = at + span;
    return true;
  }

  /** Step a melodic voice through the chord, so the line has contour. */
  private step(chord: number[], key: string, lead: boolean): number {
    const r = hash01(key);
    const delta = r < 0.36 ? -1 : r < 0.72 ? 1 : 0;
    const lo = lead ? 0 : 2;
    const hi = lead ? chord.length - 3 : chord.length - 1;
    const cur = lead ? this.leadIdx : this.counterIdx;
    const next = Math.max(lo, Math.min(hi, cur + delta));
    if (lead) this.leadIdx = next;
    else this.counterIdx = next;
    return chord[next]!;
  }

  private voice(ev: ChoreographyEvent, when: number) {
    const p = this.perf!;
    const ctx = this.ctx!;
    const out = this.fx!;
    const node = p.nodes.find((n) => n.sha === ev.subjectIds[0]);
    const chord = chordAt(ev.performanceImpact);
    const budget = ev.effectBudget;
    const colour = node ? hash01(`voice:${p.contributors[node.contributorIdx]?.id ?? ''}`) : 0.5;

    switch (ev.type) {
      case 'COMMIT_STEP': {
        if (!this.takeVoice(ev.performanceImpact)) break;
        // A commit is a touch of light over the piece, not a note of it. The
        // piano is already playing; this only says "something happened here".
        const lead = !!node?.isSpine;
        this.send(harp(ctx, out, when, noteHz(chord[lead ? 2 : 4]!, lead ? 2 : 4), (lead ? 0.026 : 0.018) + 0.008 * ev.salience, lead ? 1 : 0.7, colour));
        break;
      }
      case 'COMMIT_CLUSTER': {
        // A run of commits is rolled forward from its landing, not backward
        // into the past — scheduling behind the clock clamps every note to
        // 'now' and turns the roll into a single smeared flam.
        //
        // The roll is only as long as the time the run actually owns. On a
        // dense history a cluster gets a single note; a run that holds the
        // stage for a second gets the full four. Rolling regardless of span
        // is what turns a busy repository into a continuous wash.
        const span = Math.max(0, ev.performanceEnd - ev.performanceStart);
        const count = Math.max(1, Math.min(4, Math.floor(span / 0.16)));
        const step = count > 1 ? Math.max(0.12, span / count) : 0;
        if (!this.takeVoice(ev.performanceImpact, step * (count - 1))) break;
        for (let i = 0; i < count; i++) this.send(harp(ctx, out, when + step * i, noteHz(chord[i % chord.length]!, 3), 0.014 + 0.006 * ev.salience, 0.6, colour));
        break;
      }
      case 'DIVERGENCE': {
        if (!this.takeVoice(ev.performanceImpact, 0.16)) break;
        // A rising pair in the winds: the branch asks a question, quietly.
        this.send(woodwind(ctx, out, when, noteHz(chord[1]!, 2), 0.028 * budget, 0.45));
        this.send(woodwind(ctx, out, when + 0.16, noteHz(chord[3]!, 2), 0.038 * budget, 0.8));
        break;
      }
      case 'THREAD_ACTIVATE':
        if (!this.takeVoice(ev.performanceImpact)) break;
        this.send(harp(ctx, out, when, noteHz(chord[2]!, 3), 0.024, 1, colour));
        break;
      case 'CONTRIBUTOR_ENTER':
        if (!this.takeVoice(ev.performanceImpact)) break;
        this.send(harp(ctx, out, when, noteHz(chord[chord.length - 1]!, 3), 0.02, 0.9, colour));
        break;
      case 'MERGE_APPROACH':
        break; // scheduled by start, above
      case 'MERGE_IMPACT':
      case 'MAJOR_MERGE':
      case 'OCTOPUS_MERGE': {
        const big = ev.type !== 'MERGE_IMPACT';
        const vol = node ? node.mergeVolume : 0;
        // Weight follows the work absorbed: a two-commit merge is a footstep,
        // a twenty-commit one is the downbeat of the phrase.
        const weight = Math.min(1, 0.22 + Math.log2(1 + vol) * 0.2);
        this.send(timpani(ctx, out, when, (big ? 0.3 : 0.17) * weight * budget, noteHz(chord[0]!, 0.5)));
        this.send(brass(ctx, out, when, chord, (0.03 + 0.055 * weight) * budget, 0.9 + 1.6 * weight));
        // The piano takes the downbeat with both hands.
        this.send(piano(ctx, out, when, noteHz(chord[0]!, 0.5), 0.05 * weight, 3.6));
        this.send(piano(ctx, out, when + 0.04, noteHz(chord[2]!, 1), 0.038 * weight, 2.6));
        if (big && weight > 0.6) this.send(cymbal(ctx, out, when, 0.05 * weight * budget, 1.6));
        break;
      }
      case 'TAG_LANDMARK':
        // A cadence: brass on the root, with a shimmer over it.
        this.send(brass(ctx, out, when, [chord[0]!, chord[2]!, chord[0]! + 12], 0.05 * budget, 1.8));
        this.send(cymbal(ctx, out, when, 0.03 * budget, 2));
        this.send(piano(ctx, out, when, noteHz(chord[0]!, 2), 0.04 * budget, 3));
        break;
      case 'ERA_TRANSITION': {
        const next = chordAt(ev.performanceImpact + CHORD_SECONDS);
        this.send(strings(ctx, out, when, next, 0.075, 3.2));
        this.send(bass(ctx, out, when, noteHz(next[0]!, 0.5), 0.07, 2.4));
        break;
      }
      case 'REPO_BIRTH':
      case 'MULTI_ROOT_REVEAL':
        this.send(strings(ctx, out, when, chord, 0.045, 3));
        this.send(piano(ctx, out, when + 0.25, noteHz(chord[0]!, 1), 0.055, 3));
        break;
      case 'REPO_PRESENT':
        // Tutti, home to the tonic, and let it ring.
        this.send(strings(ctx, out, when, PROGRESSION[0]!, 0.08, 4.5));
        this.send(brass(ctx, out, when + 0.15, PROGRESSION[0]!, 0.05, 3));
        this.send(timpani(ctx, out, when, 0.18, noteHz(0, 0.5)));
        this.send(cymbal(ctx, out, when, 0.035, 3));
        for (let i = 0; i < 4; i++) this.send(piano(ctx, out, when + i * 0.07, noteHz(PROGRESSION[0]![i]!, i < 2 ? 0.5 : 1), 0.05, 4.5));
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

/* ------------------------------- sections ------------------------------- */

/** Bowed strings: slow attack, gentle vibrato, a section made of detuned pairs. */
function strings(ctx: AudioContext, out: AudioNode, when: number, semitones: number[], gain: number, length: number): GainNode {
  const t0 = Math.max(when, ctx.currentTime);
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, t0);
  bus.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(0.9, length * 0.3));
  bus.gain.setValueAtTime(Math.max(0.0002, gain), t0 + length * 0.62);
  bus.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 1900;
  tone.Q.value = 0.6;
  bus.connect(tone);
  tone.connect(out);

  const vib = ctx.createOscillator();
  vib.frequency.value = 4.6;
  const vibAmt = ctx.createGain();
  vibAmt.gain.value = 3.2;
  vib.connect(vibAmt);
  vib.start(t0);
  vib.stop(t0 + length + 0.1);

  for (const semi of semitones.slice(0, 4)) {
    for (const detune of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = noteHz(semi, 1);
      o.detune.value = detune;
      vibAmt.connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = 0.12;
      o.connect(g);
      g.connect(bus);
      o.start(t0);
      o.stop(t0 + length + 0.1);
    }
  }
  return bus;
}

/** Double basses: one deep, slowly decaying root. */
function bass(ctx: AudioContext, out: AudioNode, when: number, freq: number, gain: number, length: number): GainNode {
  const t0 = Math.max(when, ctx.currentTime);
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, t0);
  bus.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.12);
  bus.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  bus.connect(lp);
  lp.connect(out);
  for (const [ratio, amp] of [
    [1, 1],
    [2, 0.28],
    [3, 0.1],
  ] as const) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq * ratio;
    const g = ctx.createGain();
    g.gain.value = amp * 0.5;
    o.connect(g);
    g.connect(bus);
    o.start(t0);
    o.stop(t0 + length + 0.1);
  }
  return bus;
}

/** Woodwind: a soft, breathy singing tone for the melody. */
function woodwind(ctx: AudioContext, out: AudioNode, when: number, freq: number, gain: number, length: number): GainNode {
  const t0 = Math.max(when, ctx.currentTime);
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, t0);
  bus.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.07);
  bus.gain.setValueAtTime(Math.max(0.0002, gain), t0 + length * 0.55);
  bus.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  bus.connect(out);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = 'triangle';
  o2.frequency.value = freq * 2;
  const g2 = ctx.createGain();
  g2.gain.value = 0.12;
  o.connect(bus);
  o2.connect(g2);
  g2.connect(bus);
  o.start(t0);
  o2.start(t0);
  o.stop(t0 + length + 0.1);
  o2.stop(t0 + length + 0.1);
  // A little breath at the attack.
  const n = noise(ctx);
  const nf = ctx.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = Math.min(9000, freq * 2.4);
  nf.Q.value = 1.1;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(Math.max(0.0002, gain * 0.3), t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
  n.connect(nf);
  nf.connect(ng);
  ng.connect(bus);
  n.start(t0);
  n.stop(t0 + 0.2);
  return bus;
}

/** Beat length in seconds at a given performance time. */
function beatLengthAt(tempoMap: Array<[number, number]>, t: number): number {
  let bpm = tempoMap[0]?.[1] ?? 90;
  for (const [start, b] of tempoMap) {
    if (start <= t) bpm = b;
    else break;
  }
  return 60 / Math.max(20, bpm);
}

/**
 * Piano. Struck strings with slightly stretched partials, each dying away
 * faster than the one below it, a felt hammer transient and a long tail — the
 * difference between a piano and a sine with an envelope is almost entirely in
 * those decay rates.
 */
function piano(ctx: AudioContext, out: AudioNode, when: number, freq: number, gain: number, decay: number): GainNode {
  const t0 = Math.max(when, ctx.currentTime);
  const bus = ctx.createGain();
  bus.gain.value = 1;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.setValueAtTime(Math.min(11000, freq * 10), t0);
  tone.frequency.exponentialRampToValueAtTime(Math.max(400, freq * 2.4), t0 + decay * 0.7);
  bus.connect(tone);
  tone.connect(out);
  const B = 0.00035; // string inharmonicity
  for (const [ratio, amp, ds] of [
    [1, 1, 1],
    [2, 0.44, 0.62],
    [3, 0.24, 0.44],
    [4, 0.13, 0.32],
    [5, 0.07, 0.24],
    [6, 0.04, 0.18],
  ] as const) {
    const f = freq * ratio * Math.sqrt(1 + B * ratio * ratio);
    if (f > 13000) continue;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    const d = Math.max(0.12, decay * ds);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * amp), t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g);
    g.connect(bus);
    o.start(t0);
    o.stop(t0 + d + 0.05);
  }
  // Felt: a very short filtered knock at the attack.
  const n = noise(ctx);
  const nf = ctx.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = Math.min(7000, freq * 3.2);
  nf.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(Math.max(0.0002, gain * 0.42), t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
  n.connect(nf);
  nf.connect(ng);
  ng.connect(bus);
  n.start(t0);
  n.stop(t0 + 0.08);
  return bus;
}

/** Harp: a plucked string with inharmonic partials and a soft transient. */
function harp(ctx: AudioContext, out: AudioNode, when: number, freq: number, gain: number, decay: number, timbre: number): GainNode {
  const t0 = Math.max(when, ctx.currentTime);
  const bus = ctx.createGain();
  bus.gain.value = 1;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.setValueAtTime(Math.min(9000, freq * 8), t0);
  tone.frequency.exponentialRampToValueAtTime(Math.max(320, freq * 2), t0 + decay * 0.8);
  bus.connect(tone);
  tone.connect(out);
  const inharmonic = 0.0004 + timbre * 0.0004;
  for (const [ratio, amp, ds] of [
    [1, 1, 1],
    [2, 0.36, 0.6],
    [3, 0.17, 0.4],
    [4, 0.09, 0.28],
    [5, 0.05, 0.2],
  ] as const) {
    const f = freq * ratio * Math.sqrt(1 + inharmonic * ratio * ratio);
    if (f > 12000) continue;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    const d = Math.max(0.09, decay * ds);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * amp), t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g);
    g.connect(bus);
    o.start(t0);
    o.stop(t0 + d + 0.05);
  }
  return bus;
}

/** Brass: a detuned saw stack opening through a filter. */
function brass(ctx: AudioContext, out: AudioNode, when: number, semitones: number[], gain: number, length: number): GainNode {
  const t0 = Math.max(when, ctx.currentTime);
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, t0);
  bus.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.09);
  bus.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(500, t0);
  f.frequency.exponentialRampToValueAtTime(3200, t0 + 0.16);
  f.frequency.exponentialRampToValueAtTime(700, t0 + length);
  f.Q.value = 1.4;
  bus.connect(f);
  f.connect(out);
  for (const semi of semitones.slice(0, 3)) {
    for (const detune of [-8, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = noteHz(semi, 1);
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = 0.16;
      o.connect(g);
      g.connect(bus);
      o.start(t0);
      o.stop(t0 + length + 0.1);
    }
  }
  return bus;
}

/** Timpani: a pitched drum that bends down onto its note. */
function timpani(ctx: AudioContext, out: AudioNode, when: number, gain: number, freq: number): GainNode {
  const t0 = Math.max(when, ctx.currentTime);
  const bus = ctx.createGain();
  bus.gain.value = 1;
  bus.connect(out);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 2.1, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, freq), t0 + 0.14);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
  o.connect(g);
  g.connect(bus);
  o.start(t0);
  o.stop(t0 + 1);
  const n = noise(ctx);
  const nf = ctx.createBiquadFilter();
  nf.type = 'lowpass';
  nf.frequency.value = 700;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(Math.max(0.0002, gain * 0.4), t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
  n.connect(nf);
  nf.connect(ng);
  ng.connect(bus);
  n.start(t0);
  n.stop(t0 + 0.3);
  return bus;
}

/** Cymbal: a filtered shimmer that swells and fades. */
function cymbal(ctx: AudioContext, out: AudioNode, when: number, gain: number, length: number): GainNode {
  const t0 = Math.max(when, ctx.currentTime);
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, t0);
  bus.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + length * 0.25);
  bus.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  bus.connect(out);
  const n = noise(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 5200;
  n.connect(hp);
  hp.connect(bus);
  n.start(t0);
  n.stop(t0 + length + 0.1);
  return bus;
}

/** Strings rising into a merge. */
function crescendo(ctx: AudioContext, out: AudioNode, when: number, semitones: number[], length: number, gain: number): GainNode {
  const t0 = Math.max(when, ctx.currentTime);
  const end = Math.max(t0 + 0.25, when + length);
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, t0);
  bus.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), end);
  bus.gain.exponentialRampToValueAtTime(0.0001, end + 0.18);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(320, t0);
  f.frequency.exponentialRampToValueAtTime(2600, end);
  f.Q.value = 1.2;
  bus.connect(f);
  f.connect(out);
  for (const semi of semitones.slice(0, 3)) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = noteHz(semi, 1);
    o.detune.value = 5;
    const g = ctx.createGain();
    g.gain.value = 0.18;
    o.connect(g);
    g.connect(bus);
    o.start(t0);
    o.stop(end + 0.3);
  }
  return bus;
}

/* -------------------------------- sources ------------------------------- */

let noiseBuffer: AudioBuffer | null = null;
function noise(ctx: AudioContext): AudioBufferSourceNode {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    // Deterministic xorshift noise: no Math.random anywhere in the engine.
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
  return src;
}

/** A decaying-noise impulse response: enough hall to make a section cohere. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let s = 0x2545f491;
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      const white = ((s >>> 0) / 4294967296) * 2 - 1;
      data[i] = white * Math.pow(1 - i / len, 2.6);
    }
  }
  return buf;
}
