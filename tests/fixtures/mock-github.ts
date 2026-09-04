/**
 * Realistic mock of the GitHub REST endpoints GitTimeline uses:
 * repo metadata, paginated commits (Link headers), branches, tags,
 * rate-limit headers, ETags/304, 404, 409 (empty), 403 rate limit, 5xx.
 * Used by unit tests directly and by Playwright route interception.
 */
export interface MockCommit {
  sha: string;
  parents: string[];
  message: string;
  author: { name: string; login: string | null; id: number | null; date: string };
}

export interface MockRepo {
  owner: string;
  name: string;
  defaultBranch: string;
  commits: MockCommit[];
  branches: Array<{ name: string; sha: string }>;
  tags: Array<{ name: string; sha: string }>;
}

export interface MockOptions {
  /** Return 403 rate-limited after this many successful requests. */
  rateLimitAfter?: number;
  resetAt?: number; // unix seconds
  serverErrors?: number;
  limit?: number;
}

export interface MockResponseSpec {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export function mockGitHub(repo: MockRepo | null, opts: MockOptions = {}) {
  let served = 0;
  let serverErrorsLeft = opts.serverErrors ?? 0;
  const requests: string[] = [];
  const state = {
    requests,
    conditional: 0,
    offline: false,
    fetch: null as unknown as (url: string, init?: RequestInit) => Promise<Response>,
    respond: null as unknown as (url: string, headers: Record<string, string>) => MockResponseSpec,
  };
  const limit = opts.limit ?? 60;

  const etagFor = (body: unknown) => `"${simpleHash(JSON.stringify(body))}"`;
  const commitsByBranch = (startSha: string): MockCommit[] => {
    if (!repo) return [];
    const bySha = new Map(repo.commits.map((c) => [c.sha, c]));
    // Like `git log <sha>`: the tip comes first, then the newest commit of the frontier, etc.
    const out: MockCommit[] = [];
    const seen = new Set<string>();
    const frontier: MockCommit[] = [];
    const tip = bySha.get(startSha);
    if (!tip) return out;
    frontier.push(tip);
    while (frontier.length) {
      frontier.sort((a, b) => Date.parse(b.author.date) - Date.parse(a.author.date) || (a.sha < b.sha ? 1 : -1));
      const c = frontier.shift()!;
      if (seen.has(c.sha)) continue;
      seen.add(c.sha);
      out.push(c);
      for (const p of c.parents) {
        const pc = bySha.get(p);
        if (pc && !seen.has(p)) frontier.push(pc);
      }
    }
    return out;
  };

