import type { CommitNode, Coverage, Dataset, ParentEdge, RefRecord, RepositorySource } from './types';
import { contentHashOf } from './hash';
import { cleanText, isSha, LIMITS, safeGitHubUrl, subjectOf } from './sanitize';
import { buildContributors, identityKey, isBotIdentity, type ContributorTally, type RawIdentity } from '@/analysis/contributors';

/**
 * Provider-neutral raw records → canonical Dataset. Both the GitHub adapter
 * and the synthetic fixtures feed this so every truth rule (dedupe, caps,
 * sanitization, identity hashing, boundary detection, coverage) lives once.
 */
export interface RawCommitRecord {
  sha: string;
  parents: string[];
  message: string;
  author: RawIdentity & { date?: string | null };
  committer?: (RawIdentity & { date?: string | null }) | null;
  url?: string | null;
  stats?: { additions: number; deletions: number; filesChanged: number } | null;
}

export interface RawRef {
  kind: RefRecord['kind'];
  name: string;
  targetSha: string;
  sourceUrl?: string | null;
}

export interface CoverageHints {
  reportedCommitCount?: number | null;
  warnings?: string[];
  /** True when pagination stopped before reaching the roots. */
  truncated?: boolean;
}

export function buildDataset(source: RepositorySource, raw: RawCommitRecord[], rawRefs: RawRef[], hints: CoverageHints = {}): Dataset {
  const bySha = new Map<string, RawCommitRecord>();
  for (const r of raw) {
    if (!isSha(r.sha)) continue;
    const sha = r.sha.toLowerCase();
    if (!bySha.has(sha)) bySha.set(sha, { ...r, sha });
    if (bySha.size >= LIMITS.maxCommits) break;
  }
  const shas = [...bySha.keys()].sort();

  const tallies = new Map<string, ContributorTally>();
  const tally = (raw: RawIdentity, when: number) => {
    const key = identityKey(raw);
    const t = tallies.get(key);
    if (t) {
      t.count++;
      t.firstSeen = Math.min(t.firstSeen, when);
      if (!t.raw.login && raw.login) t.raw = { ...t.raw, ...raw };
    } else tallies.set(key, { key, raw, count: 1, firstSeen: when });
    return key;
  };

  const commits: CommitNode[] = [];
  const edges: ParentEdge[] = [];
  let boundaryCount = 0;
  let minT = Infinity;
  let maxT = -Infinity;
  for (const sha of shas) {
    const r = bySha.get(sha)!;
    const parents = (Array.isArray(r.parents) ? r.parents : [])
      .filter(isSha)
      .map((p) => p.toLowerCase())
      .slice(0, LIMITS.maxParents);
    const authoredAt = validDate(r.author?.date);
    const committedAt = validDate(r.committer?.date);
    const when = authoredAt ? Date.parse(authoredAt) : committedAt ? Date.parse(committedAt) : 0;
    if (when) {
      minT = Math.min(minT, when);
      maxT = Math.max(maxT, when);
    }
    const authorId = tally(r.author ?? {}, when);
    const committerId = r.committer ? identityKey(r.committer) : null;
    const isBoundary = parents.some((p) => !bySha.has(p));
    if (isBoundary) boundaryCount++;
    parents.forEach((p, i) => edges.push({ parentSha: p, childSha: sha, parentIndex: i, provenance: bySha.has(p) ? 'exact' : 'unknown' }));
    commits.push({
      sha,
      parentShas: parents,
      authorIdentityId: authorId,
      committerIdentityId: committerId,
      authoredAtRaw: authoredAt,
      committedAtRaw: committedAt,
      presentationTime: when,
      messageSubject: subjectOf(r.message),
      messageBodyAvailable: typeof r.message === 'string' && r.message.includes('\n'),
      githubUrl: safeGitHubUrl(r.url) ?? (source.provider === 'github' ? `${source.canonicalUrl}/commit/${sha}` : null),
      ...(r.stats ? { stats: { additions: clampInt(r.stats.additions), deletions: clampInt(r.stats.deletions), filesChanged: clampInt(r.stats.filesChanged) } } : {}),
      flags: {
        isMerge: parents.length > 1,
        isBoundary,
        isTimeCorrected: false,
        isBot: isBotIdentity(r.author ?? {}),
      },
      provenance: 'exact',
    });
  }

  const refs: RefRecord[] = [];
  const seenRefs = new Set<string>();
  for (const r of rawRefs.slice(0, LIMITS.maxRefs)) {
    if (!isSha(r.targetSha)) continue;
    const name = cleanText(r.name, LIMITS.refName);
    if (!name) continue;
    const id = `${r.kind}:${name}`;
    if (seenRefs.has(id)) continue;
    seenRefs.add(id);
    refs.push({ id, kind: r.kind, name, targetSha: r.targetSha.toLowerCase(), current: true, sourceUrl: safeGitHubUrl(r.sourceUrl), provenance: 'exact' });
  }
  refs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const contributors = buildContributors([...tallies.values()]);
  const warnings = [...(hints.warnings ?? [])];
  const reported = hints.reportedCommitCount ?? null;
  const complete = boundaryCount === 0 && !hints.truncated;
  let summary: string;
  if (commits.length === 0) summary = 'No commits are known for this repository.';
  else if (complete) summary = `${commits.length.toLocaleString('en-US')} commits loaded — the full known history from GitHub.`;
  else summary = `${commits.length.toLocaleString('en-US')} recent commits loaded; earlier topology is not yet available${reported && reported > commits.length ? ` (GitHub reports about ${reported.toLocaleString('en-US')})` : ''}.`;
  if (!complete && commits.length) warnings.push('Partial history: commits whose parents were not loaded are shown as boundaries, never as roots.');

  const coverage: Coverage = {
    completeness: commits.length === 0 ? 'exact' : complete ? 'exact' : 'unknown',
    knownRanges: Number.isFinite(minT) ? [[minT, maxT]] : [],
    warnings,
    summary,
    knownCommitCount: commits.length,
    boundaryCount,
    reportedCommitCount: reported,
  };

  const ds: Dataset = {
    schemaVersion: 1,
    source,
    coverage,
    commits,
    edges,
    refs,
    contributors,
    contentHash: '',
  };
  ds.contentHash = contentHashOf({
    commits: commits.map((c) => [c.sha, c.parentShas, c.authorIdentityId, c.authoredAtRaw, c.messageSubject]),
    refs: refs.map((r) => [r.id, r.targetSha]),
    schema: ds.schemaVersion,
  });
  return ds;
}

function validDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function clampInt(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  return Math.min(n, 1e9);
}
