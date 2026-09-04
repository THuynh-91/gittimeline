import { fnv1a32 } from './hash';

/**
 * Versioned seeded PRNG (sfc32). All aesthetic variance in compiled output
 * flows through this so the same seed reproduces the same performance.
 * `Math.random()` is lint-banned in src/.
 */
export interface Prng {
  next(): number; // [0, 1)
  range(min: number, max: number): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  fork(label: string): Prng;
}

export const PRNG_VERSION = 1;

export function createPrng(seed: string): Prng {
  let a = fnv1a32(`${seed}:a:${PRNG_VERSION}`);
  let b = fnv1a32(`${seed}:b:${PRNG_VERSION}`);
  let c = fnv1a32(`${seed}:c:${PRNG_VERSION}`);
  let d = fnv1a32(`${seed}:d:${PRNG_VERSION}`);

  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Warm up to decorrelate similar seeds.
  for (let i = 0; i < 12; i++) next();

  const prng: Prng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    fork: (label) => createPrng(`${seed}/${label}`),
  };
  return prng;
}

/** Stable pseudo-random in [0,1) from a string — no state, for per-entity jitter. */
export function hash01(input: string): number {
  return fnv1a32(input) / 4294967296;
}
