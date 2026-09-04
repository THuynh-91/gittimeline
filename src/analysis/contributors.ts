import type { ContributorGlyph, ContributorIdentity } from '@/model/types';
import { fnv1a32, fnv1a64Hex } from '@/model/hash';
import { hueDistance, oklchToHex } from '@/model/color';
import { cleanText, LIMITS } from '@/model/sanitize';

/**
 * Contributor identity normalization.
 * Keys prefer GitHub numeric id, then login, then a hash of the normalized
 * name+email. Raw email addresses never leave this module.
 */
export interface RawIdentity {
  login?: string | null;
  numericId?: number | null;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  /** Precomputed identity key (artifact import) — raw emails are never stored. */
  key?: string | null;
}

const GLYPHS: ContributorGlyph[] = ['orb', 'diamond', 'triangle', 'square', 'ring', 'star', 'hex', 'cross'];
const BOT_PATTERNS = [/\[bot\]$/i, /^dependabot/i, /^renovate/i, /^github-actions/i, /^greenkeeper/i, /-bot$/i, /^bot-/i];

export function identityKey(raw: RawIdentity): string {
  if (raw.key && /^[a-z]+:[\w.-]{1,80}$/i.test(raw.key)) return raw.key;
  if (raw.numericId != null && Number.isFinite(raw.numericId)) return `gh:${raw.numericId}`;
  if (raw.login) return `login:${raw.login.toLowerCase()}`;
  const name = (raw.name ?? '').trim().toLowerCase();
  const email = (raw.email ?? '').trim().toLowerCase();
  if (!name && !email) return 'anon:unknown';
  // Anonymous authors with distinct names/emails stay distinct.
  return `local:${fnv1a64Hex(`${name}|${email}`)}`;
}

export function isBotIdentity(raw: RawIdentity): boolean {
  const login = raw.login ?? '';
  const name = raw.name ?? '';
  return BOT_PATTERNS.some((p) => p.test(login) || p.test(name));
}

export interface ContributorTally {
  key: string;
  raw: RawIdentity;
  count: number;
  firstSeen: number;
}

/**
 * Assign stable signatures. Hue derives from the key hash, then colors are
 * pushed apart in order of activity so the most active contributors are
 * perceptually distinct from one another.
 */
export function buildContributors(tallies: ContributorTally[]): ContributorIdentity[] {
  const sorted = [...tallies].sort((a, b) => b.count - a.count || a.firstSeen - b.firstSeen || (a.key < b.key ? -1 : 1));
  const takenHues: number[] = [];
  const out: ContributorIdentity[] = [];
  for (const t of sorted) {
    const isBot = isBotIdentity(t.raw);
    const h32 = fnv1a32(`hue:${t.key}`);
    let hue = (h32 % 360) + ((h32 >>> 9) % 100) / 100;
    if (!isBot) {
      // Push away from the nearest taken hue until at least 28° apart (bounded attempts).
      for (let attempt = 0; attempt < 12; attempt++) {
        const near = takenHues.find((th) => hueDistance(th, hue) < 28);
        if (near === undefined) break;
        hue = (hue + 37 + attempt * 11) % 360;
      }
      takenHues.push(hue);
    }
    const color = isBot ? '#8fa3b0' : oklchToHex(0.8, 0.17, hue);
    const glyph: ContributorGlyph = isBot ? 'square' : GLYPHS[(fnv1a32(`glyph:${t.key}`) % (GLYPHS.length - 1)) + (0 as number)]!;
    const login = t.raw.login ? cleanText(t.raw.login, LIMITS.login) : null;
    const name = cleanText(t.raw.name, LIMITS.name) || login || 'Anonymous author';
    out.push({
      id: t.key,
      githubLogin: login,
      displayName: name,
      githubNumericId: t.raw.numericId ?? null,
      avatarUrl: t.raw.avatarUrl ? String(t.raw.avatarUrl).slice(0, 300) : null,
      color,
      glyph,
      isBot,
      aliases: [],
      provenance: t.raw.numericId != null || t.raw.login ? 'exact' : 'derived',
      commitCount: t.count,
    });
  }
  return out;
}
