import { GitHubError, type GitHubClient } from './adapter';
import type { RepoRef } from './url';
import type { RateInfo } from './ratelimit';
import { buildDataset, type RawCommitRecord, type RawRef } from '@/model/dataset';
import type { Dataset, RepositorySource } from '@/model/types';
import { cleanText, isSha, LIMITS } from '@/model/sanitize';

/**
 * Staged, budgeted, cancellable ingestion (spec §14.2):
 *  0 validate → 1 anchor (metadata + newest page) → 2 expand default history →
 *  3 discover surviving tips → 4 landmarks (tags) → normalize.
 * Every stop is truthful: a run that ends early yields a partial dataset
 * with boundary nodes and a coverage summary, never invented topology.
 */
export type IngestPhase = 'validating' | 'metadata' | 'anchor' | 'expanding' | 'tips' | 'landmarks' | 'normalizing';

export interface IngestProgress {
  phase: IngestPhase;
  message: string;
  pagesLoaded: number;
  commitsLoaded: number;
  reportedTotal: number | null;
  rate: RateInfo | null;
  repoName: string | null;
  fromCache: boolean;
}

export interface IngestOptions {
  client: GitHubClient;
  signal: AbortSignal;
  onProgress: (p: IngestProgress) => void;
  /** Hard cap on commit pages for the default branch. */
  maxPages?: number;
  /** Requests to keep in reserve for recovery/metadata. */
  reserve?: number;
  includeBranches?: boolean;
  pinnedTip?: string | null;
}

export type IngestOutcome = 'complete' | 'partial' | 'rate-limited' | 'offline-cached';

export interface IngestResult {
  dataset: Dataset;
  outcome: IngestOutcome;
  rate: RateInfo | null;
  resetAt: number | null;
  requests: number;
  fromCache: boolean;
}

interface RepoMeta {
  default_branch?: string;
  description?: string | null;
  created_at?: string;
  pushed_at?: string;
  size?: number;
  html_url?: string;
  full_name?: string;
  private?: boolean;
}

interface ApiCommit {
  sha: string;
  html_url?: string;
  commit?: { message?: string; author?: { name?: string; email?: string; date?: string }; committer?: { name?: string; email?: string; date?: string } };
  author?: { login?: string; id?: number; avatar_url?: string } | null;
  committer?: { login?: string; id?: number } | null;
  parents?: Array<{ sha: string }>;
}

interface ApiRef {
  name: string;
  commit?: { sha?: string };
}

