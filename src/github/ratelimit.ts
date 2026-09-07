/** Rate-limit and pagination header interpretation. Values come from GitHub, never assumptions. */
export interface RateInfo {
  limit: number | null;
  remaining: number | null;
  /** Unix ms when the window resets, if GitHub said so. */
  resetAt: number | null;
  /** Seconds GitHub asked us to wait (secondary limits). */
  retryAfter: number | null;
  used: number | null;
}

export function parseRateHeaders(headers: Headers | Record<string, string>): RateInfo {
  const get = (name: string): string | null => {
    if (headers instanceof Headers) return headers.get(name);
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? headers[key]! : null;
  };
  const num = (v: string | null) => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const reset = num(get('x-ratelimit-reset'));
  return {
    limit: num(get('x-ratelimit-limit')),
    remaining: num(get('x-ratelimit-remaining')),
    resetAt: reset != null ? reset * 1000 : null,
    retryAfter: num(get('retry-after')),
    used: num(get('x-ratelimit-used')),
  };
}

export interface LinkRels {
  next: string | null;
  last: string | null;
  lastPage: number | null;
}

export function parseLinkHeader(link: string | null): LinkRels {
  const out: LinkRels = { next: null, last: null, lastPage: null };
  if (!link) return out;
  /**
   * Matched rather than split.
   *
   * `link.split(',')` assumes no comma appears inside a URL, and this app's
   * own request URL carries three: `affiliation=owner,collaborator,organization_member`.
   * GitHub percent-encodes them on the way back — verified against the real
   * API — so the header it actually sends is safe, and the split was correct
   * only because of a courtesy at the other end. Anything else that speaks
   * this dialect, or a change of mind at GitHub, would have quietly ended
   * pagination after the first page: every page arriving, looking complete,
   * and the history truncated with nothing to see.
   *
   * Scanning for the `<url>; rel="name"` shape needs no assumption about what
   * is inside the angle brackets, which is where a URL is allowed to have
   * commas in the first place.
   */
  for (const m of link.matchAll(/<([^>]+)>\s*;\s*rel="([^"]+)"/g)) {
    const url = m[1]!;
    const rel = m[2]!;
    if (rel === 'next') out.next = url;
    if (rel === 'last') {
      out.last = url;
      const pm = url.match(/[?&]page=(\d+)/);
      out.lastPage = pm ? Number(pm[1]) : null;
    }
  }
  return out;
}

export function formatReset(resetAt: number | null, now = Date.now()): string {
  if (resetAt == null) return 'when GitHub resets the window';
  const mins = Math.max(0, Math.ceil((resetAt - now) / 60_000));
  if (mins <= 1) return 'in about a minute';
  return `in about ${mins} minutes (${new Date(resetAt).toLocaleTimeString()})`;
}
