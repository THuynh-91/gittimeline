import type { ActivityBucket, CommitNode, Era, Provenance } from '@/model/types';
import type { GraphIndex } from '@/dag/graph';

/**
 * Repository-relative intensity model (spec §10.3). Features are percentile-
 * normalized against the repository's own non-empty buckets so a small
 * project's busiest week can feel climactic. Weights are renormalized when a
 * feature is unavailable. The model is configuration-driven and versioned
 * through ENGINE.analyzerVersion.
 */
export const INTENSITY_WEIGHTS = {
  commits: 0.2,
  threads: 0.24,
  merges: 0.22,
  contributors: 0.12,
  change: 0.08,
  novelty: 0.09,
  releases: 0.05,
} as const;

export interface ActivityInput {
  g: GraphIndex;
  commits: CommitNode[];
  presentation: Float64Array;
  threadOf: Int32Array;
  /** Thread spans in historical time [start, end]. */
  threadSpans: Array<[number, number]>;
  contributorOf: Int32Array;
  mergeSignificance: Float32Array;
  tagCount: Int32Array;
  isDivergenceStart: Uint8Array;
  coverage: Provenance;
}

export interface ActivityResult {
  buckets: ActivityBucket[];
  eras: Omit<Era, 'performanceStart' | 'performanceEnd'>[];
  /** Phrase intensity per node id (from its bucket). */
  nodeIntensity: Float32Array;
  hasChangeData: boolean;
}

