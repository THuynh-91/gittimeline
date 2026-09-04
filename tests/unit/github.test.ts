import { describe, expect, it } from 'vitest';
import { parseRepoUrl } from '@/github/url';
import { parseLinkHeader, parseRateHeaders, formatReset } from '@/github/ratelimit';
import { GitHubClient, GitHubError } from '@/github/adapter';
import { ingestRepository } from '@/github/ingest';
import { ApiCache } from '@/github/cache';
import { mockGitHub, type MockRepo } from '../fixtures/mock-github';
import { compilePerformance } from '@/choreography/compile';

describe('parseRepoUrl', () => {
  const ok = (input: string, slug: string) => {
    const r = parseRepoUrl(input);
    expect(r.ok, input).toBe(true);
    if (r.ok) expect(r.repo.slug).toBe(slug);
  };
  it('normalizes the accepted forms', () => {
    ok('https://github.com/facebook/react', 'facebook/react');
    ok('github.com/facebook/react', 'facebook/react');
    ok('https://github.com/torvalds/linux.git', 'torvalds/linux');
    ok('  www.github.com/BurntSushi/ripgrep/  ', 'BurntSushi/ripgrep');
    ok('facebook/react', 'facebook/react');
    ok('git@github.com:preactjs/preact.git', 'preactjs/preact');
    ok('https://github.com/facebook/react/tree/main/packages?x=1#readme', 'facebook/react');
    ok('https://github.com/facebook/react/issues/123', 'facebook/react');
    ok('HTTPS://GITHUB.COM/Owner/Repo', 'Owner/Repo');
  });
  it('rejects unsupported input with guidance', () => {
    expect(parseRepoUrl('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseRepoUrl('https://gitlab.com/a/b')).toMatchObject({ ok: false, reason: 'not-github' });
    expect(parseRepoUrl('https://gist.github.com/x/123')).toMatchObject({ ok: false, reason: 'gist' });
    expect(parseRepoUrl('https://github.com/facebook')).toMatchObject({ ok: false, reason: 'not-a-repository' });
    expect(parseRepoUrl('https://github.com/settings/profile')).toMatchObject({ ok: false, reason: 'reserved-route' });
    expect(parseRepoUrl('not a url at all')).toMatchObject({ ok: false });
    expect(parseRepoUrl('https://github.com/a/<script>')).toMatchObject({ ok: false, reason: 'not-a-repository' });
  });
});

describe('rate-limit and pagination headers', () => {
  it('parses GitHub headers', () => {
    const r = parseRateHeaders(new Headers({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': '1700000000', 'retry-after': '30' }));
    expect(r).toEqual({ limit: 60, remaining: 12, resetAt: 1700000000000, retryAfter: 30, used: null });
    expect(parseRateHeaders(new Headers())).toEqual({ limit: null, remaining: null, resetAt: null, retryAfter: null, used: null });
  });
  it('parses Link headers', () => {
    const l = parseLinkHeader('<https://api.github.com/repos/a/b/commits?page=2>; rel="next", <https://api.github.com/repos/a/b/commits?page=9>; rel="last"');
    expect(l.next).toContain('page=2');
    expect(l.lastPage).toBe(9);
    expect(parseLinkHeader(null)).toEqual({ next: null, last: null, lastPage: null });
  });
  it('formats reset times', () => {
    expect(formatReset(null)).toMatch(/GitHub resets/);
    expect(formatReset(Date.now() + 10 * 60_000)).toMatch(/about 10 minutes/);
  });
});

function repoOf(commits: number, branches = 0): MockRepo {
  const shas: string[] = [];
  const list = [];
  for (let i = 0; i < commits; i++) {
    const sha = (i + 1).toString(16).padStart(40, '0');
    shas.push(sha);
    list.push({ sha, parents: i > 0 ? [shas[i - 1]!] : [], message: `commit ${i}`, author: { name: `Person ${i % 3}`, login: `p${i % 3}`, id: i % 3, date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString() } });
  }
  const extra: MockRepo['branches'] = [];
  for (let b = 0; b < branches; b++) {
    const base = shas[Math.max(0, commits - 3)]!;
    const sha = `b${b}`.padEnd(40, 'f');
    list.push({ sha, parents: [base], message: `branch ${b}`, author: { name: 'Side', login: 'side', id: 99, date: new Date(Date.UTC(2020, 1, 1 + b)).toISOString() } });
    extra.push({ name: `feature-${b}`, sha });
  }
  return { owner: 'acme', name: 'widget', defaultBranch: 'main', commits: list, branches: [{ name: 'main', sha: shas[shas.length - 1]! }, ...extra], tags: [{ name: 'v1.0', sha: shas[Math.floor(commits / 2)]! }] };
}

async function run(mock: ReturnType<typeof mockGitHub>, opts: Partial<Parameters<typeof ingestRepository>[1]> = {}, cache: ApiCache | null = null) {
  const client = new GitHubClient({ cache, fetchImpl: mock.fetch as typeof fetch });
  const ac = new AbortController();
  const progress: string[] = [];
  const result = await ingestRepository(
    { owner: 'acme', name: 'widget', slug: 'acme/widget', canonicalUrl: 'https://github.com/acme/widget', apiUrl: 'https://api.github.com/repos/acme/widget' },
    { client, signal: ac.signal, onProgress: (p) => progress.push(p.phase), ...opts },
  );
  return { result, progress, client };
}

describe('GitHub ingestion (mocked)', () => {
  it('happy path: paginated history, branches and tags become an exact dataset', async () => {
    const mock = mockGitHub(repoOf(250, 2));
    const { result, progress } = await run(mock);
    expect(result.outcome).toBe('complete');
    expect(result.dataset.commits.length).toBe(252);
    expect(result.dataset.coverage.completeness).toBe('exact');
    expect(result.dataset.coverage.boundaryCount).toBe(0);
    expect(result.dataset.refs.some((r) => r.kind === 'tag' && r.name === 'v1.0')).toBe(true);
    expect(result.dataset.refs.filter((r) => r.kind === 'branch').length).toBe(3);
    expect(result.dataset.source.selectedTipSha).toBe(result.dataset.refs.find((r) => r.name === 'main')!.targetSha);
    expect(progress).toContain('expanding');
    expect(progress).toContain('tips');
    expect(mock.requests.filter((u) => u.includes('/commits?')).length).toBeGreaterThanOrEqual(3);
    const p = compilePerformance(result.dataset, { preset: { id: 'c', version: 1, targetDuration: 60, reducedMotion: false, aggregateAbove: 1200 }, seed: 's' });
    expect(p.stats.threads).toBe(3);
    expect(p.threads.filter((t) => t.ending === 'tip').length).toBe(3);
  });

  it('stops honestly at the page budget with a partial dataset', async () => {
    const mock = mockGitHub(repoOf(450));
    const { result } = await run(mock, { maxPages: 2, includeBranches: false });
    expect(result.outcome).toBe('partial');
    expect(result.dataset.commits.length).toBe(200);
    expect(result.dataset.coverage.completeness).toBe('unknown');
    expect(result.dataset.coverage.boundaryCount).toBe(1);
    expect(result.dataset.coverage.summary).toMatch(/earlier topology is not yet available/);
    expect(result.dataset.coverage.reportedCommitCount).toBe(500);
    const p = compilePerformance(result.dataset, { preset: { id: 'c', version: 1, targetDuration: 60, reducedMotion: false, aggregateAbove: 1200 }, seed: 's' });
    expect(p.nodes.some((n) => n.kind === 'boundary')).toBe(true);
    expect(p.events.some((e) => e.type === 'UNKNOWN_SPAN')).toBe(true);
  });

  it('rate limit mid-way yields a coherent partial performance with the reset time', async () => {
    const mock = mockGitHub(repoOf(350), { rateLimitAfter: 2, resetAt: 1_800_000_000 });
    const { result } = await run(mock);
    expect(result.outcome).toBe('rate-limited');
    expect(result.dataset.commits.length).toBe(100);
    expect(result.resetAt).toBe(1_800_000_000_000);
    expect(result.dataset.coverage.warnings.join(' ')).toMatch(/request limit/);
  });

  it('rate limit before any data throws a typed error', async () => {
    const mock = mockGitHub(repoOf(10), { rateLimitAfter: 0 });
    await expect(run(mock)).rejects.toMatchObject({ kind: 'rate-limited' });
  });

  it('reports not-found for private or missing repositories without guessing', async () => {
    const mock = mockGitHub(null);
    await expect(run(mock)).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('empty repository (409) produces an empty exact dataset', async () => {
    const mock = mockGitHub({ ...repoOf(0), commits: [], branches: [], tags: [] });
    const { result } = await run(mock);
    expect(result.dataset.commits.length).toBe(0);
    expect(result.outcome).toBe('complete');
  });

  it('cancels cleanly', async () => {
    const mock = mockGitHub(repoOf(300));
    const client = new GitHubClient({ cache: null, fetchImpl: mock.fetch as typeof fetch });
    const ac = new AbortController();
    const p = ingestRepository({ owner: 'acme', name: 'widget', slug: 'acme/widget', canonicalUrl: '', apiUrl: 'https://api.github.com/repos/acme/widget' }, { client, signal: ac.signal, onProgress: () => ac.abort() });
    await expect(p).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('uses ETags for conditional requests and serves cached pages when offline', async () => {
    const { indexedDB } = await import('fake-indexeddb');
    const cache = new ApiCache(indexedDB);
    const mock = mockGitHub(repoOf(120));
    const first = await run(mock, { includeBranches: false }, cache);
    expect(first.result.fromCache).toBe(false);
    const before = mock.requests.length;
    const second = await run(mock, { includeBranches: false }, cache);
    expect(mock.requests.length).toBeGreaterThan(before);
    expect(mock.conditional).toBeGreaterThan(0); // If-None-Match was sent
    expect(second.result.fromCache).toBe(true);
    // offline: fetch throws, cached pages are served and marked stale
    mock.offline = true;
    const third = await run(mock, { includeBranches: false }, cache);
    expect(third.result.outcome).toBe('offline-cached');
    expect(third.result.dataset.commits.length).toBe(120);
  });

  it('retries 5xx with backoff and surfaces persistent server errors', async () => {
    const mock = mockGitHub(repoOf(5), { serverErrors: 1 });
    const client = new GitHubClient({ cache: null, fetchImpl: mock.fetch as typeof fetch, maxRetries: 2 });
    const res = await client.get('https://api.github.com/repos/acme/widget');
    expect(res.status).toBe(200);
    const bad = mockGitHub(repoOf(5), { serverErrors: 10 });
    const client2 = new GitHubClient({ cache: null, fetchImpl: bad.fetch as typeof fetch, maxRetries: 0 });
    await expect(client2.get('https://api.github.com/repos/acme/widget')).rejects.toBeInstanceOf(GitHubError);
  });
});
