import { parseLinkHeader, parseRateHeaders, type LinkRels, type RateInfo } from './ratelimit';
import type { ApiCache, CachedPage } from './cache';
import { safeJsonClone } from '@/model/sanitize';

/**
 * Pagination as recorded when the page was actually fetched.
 *
 * Entries written before the whole Link header was stored only kept `next`,
 * so fall back to that rather than losing pagination for anyone with a warm
 * cache from an older build.
 */
function linkOf(cached: CachedPage): LinkRels {
  return cached.link ?? { next: cached.next ?? null, last: null, lastPage: null };
}

/**
 * Thin, honest GitHub REST client for the browser:
 *  - API-version headers, conditional requests (ETag → 304 is free),
 *  - rate-limit interpretation from response headers,
 *  - capped exponential backoff for idempotent retries,
 *  - typed error classes so the UI can explain exactly what happened,
 *  - cached responses served when offline (marked as such).
 */
export type GitHubErrorKind = 'not-found' | 'rate-limited' | 'secondary-limit' | 'empty-repository' | 'network' | 'offline' | 'blocked' | 'server' | 'malformed' | 'aborted' | 'unauthorized';

export class GitHubError extends Error {
  constructor(
    public kind: GitHubErrorKind,
    message: string,
    public rate: RateInfo | null = null,
    public status: number | null = null,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export interface ApiResult<T> {
  data: T;
  status: number;
  rate: RateInfo;
  link: LinkRels;
  /** Served from the local cache because GitHub returned 304 or the network failed. */
  fromCache: boolean;
  stale: boolean;
}

export interface ClientOptions {
  cache: ApiCache | null;
  token?: string | null;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Called after every response with the latest rate info. */
  onRate?: (rate: RateInfo) => void;
  maxRetries?: number;
}

const MAX_BODY_BYTES = 12_000_000;

export class GitHubClient {
  rate: RateInfo = { limit: null, remaining: null, resetAt: null, retryAfter: null, used: null };
  requests = 0;
  private retrySeed = 7;

  constructor(private opts: ClientOptions) {}

  async get<T>(url: string): Promise<ApiResult<T>> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const cached = this.opts.cache ? await this.opts.cache.getPage(url) : null;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;
    if (cached?.etag) headers['If-None-Match'] = cached.etag;

    const maxRetries = this.opts.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      if (this.opts.signal?.aborted) throw new GitHubError('aborted', 'Cancelled');
      let res: Response;
      try {
        this.requests++;
        res = await fetchImpl(url, { headers, signal: this.opts.signal, cache: 'no-store' });
      } catch (err) {
        if (this.opts.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw new GitHubError('aborted', 'Cancelled');
        if (cached && cached.data !== undefined) {
          return { data: safeJsonClone(cached.data) as T, status: cached.status, rate: this.rate, link: linkOf(cached), fromCache: true, stale: true };
        }
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        throw new GitHubError(offline ? 'offline' : 'network', offline ? 'You appear to be offline and this repository is not cached yet.' : 'GitHub could not be reached (network or DNS problem).');
      }
      const rate = parseRateHeaders(res.headers);
      if (rate.remaining != null || rate.limit != null) {
        this.rate = rate;
        this.opts.onRate?.(rate);
      }
      const link = parseLinkHeader(res.headers.get('link'));

      if (res.status === 304 && cached) {
        // A 304 has no body *and no Link header*. Reading pagination off the
        // empty response ends it after the first page — silently, because the
        // page itself arrives from the cache and looks complete. Anything that
        // primes the cache for a URL ingestion is about to walk (the size
        // probe samples the same first page) would truncate the history.
        return { data: safeJsonClone(cached.data) as T, status: cached.status, rate, link: linkOf(cached), fromCache: true, stale: false };
      }
      if (res.ok) {
        const text = await res.text();
        if (text.length > MAX_BODY_BYTES) throw new GitHubError('malformed', 'GitHub returned an unexpectedly large response.');
        let data: unknown;
        try {
          data = safeJsonClone(JSON.parse(text));
        } catch {
          throw new GitHubError('malformed', 'GitHub returned a response that could not be parsed.');
        }
        const etag = res.headers.get('etag');
        if (this.opts.cache) void this.opts.cache.putPage({ url, etag, status: res.status, data, fetchedAt: Date.now(), next: link.next, link });
        return { data: data as T, status: res.status, rate, link, fromCache: false, stale: false };
      }

      const body = await res.text().catch(() => '');
      let message: string;
      try {
        message = String((JSON.parse(body) as { message?: string }).message ?? '');
      } catch {
        message = body.slice(0, 200);
      }
      if (res.status === 404) throw new GitHubError('not-found', 'GitHub did not expose this repository publicly. It may be private, renamed, or misspelled.', rate, 404);
      if (res.status === 401) throw new GitHubError('unauthorized', 'GitHub rejected the token. Remove it or supply a valid fine-grained token.', rate, 401);
      if (res.status === 409) throw new GitHubError('empty-repository', 'This repository has no commits yet.', rate, 409);
      if (res.status === 451) throw new GitHubError('blocked', 'GitHub reports this repository is unavailable for legal reasons.', rate, 451);
      if (res.status === 403 || res.status === 429) {
        if (rate.remaining === 0) throw new GitHubError('rate-limited', 'GitHub’s anonymous request limit for your network is exhausted.', rate, res.status);
        if (rate.retryAfter != null || /secondary|abuse/i.test(message)) throw new GitHubError('secondary-limit', 'GitHub asked us to slow down (secondary rate limit).', rate, res.status);
        throw new GitHubError('not-found', message || 'GitHub refused the request.', rate, res.status);
      }
      if (res.status >= 500 && attempt < maxRetries) {
        await this.backoff(attempt);
        continue;
      }
      throw new GitHubError('server', `GitHub responded with status ${res.status}${message ? `: ${message}` : ''}.`, rate, res.status);
    }
  }

  private backoff(attempt: number): Promise<void> {
    // deterministic jitter (no Math.random) — this only spaces retries
    this.retrySeed = (this.retrySeed * 1103515245 + 12345) & 0x7fffffff;
    const jitter = (this.retrySeed % 400) / 1000;
    const wait = Math.min(8000, 500 * Math.pow(2, attempt)) + jitter * 1000;
    return new Promise((resolve) => setTimeout(resolve, wait));
  }
}