export function analyzeActivity(input: ActivityInput): ActivityResult {
  const { commits, presentation } = input;
  const n = commits.length;
  if (n === 0) return { buckets: [], eras: [], nodeIntensity: new Float32Array(0), hasChangeData: false };

  let t0 = Infinity;
  let t1 = -Infinity;
  for (let i = 0; i < n; i++) {
    t0 = Math.min(t0, presentation[i]!);
    t1 = Math.max(t1, presentation[i]!);
  }
  if (t1 <= t0) t1 = t0 + 1;
  const count = Math.max(40, Math.min(320, Math.round(n / 2)));
  const width = (t1 - t0) / count;

  const commitsPer = new Int32Array(count);
  const mergesPer = new Int32Array(count);
  const mergeSig = new Float32Array(count);
  const tagsPer = new Int32Array(count);
  const changePer = new Float32Array(count);
  const noveltyPer = new Float32Array(count);
  const contribSets: Array<Set<number>> = Array.from({ length: count }, () => new Set());
  const threadSets: Array<Set<number>> = Array.from({ length: count }, () => new Set());
  let hasChangeData = false;

  const bucketOf = (t: number) => Math.min(count - 1, Math.max(0, Math.floor((t - t0) / width)));

  for (let i = 0; i < n; i++) {
    const b = bucketOf(presentation[i]!);
    commitsPer[b]!++;
    const c = commits[i]!;
    if (c.flags.isMerge) {
      mergesPer[b]!++;
      mergeSig[b] = mergeSig[b]! + input.mergeSignificance[i]!;
    }
    tagsPer[b] = tagsPer[b]! + input.tagCount[i]!;
    if (c.stats) {
      hasChangeData = true;
      changePer[b] = changePer[b]! + Math.log1p(c.stats.additions + c.stats.deletions);
    }
    if (input.isDivergenceStart[i]) noveltyPer[b] = noveltyPer[b]! + 1;
    if (c.parentShas.length === 0) noveltyPer[b] = noveltyPer[b]! + 1.5;
    if (c.parentShas.length > 2) noveltyPer[b] = noveltyPer[b]! + 2;
    contribSets[b]!.add(input.contributorOf[i]!);
    threadSets[b]!.add(input.threadOf[i]!);
  }
  // Threads alive across a bucket (between their commits) count as concurrent work.
  input.threadSpans.forEach(([s, e], tIdx) => {
    const b0 = bucketOf(s);
    const b1 = bucketOf(e);
    for (let b = b0; b <= b1; b++) if (commitsPer[b]! > 0) threadSets[b]!.add(tIdx);
  });

  const threadsPer = Float32Array.from(threadSets, (s) => s.size);
  const contribPer = Float32Array.from(contribSets, (s) => s.size);

  const pC = percentiles(commitsPer);
  const pT = percentiles(threadsPer);
  const pM = percentiles(Float32Array.from(mergesPer, (m, i) => m + mergeSig[i]!));
  const pU = percentiles(contribPer);
  const pD = hasChangeData ? percentiles(changePer) : null;
  const pN = percentiles(noveltyPer);
  const pR = percentiles(Float32Array.from(tagsPer));

  const w = { ...INTENSITY_WEIGHTS };
  let wsum = w.commits + w.threads + w.merges + w.contributors + w.novelty + w.releases + (pD ? w.change : 0);
  if (wsum <= 0) wsum = 1;

  const raw = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    if (commitsPer[b] === 0) continue;
    raw[b] =
      (w.commits * pC[b]! +
        w.threads * pT[b]! +
        w.merges * pM[b]! +
        w.contributors * pU[b]! +
        (pD ? w.change * pD[b]! : 0) +
        w.novelty * pN[b]! +
        w.releases * pR[b]!) /
      wsum;
  }
  // Stretch the repository's own observed range across the full scale. Without
  // this, features that are flat for a given project (no merges, one thread)
  // permanently damp the signal and every span ends up feeling the same. This
  // is what gives each repository its own dynamic range.
  let lo = Infinity;
  let hi = -Infinity;
  for (let b = 0; b < count; b++) {
    if (commitsPer[b] === 0) continue;
    lo = Math.min(lo, raw[b]!);
    hi = Math.max(hi, raw[b]!);
  }
  if (Number.isFinite(lo) && hi > lo + 1e-6) {
    for (let b = 0; b < count; b++) {
      if (commitsPer[b] === 0) continue;
      raw[b] = 0.06 + 0.94 * ((raw[b]! - lo) / (hi - lo));
    }
  } else if (Number.isFinite(lo)) {
    for (let b = 0; b < count; b++) if (commitsPer[b]! > 0) raw[b] = 0.5;
  }

  const phrase = smooth(raw, 2, true);
  const era = smooth(raw, Math.max(4, Math.round(count / 14)), false);

  const buckets: ActivityBucket[] = [];
  for (let b = 0; b < count; b++) {
    buckets.push({
      historicalStart: t0 + b * width,
      historicalEnd: t0 + (b + 1) * width,
      knownCommitCount: commitsPer[b]!,
      activeThreadCount: commitsPer[b]! > 0 ? threadsPer[b]! : null,
      contributorCount: commitsPer[b]! > 0 ? contribPer[b]! : null,
      mergeCount: mergesPer[b]!,
      tagCount: tagsPer[b]!,
      changeMagnitude: hasChangeData ? changePer[b]! : null,
      topologyNovelty: noveltyPer[b]!,
      rawIntensity: raw[b]!,
      phraseIntensity: phrase[b]!,
      eraIntensity: era[b]!,
      coverage: input.coverage,
    });
  }

  const nodeIntensity = new Float32Array(n);
  for (let i = 0; i < n; i++) nodeIntensity[i] = phrase[bucketOf(presentation[i]!)]!;

  return { buckets, eras: detectEras(buckets), nodeIntensity, hasChangeData };
}

/** Rank-based percentile in [0,1] over non-zero entries; zeros stay 0. */
function percentiles(values: Float32Array | Int32Array): Float32Array {
  const idx: number[] = [];
  for (let i = 0; i < values.length; i++) if (values[i]! > 0) idx.push(i);
  const out = new Float32Array(values.length);
  if (idx.length === 0) return out;
  idx.sort((a, b) => values[a]! - values[b]! || a - b);
  // When a feature is constant it carries no information; a flat neutral value
  // keeps it from injecting rank noise into the intensity model.
  if (values[idx[0]!] === values[idx[idx.length - 1]!]) {
    for (const i of idx) out[i] = 0.5;
    return out;
  }
  for (let r = 0; r < idx.length; r++) out[idx[r]!] = idx.length === 1 ? 1 : 0.15 + (0.85 * r) / (idx.length - 1);
  return out;
}

/** Symmetric moving average; `keepPeaks` preserves sharp important impulses. */
function smooth(values: Float32Array, radius: number, keepPeaks: boolean): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= values.length) continue;
      const wk = 1 - Math.abs(k) / (radius + 1);
      sum += values[j]! * wk;
      wsum += wk;
    }
    const s = wsum ? sum / wsum : 0;
    out[i] = keepPeaks ? Math.max(s, values[i]! * 0.85) : s;
  }
  return out;
}

/**
 * Era detection with hysteresis: sustained regime changes in era intensity,
 * concurrency and merge style. Names are factual and restrained.
 */