export async function ingestRepository(repo: RepoRef, opts: IngestOptions): Promise<IngestResult> {
  const { client, signal } = opts;
  const maxPages = opts.maxPages ?? 40;
  const reserve = opts.reserve ?? 3;
  let pages = 0;
  const commits = new Map<string, RawCommitRecord>();
  let reportedTotal: number | null = null;
  let anyFromCache = false;
  let stale = false;
  let rateLimitedAt: RateInfo | null = null;
  const warnings: string[] = [];

  const report = (phase: IngestPhase, message: string, repoName: string | null) =>
    opts.onProgress({ phase, message, pagesLoaded: pages, commitsLoaded: commits.size, reportedTotal, rate: client.rate, repoName, fromCache: anyFromCache });

  const budgetLeft = () => client.rate.remaining == null || client.rate.remaining > reserve;
  const check = () => {
    if (signal.aborted) throw new GitHubError('aborted', 'Cancelled');
  };

  // Stage 0/1: metadata
  report('metadata', 'Reading repository…', null);
  const metaRes = await client.get<RepoMeta>(repo.apiUrl);
  anyFromCache ||= metaRes.fromCache;
  stale ||= metaRes.stale;
  const meta = metaRes.data ?? {};
  const defaultBranch = typeof meta.default_branch === 'string' ? cleanText(meta.default_branch, LIMITS.refName) : null;
  const displayName = typeof meta.full_name === 'string' ? cleanText(meta.full_name, 160) : repo.slug;
  check();

  const source: RepositorySource = {
    provider: 'github',
    owner: repo.owner,
    name: repo.name,
    canonicalUrl: repo.canonicalUrl,
    apiUrl: repo.apiUrl,
    defaultBranch,
    selectedRef: defaultBranch,
    selectedTipSha: opts.pinnedTip ?? null,
    fetchedAt: new Date().toISOString(),
    description: typeof meta.description === 'string' ? cleanText(meta.description, LIMITS.description) : null,
    createdAt: typeof meta.created_at === 'string' ? meta.created_at : null,
    pushedAt: typeof meta.pushed_at === 'string' ? meta.pushed_at : null,
  };

  const addCommits = (list: ApiCommit[]) => {
    for (const c of list) {
      if (!c || !isSha(c.sha) || commits.has(c.sha.toLowerCase())) continue;
      commits.set(c.sha.toLowerCase(), {
        sha: c.sha,
        parents: (c.parents ?? []).map((p) => p?.sha).filter(isSha),
        message: c.commit?.message ?? '',
        author: {
          name: c.commit?.author?.name ?? null,
          email: c.commit?.author?.email ?? null,
          login: c.author?.login ?? null,
          numericId: typeof c.author?.id === 'number' ? c.author.id : null,
          avatarUrl: c.author?.avatar_url ?? null,
          date: c.commit?.author?.date ?? null,
        },
        committer: {
          name: c.commit?.committer?.name ?? null,
          email: c.commit?.committer?.email ?? null,
          login: c.committer?.login ?? null,
          numericId: typeof c.committer?.id === 'number' ? c.committer.id : null,
          date: c.commit?.committer?.date ?? null,
        },
        url: c.html_url ?? null,
      });
      if (commits.size >= LIMITS.maxCommits) break;
    }
  };

  // Stage 1/2: default history, newest first, following pagination under budget.
  const anchorSha = opts.pinnedTip ?? defaultBranch;
  let url: string | null = `${repo.apiUrl}/commits?per_page=100${anchorSha ? `&sha=${encodeURIComponent(anchorSha)}` : ''}`;
  let truncated = false;
  report('anchor', 'Establishing the anchor…', displayName);
  try {
    while (url) {
      check();
      if (pages >= maxPages) {
        truncated = true;
        warnings.push(`Stopped after ${pages} pages to stay within GitHub’s request limit; earlier history is not loaded.`);
        break;
      }
      if (!budgetLeft()) {
        truncated = true;
        warnings.push('Stopped before exhausting GitHub’s anonymous request limit; earlier history is not loaded.');
        break;
      }
      const res: Awaited<ReturnType<typeof client.get<ApiCommit[]>>> = await client.get<ApiCommit[]>(url);
      anyFromCache ||= res.fromCache;
      stale ||= res.stale;
      pages++;
      if (!Array.isArray(res.data)) throw new GitHubError('malformed', 'Unexpected commit list from GitHub.');
      addCommits(res.data);
      if (pages === 1 && res.link.lastPage) reportedTotal = res.link.lastPage * 100;
      if (pages === 1 && res.data[0] && !source.selectedTipSha) source.selectedTipSha = res.data[0].sha.toLowerCase();
      report('expanding', `Mapping ${commits.size.toLocaleString('en-US')} known commits…`, displayName);
      url = res.link.next;
      if (commits.size >= LIMITS.maxCommits) {
        truncated = true;
        break;
      }
    }
  } catch (err) {
    if (err instanceof GitHubError && err.kind === 'empty-repository') {
      const dataset = buildDataset(source, [], [], { warnings });
      return { dataset, outcome: 'complete', rate: client.rate, resetAt: null, requests: client.requests, fromCache: anyFromCache };
    }
    if (err instanceof GitHubError && (err.kind === 'rate-limited' || err.kind === 'secondary-limit') && commits.size > 0) {
      rateLimitedAt = err.rate;
      truncated = true;
      warnings.push('GitHub’s request limit was reached mid-way; the performance covers the commits loaded so far.');
    } else if (err instanceof GitHubError && (err.kind === 'offline' || err.kind === 'network') && commits.size > 0) {
      stale = true;
      truncated = true;
      warnings.push('GitHub could not be reached mid-way; the performance covers the cached commits only.');
    } else throw err;
  }

  // Stage 3: surviving parallel tips (current branches not yet reachable).
  const refs: RawRef[] = [];
  if (defaultBranch && source.selectedTipSha) refs.push({ kind: 'branch', name: defaultBranch, targetSha: source.selectedTipSha });
  if (opts.includeBranches !== false && !rateLimitedAt && budgetLeft()) {
    report('tips', 'Finding parallel threads…', displayName);
    try {
      const br = await client.get<ApiRef[]>(`${repo.apiUrl}/branches?per_page=100`);
      anyFromCache ||= br.fromCache;
      const branches = (Array.isArray(br.data) ? br.data : []).filter((b) => b && typeof b.name === 'string' && isSha(b.commit?.sha));
      const candidates = branches.filter((b) => b.name !== defaultBranch && !commits.has(b.commit!.sha!.toLowerCase())).slice(0, 8);
      for (const b of branches) if (b.name !== defaultBranch && commits.has(b.commit!.sha!.toLowerCase())) refs.push({ kind: 'branch', name: b.name, targetSha: b.commit!.sha! });
      for (const b of candidates) {
        check();
        if (!budgetLeft()) break;
        let tipUrl: string | null = `${repo.apiUrl}/commits?per_page=100&sha=${encodeURIComponent(b.commit!.sha!)}`;
        let tipPages = 0;
        let connected = false;
        while (tipUrl && tipPages < 3 && budgetLeft()) {
          const res: Awaited<ReturnType<typeof client.get<ApiCommit[]>>> = await client.get<ApiCommit[]>(tipUrl);
          anyFromCache ||= res.fromCache;
          tipPages++;
          pages++;
          if (!Array.isArray(res.data)) break;
          const before = commits.size;
          addCommits(res.data);
          // connected when every commit on the page has all of its parents loaded
          connected = res.data.every((c) => (c.parents ?? []).every((p) => commits.has(String(p.sha).toLowerCase())));
          if (connected || commits.size === before) break;
          tipUrl = res.link.next;
        }
        refs.push({ kind: 'branch', name: b.name, targetSha: b.commit!.sha! });
        if (!connected) warnings.push(`Branch “${cleanText(b.name, 60)}” did not connect to loaded history within budget; its older commits are shown as a boundary.`);
        report('tips', `Mapping ${commits.size.toLocaleString('en-US')} known commits…`, displayName);
      }
    } catch (err) {
      if (err instanceof GitHubError && (err.kind === 'rate-limited' || err.kind === 'secondary-limit')) {
        rateLimitedAt = err.rate;
        warnings.push('GitHub’s request limit was reached while reading branches; some parallel tips are not shown.');
      } else if (!(err instanceof GitHubError && err.kind === 'aborted')) {
        warnings.push('Branch list could not be read; only the default branch is shown.');
      } else throw err;
    }
  }

  // Stage 4: landmarks (tags) under a separate small budget.
  if (!rateLimitedAt && budgetLeft()) {
    report('landmarks', 'Placing releases…', displayName);
    try {
      const tg = await client.get<ApiRef[]>(`${repo.apiUrl}/tags?per_page=100`);
      anyFromCache ||= tg.fromCache;
      for (const t of Array.isArray(tg.data) ? tg.data : []) {
        if (t && typeof t.name === 'string' && isSha(t.commit?.sha) && commits.has(t.commit!.sha!.toLowerCase())) refs.push({ kind: 'tag', name: t.name, targetSha: t.commit!.sha! });
      }
    } catch (err) {
      if (err instanceof GitHubError && err.kind === 'aborted') throw err;
      if (err instanceof GitHubError && (err.kind === 'rate-limited' || err.kind === 'secondary-limit')) rateLimitedAt = err.rate;
      warnings.push('Tags could not be read within budget; releases are not marked.');
    }
  }

  check();
  report('normalizing', 'Composing…', displayName);
  if (stale) warnings.push('Some pages were served from the local cache because GitHub could not be reached.');
  const dataset = buildDataset(source, [...commits.values()], refs, { reportedCommitCount: reportedTotal, warnings, truncated });
  const outcome: IngestOutcome = rateLimitedAt ? 'rate-limited' : stale ? 'offline-cached' : dataset.coverage.completeness === 'exact' ? 'complete' : 'partial';
  return { dataset, outcome, rate: client.rate, resetAt: rateLimitedAt?.resetAt ?? null, requests: client.requests, fromCache: anyFromCache };
}
