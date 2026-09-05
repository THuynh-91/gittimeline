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
  /** ISO timestamps limiting the commits fetched, for scoping a huge history. */
  since?: string | null;
  until?: string | null;
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

export interface RepoProbe {
  /** Roughly how many commits the default branch has, from the pagination header. */
  estimatedCommits: number | null;
  /**
   * Fraction of the most recent hundred commits that are merges.
   *
   * This, not the commit count, is what decides whether a whole history can be
   * watched: merge junctions cannot be aggregated without hiding topology, so
   * a pull-request repository keeps nearly all of its commits on stage while a
   * linear one of the same size collapses into a handful of ribbons.
   */
  mergeRatio: number | null;
  defaultBranch: string | null;
  firstYear: number | null;
  lastYear: number | null;
  displayName: string;
}

/**
 * Two requests that tell us how big a job this is going to be. GitHub does not
 * expose a commit count, but the last page number of a one-per-page listing is
 * exactly that, so this costs two calls instead of hundreds.
 */
export async function probeRepository(repo: RepoRef, client: GitHubClient): Promise<RepoProbe> {
  const meta = await client.get<RepoMeta>(repo.apiUrl);
  const defaultBranch = typeof meta.data?.default_branch === 'string' ? cleanText(meta.data.default_branch, LIMITS.refName) : null;
  const created = typeof meta.data?.created_at === 'string' ? new Date(meta.data.created_at) : null;
  const pushed = typeof meta.data?.pushed_at === 'string' ? new Date(meta.data.pushed_at) : null;
  const branch = defaultBranch ? `&sha=${encodeURIComponent(defaultBranch)}` : '';
  let estimatedCommits: number | null;
  try {
    const head = await client.get<ApiCommit[]>(`${repo.apiUrl}/commits?per_page=1${branch}`);
    estimatedCommits = head.link.lastPage ?? (Array.isArray(head.data) ? head.data.length : null);
  } catch {
    estimatedCommits = null;
  }

  // How much of this project's work arrives as merges, sampled from its most
  // recent hundred commits. Size alone does not say whether a history can be
  // watched: a linear one collapses into ribbons however long it is, while a
  // pull-request repository is nearly all junctions and collapses hardly at
  // all. One request buys the difference between asking a useful question and
  // a useless one.
  let mergeRatio: number | null = null;
  try {
    const sample = await client.get<ApiCommit[]>(`${repo.apiUrl}/commits?per_page=100${branch}`);
    if (Array.isArray(sample.data) && sample.data.length) {
      const merges = sample.data.filter((c) => Array.isArray(c?.parents) && c.parents.length > 1).length;
      mergeRatio = merges / sample.data.length;
    }
  } catch {
    mergeRatio = null;
  }
  return {
    estimatedCommits,
    mergeRatio,
    defaultBranch,
    firstYear: created && Number.isFinite(created.getTime()) ? created.getUTCFullYear() : null,
    lastYear: pushed && Number.isFinite(pushed.getTime()) ? pushed.getUTCFullYear() : new Date().getUTCFullYear(),
    displayName: typeof meta.data?.full_name === 'string' ? cleanText(meta.data.full_name, 160) : repo.slug,
  };
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
      if (commits.size >= LIMITS.maxLiveCommits) break;
    }
  };

  // Stage 1/2: default history, newest first.
  //
  // The first page is fetched alone because it carries two things nothing else
  // can give us: the tip sha, and the `last` link that says how many pages
  // there are. Once that is known the remaining pages can be asked for by
  // number and fetched together — history is walked page by page only because
  // the *link* chain is sequential, not because the data is. On a large
  // repository that is the difference between minutes and hours: Linux's first
  // 59,000 commits took 597 sequential requests and twelve minutes, almost all
  // of it waiting.
  //
  // Batches stay in page order and stop at the first one that would exceed a
  // budget, so a truncated fetch is still a contiguous run from the newest
  // commit backwards. Holes in the middle would become boundaries scattered
  // through the history rather than one honest edge.
  const CONCURRENCY = 6;
  const anchorSha = opts.pinnedTip ?? defaultBranch;
  const range = `${opts.since ? `&since=${encodeURIComponent(opts.since)}` : ''}${opts.until ? `&until=${encodeURIComponent(opts.until)}` : ''}`;
  const base = `${repo.apiUrl}/commits?per_page=100${anchorSha ? `&sha=${encodeURIComponent(anchorSha)}` : ''}${range}`;
  let truncated = false;
  report('anchor', 'Establishing the anchor…', displayName);
  try {
    const first = await client.get<ApiCommit[]>(base);
    anyFromCache ||= first.fromCache;
    stale ||= first.stale;
    pages++;
    if (!Array.isArray(first.data)) throw new GitHubError('malformed', 'Unexpected commit list from GitHub.');
    addCommits(first.data);
    if (first.link.lastPage) reportedTotal = first.link.lastPage * 100;
    if (first.data[0] && !source.selectedTipSha) source.selectedTipSha = first.data[0].sha.toLowerCase();
    report('expanding', `Mapping ${commits.size.toLocaleString('en-US')} known commits…`, displayName);

    // How far can we go? Whichever of the three bounds bites first.
    const lastPage = first.link.lastPage ?? (first.link.next ? Infinity : 1);
    const wanted = Math.min(lastPage, maxPages);
    if (lastPage > maxPages) {
      // Known in advance that this fetch will not reach the end — but that is
      // a fact about the *result*, not a reason to stop now. Driving the loop
      // off this flag ended the fetch after the first page and quietly
      // returned a hundred commits wherever a page budget applied.
      truncated = true;
      warnings.push(`Stopped after ${maxPages} pages to stay within GitHub’s request limit; earlier history is not loaded.`);
    }

    let stop = false;
    for (let next = 2; next <= wanted && !stop; next += CONCURRENCY) {
      check();
      if (!budgetLeft()) {
        truncated = true;
        stop = true;
        warnings.push('Stopped before exhausting GitHub’s anonymous request limit; earlier history is not loaded.');
        break;
      }
      const batch: number[] = [];
      for (let n = next; n < next + CONCURRENCY && n <= wanted; n++) batch.push(n);
      // Settled, not all: a rate limit part-way through a batch must not throw
      // away the pages that already arrived. Take them in page order up to the
      // first failure and stop there — keeping a page from beyond a gap would
      // scatter boundaries through the history instead of leaving one edge.
      const results = await Promise.allSettled(batch.map((n) => client.get<ApiCommit[]>(`${base}&page=${n}`)));
      for (const settled of results) {
        if (settled.status === 'rejected') {
          const err = settled.reason;
          if (err instanceof GitHubError && (err.kind === 'rate-limited' || err.kind === 'secondary-limit')) {
            rateLimitedAt = err.rate;
            truncated = true;
            stop = true;
            warnings.push('GitHub’s request limit was reached mid-way; the performance covers the commits loaded so far.');
            break;
          }
          throw err;
        }
        const res = settled.value;
        anyFromCache ||= res.fromCache;
        stale ||= res.stale;
        pages++;
        if (!Array.isArray(res.data)) throw new GitHubError('malformed', 'Unexpected commit list from GitHub.');
        addCommits(res.data);
      }
      if (stop) break;
      report('expanding', `Mapping ${commits.size.toLocaleString('en-US')} known commits…`, displayName);
      if (commits.size >= LIMITS.maxLiveCommits) {
        truncated = true;
        stop = true;
        break;
      }
    }
    // `lastPage` is unknown when GitHub sends only a `next` link, which happens
    // on ranges it will not count. Fall back to walking that chain.
    if (!Number.isFinite(lastPage)) {
      let url: string | null = first.link.next;
      while (url && !truncated) {
        check();
        if (pages >= maxPages || !budgetLeft()) {
          truncated = true;
          warnings.push('Stopped before exhausting GitHub’s request limit; earlier history is not loaded.');
          break;
        }
        const res: Awaited<ReturnType<typeof client.get<ApiCommit[]>>> = await client.get<ApiCommit[]>(url);
        anyFromCache ||= res.fromCache;
        stale ||= res.stale;
        pages++;
        if (!Array.isArray(res.data)) throw new GitHubError('malformed', 'Unexpected commit list from GitHub.');
        addCommits(res.data);
        report('expanding', `Mapping ${commits.size.toLocaleString('en-US')} known commits…`, displayName);
        url = res.link.next;
        if (commits.size >= LIMITS.maxLiveCommits) {
          truncated = true;
          break;
        }
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
        let tipUrl: string | null = `${repo.apiUrl}/commits?per_page=100&sha=${encodeURIComponent(b.commit!.sha!)}${range}`;
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
  if (opts.since || opts.until) {
    const from = opts.since ? new Date(opts.since).toISOString().slice(0, 10) : 'the first commit';
    const to = opts.until ? new Date(opts.until).toISOString().slice(0, 10) : 'today';
    warnings.push(`Scoped to ${from} → ${to} at your request; commits outside that span were not fetched.`);
  }
  const dataset = buildDataset(source, [...commits.values()], refs, { reportedCommitCount: reportedTotal, warnings, truncated: truncated || !!opts.since || !!opts.until });
  const outcome: IngestOutcome = rateLimitedAt ? 'rate-limited' : stale ? 'offline-cached' : dataset.coverage.completeness === 'exact' ? 'complete' : 'partial';
  return { dataset, outcome, rate: client.rate, resetAt: rateLimitedAt?.resetAt ?? null, requests: client.requests, fromCache: anyFromCache };
}