function detectEras(buckets: ActivityBucket[]): Omit<Era, 'performanceStart' | 'performanceEnd'>[] {
  const eras: Omit<Era, 'performanceStart' | 'performanceEnd'>[] = [];
  if (!buckets.length) return eras;
  const n = buckets.length;
  const minGap = Math.max(3, Math.round(n / 12)); // empty buckets needed to call a span dormant
  const lifetime = buckets[n - 1]!.historicalEnd - buckets[0]!.historicalStart;
  const minGapMs = Math.max(45 * 86_400_000, lifetime / 12); // ...and it must be a real stretch of calendar time
  const minLen = Math.max(3, Math.round(n / 10)); // buckets needed to call an intensity regime an era
  const level = (b: ActivityBucket) => (b.eraIntensity < 0.3 ? 1 : b.eraIntensity < 0.62 ? 2 : 3);

  // 1. Split into active runs and dormant runs (long empty stretches).
  const runs: Array<{ start: number; end: number; dormant: boolean }> = [];
  let i = 0;
  while (i < n) {
    if (buckets[i]!.knownCommitCount === 0) {
      let j = i;
      while (j < n && buckets[j]!.knownCommitCount === 0) j++;
      const spanMs = buckets[j - 1]!.historicalEnd - buckets[i]!.historicalStart;
      if (j - i >= minGap && spanMs >= minGapMs && runs.length) runs.push({ start: i, end: j, dormant: true });
      else if (runs.length) runs[runs.length - 1]!.end = j;
      else runs.push({ start: i, end: j, dormant: false });
      i = j;
    } else {
      let j = i;
      while (j < n && buckets[j]!.knownCommitCount > 0) j++;
      const last = runs[runs.length - 1];
      if (last && !last.dormant) last.end = j;
      else runs.push({ start: i, end: j, dormant: false });
      i = j;
    }
  }

  // 2. Within active runs, split by sustained intensity regime with hysteresis.
  const segments: Array<{ start: number; end: number; level: number }> = [];
  for (const run of runs) {
    if (run.dormant) {
      segments.push({ start: run.start, end: run.end, level: 0 });
      continue;
    }
    let segStart = run.start;
    let current = level(buckets[run.start]!);
    let pendingSince = -1;
    for (let k = run.start + 1; k < run.end; k++) {
      const l = level(buckets[k]!);
      if (l !== current) {
        if (pendingSince === -1) pendingSince = k;
        if (k - pendingSince + 1 >= 3 && pendingSince - segStart >= minLen) {
          segments.push({ start: segStart, end: pendingSince, level: current });
          segStart = pendingSince;
          current = l;
          pendingSince = -1;
        }
      } else pendingSince = -1;
    }
    segments.push({ start: segStart, end: run.end, level: current });
  }

  segments.forEach((seg, k) => {
    const slice = buckets.slice(seg.start, seg.end);
    const commits = slice.reduce((s, b) => s + b.knownCommitCount, 0);
    const merges = slice.reduce((s, b) => s + b.mergeCount, 0);
    const threads = Math.max(0, ...slice.map((b) => b.activeThreadCount ?? 0));
    const contributors = Math.max(0, ...slice.map((b) => b.contributorCount ?? 0));
    const intensity = slice.reduce((s, b) => s + b.eraIntensity, 0) / Math.max(1, slice.length);
    const prev = segments[k - 1];
    let label: string;
    if (seg.level === 0) label = 'dormancy';
    else if (k === 0) label = 'formation';
    else if (prev && prev.level === 0) label = 'renewed activity';
    else if (merges > commits * 0.28 && merges >= 3) label = 'merge-heavy period';
    else if (seg.level === 3) label = 'rapid expansion';
    else if (seg.level === 1) label = 'maintenance';
    else label = 'steady development';
    const description = seg.level === 0
      ? 'No known commits in this span.'
      : `${commits} known commits, up to ${threads} concurrent thread${threads === 1 ? '' : 's'}, ${contributors} contributor${contributors === 1 ? '' : 's'}, ${merges} merge${merges === 1 ? '' : 's'}.`;
    eras.push({
      id: `era-${k}`,
      label,
      historicalStart: slice[0]!.historicalStart,
      historicalEnd: slice[slice.length - 1]!.historicalEnd,
      intensity,
      description,
    });
  });
  return eras;
}
