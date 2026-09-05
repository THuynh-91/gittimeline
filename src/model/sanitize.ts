/**
 * Repository text (messages, names, refs, descriptions) is hostile input.
 * Everything that reaches the UI is rendered as text nodes, never HTML, and
 * capped in length here so oversized or control-character-laden metadata
 * cannot break layout or storage.
 */

export const LIMITS = {
  subject: 160,
  name: 80,
  refName: 120,
  description: 240,
  login: 60,
  /**
   * The structural ceiling on a normalized dataset.
   *
   * This used to be 60,000, which was really a *fetch* budget wearing a
   * normalizer's clothes: it existed so a browser could not be talked into
   * paging through a million commits from the API one hundred at a time. But
   * it also silently truncated precomputed artifacts, which are built by
   * cloning rather than fetching and have no such problem — Linux arrived with
   * 1,481,850 commits and came out the other side with 60,000, described as
   * whole. A cap that quietly changes what a history *is* has to be far above
   * anything real rather than in the middle of it.
   *
   * The fetch budget it was standing in for is now `maxLiveCommits`.
   */
  maxCommits: 2_000_000,
  /** What a live GitHub fetch will pull before it stops and says so. */
  maxLiveCommits: 60_000,
  maxRefs: 4_000,
  /**
   * Linux has an octopus merge with 66 parents, so 64 was not a generous
   * bound — it was one that silently rewrote the topology of a real commit.
   */
  maxParents: 128,
} as const;

// Control characters, bidi overrides and zero-width characters are removed so
// text cannot masquerade as UI or hide content.
const STRIP = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
  'g',
);

export function cleanText(input: unknown, max: number, fallback = ''): string {
  if (typeof input !== 'string') return fallback;
  let s = input.normalize('NFC').replace(STRIP, '').replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s || fallback;
}

export function subjectOf(message: unknown): string {
  if (typeof message !== 'string') return '';
  const firstLine = message.split(/\r?\n/, 1)[0] ?? '';
  return cleanText(firstLine, LIMITS.subject);
}

export function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{7,64}$/i.test(value);
}

/** Only https://github.com/... links are ever navigable from the UI. */
export function safeGitHubUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return null;
    if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
    u.hash = '';
    u.search = '';
    return u.toString();
  } catch {
    return null;
  }
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Deep-clone plain JSON while rejecting prototype-polluting keys. */
export function safeJsonClone<T>(value: T, depth = 0): T {
  if (depth > 64) throw new Error('JSON nesting too deep');
  if (Array.isArray(value)) return value.map((v) => safeJsonClone(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out[k] = safeJsonClone(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