  state.respond = (url: string, reqHeaders: Record<string, string>): MockResponseSpec => {
    requests.push(url);
    const u = new URL(url);
    const remaining = Math.max(0, limit - served - 1);
    const base: Record<string, string> = {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'ETag, Link, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Used',
      'x-ratelimit-limit': String(limit),
      'x-ratelimit-remaining': String(remaining),
      'x-ratelimit-reset': String(opts.resetAt ?? Math.floor(Date.now() / 1000) + 3600),
    };
    if (serverErrorsLeft > 0) {
      serverErrorsLeft--;
      return { status: 502, body: { message: 'Bad gateway' }, headers: base };
    }
    if (opts.rateLimitAfter != null && served >= opts.rateLimitAfter) {
      return { status: 403, body: { message: 'API rate limit exceeded for 1.2.3.4.' }, headers: { ...base, 'x-ratelimit-remaining': '0' } };
    }
    served++;
    if (!repo) return { status: 404, body: { message: 'Not Found' }, headers: base };
    const prefix = `/repos/${repo.owner}/${repo.name}`;
    if (!u.pathname.startsWith(prefix)) return { status: 404, body: { message: 'Not Found' }, headers: base };
    const rest = u.pathname.slice(prefix.length);
    let body: unknown;
    if (rest === '' || rest === '/') {
      body = { full_name: `${repo.owner}/${repo.name}`, default_branch: repo.defaultBranch, description: 'Mock repository', created_at: '2020-01-01T00:00:00Z', pushed_at: '2020-06-01T00:00:00Z', size: 42, html_url: `https://github.com/${repo.owner}/${repo.name}`, private: false };
    } else if (rest === '/commits') {
      if (repo.commits.length === 0) return { status: 409, body: { message: 'Git Repository is empty.' }, headers: base };
      const sha = u.searchParams.get('sha') ?? repo.defaultBranch;
      const tip = repo.branches.find((b) => b.name === sha)?.sha ?? sha;
      const all = commitsByBranch(tip);
      const perPage = Number(u.searchParams.get('per_page') ?? 30);
      const page = Number(u.searchParams.get('page') ?? 1);
      const slice = all.slice((page - 1) * perPage, page * perPage);
      const last = Math.max(1, Math.ceil(all.length / perPage));
      const links: string[] = [];
      const mk = (p: number) => {
        const nu = new URL(url);
        nu.searchParams.set('page', String(p));
        return `<${nu.toString()}>; rel="${p > page ? 'next' : 'prev'}"`;
      };
      if (page < last) {
        links.push(mk(page + 1));
        const lu = new URL(url);
        lu.searchParams.set('page', String(last));
        links.push(`<${lu.toString()}>; rel="last"`);
      }
      if (links.length) base.link = links.join(', ');
      body = slice.map((c) => ({
        sha: c.sha,
        html_url: `https://github.com/${repo.owner}/${repo.name}/commit/${c.sha}`,
        commit: { message: c.message, author: { name: c.author.name, email: `${c.author.login ?? 'anon'}@example.com`, date: c.author.date }, committer: { name: c.author.name, email: 'x@example.com', date: c.author.date } },
        author: c.author.login ? { login: c.author.login, id: c.author.id, avatar_url: 'https://avatars.githubusercontent.com/u/0' } : null,
        parents: c.parents.map((p) => ({ sha: p })),
      }));
    } else if (rest === '/branches') {
      body = repo.branches.map((b) => ({ name: b.name, commit: { sha: b.sha } }));
    } else if (rest === '/tags') {
      body = repo.tags.map((t) => ({ name: t.name, commit: { sha: t.sha } }));
    } else return { status: 404, body: { message: 'Not Found' }, headers: base };
    const etag = etagFor(body);
    base.etag = etag;
    const inm = Object.entries(reqHeaders).find(([k]) => k.toLowerCase() === 'if-none-match')?.[1];
    if (inm) state.conditional++;
    if (inm === etag) return { status: 304, body: null, headers: base };
    return { status: 200, body, headers: base };
  };

  state.fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (state.offline) throw new TypeError('Failed to fetch');
    const spec = state.respond(url, (init?.headers as Record<string, string>) ?? {});
    return new Response(spec.status === 304 ? null : JSON.stringify(spec.body), { status: spec.status, headers: spec.headers });
  };
  return state;
}

function simpleHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** Small branchy repository used by the browser tests. */
export function sampleRepo(): MockRepo {
  const sha = (n: number) => n.toString(16).padStart(40, 'a');
  const d = (day: number, hour = 0) => new Date(Date.UTC(2019, 2, 1 + day, hour)).toISOString();
  const mara = { name: 'Mara Ekwueme', login: 'mara-e', id: 1 };
  const devi = { name: 'Devi Raman', login: 'deviraman', id: 2 };
  const kofi = { name: 'Kofi Mensah', login: 'kofim', id: 3 };
  const commits: MockCommit[] = [
    { sha: sha(1), parents: [], message: 'Initial commit', author: { ...mara, date: d(0) } },
    { sha: sha(2), parents: [sha(1)], message: 'Add parser', author: { ...mara, date: d(2) } },
    { sha: sha(3), parents: [sha(2)], message: 'Start feature', author: { ...devi, date: d(3) } },
    { sha: sha(4), parents: [sha(2)], message: 'Fix typo', author: { ...mara, date: d(4) } },
    { sha: sha(5), parents: [sha(3)], message: 'Feature tests', author: { ...devi, date: d(5) } },
    { sha: sha(6), parents: [sha(4), sha(5)], message: 'Merge feature', author: { ...kofi, date: d(7) } },
    { sha: sha(7), parents: [sha(6)], message: 'Release prep', author: { ...kofi, date: d(9) } },
    { sha: sha(8), parents: [sha(7)], message: 'Docs', author: { ...mara, date: d(40) } },
    { sha: sha(9), parents: [sha(7)], message: 'Experimental branch', author: { ...devi, date: d(41) } },
  ];
  return {
    owner: 'acme',
    name: 'widget',
    defaultBranch: 'trunk',
    commits,
    branches: [
      { name: 'trunk', sha: sha(8) },
      { name: 'experiment', sha: sha(9) },
    ],
    tags: [{ name: 'v0.1.0', sha: sha(7) }],
  };
}
