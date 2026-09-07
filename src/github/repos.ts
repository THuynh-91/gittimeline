import { GitHubClient } from './adapter';

/**
 * The repositories the signed-in person can actually reach.
 *
 * One endpoint answers both halves of the question, which is why there is no
 * branch here for private access. `GET /user/repos` returns exactly what the
 * credential presented is entitled to see:
 *
 *   - the OAuth app's token carries **no scopes**, so it lists public
 *     repositories and nothing else — a private one is a 404, indistinguishable
 *     from a repository that does not exist;
 *   - a GitHub App's user token lists the repositories that App was installed
 *     on, which are the ones chosen by hand in GitHub's own interface.
 *
 * So the app never asks for "all your repositories". It asks what this
 * credential can see, and shows that. Widening it is done in GitHub, per
 * repository, and undone the same way.
 *
 * Deliberately not cached. `ApiCache` keys responses by URL and keeps them in
 * IndexedDB with no expiry, which is fine for the public history of a public
 * project and wrong for a list of somebody's private repository names — a
 * security review found 115 KB of API responses persisting on the device with
 * no way to clear them, and the fix there was to say so and offer a button.
 * The better answer for this call is not to write it down at all.
 */
export interface MyRepo {
  slug: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  pushedAt: string | null;
  language: string | null;
  stars: number;
  /** Present when the repository has no commits at all; nothing to perform. */
  empty: boolean;
}

interface ApiRepo {
  full_name?: unknown;
  description?: unknown;
  private?: unknown;
  fork?: unknown;
  archived?: unknown;
  pushed_at?: unknown;
  language?: unknown;
  stargazers_count?: unknown;
  size?: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length < 400 ? v : null);

/**
 * Read at most `pages` pages, newest activity first.
 *
 * Bounded because this is a list to choose from, not a dataset: somebody with
 * two thousand repositories is served no better by all two thousand than by
 * the two hundred they touched most recently, and the anonymous rate limit is
 * about sixty requests an hour for the whole network.
 */
export async function listMyRepositories(token: string, signal?: AbortSignal, pages = 2): Promise<MyRepo[]> {
  // No cache, deliberately — see above. `ApiCache` is required by the options
  // type, so the absence has to be explicit.
  const client = new GitHubClient({ token, signal, cache: null });
  const out: MyRepo[] = [];
  const FIRST = 'https://api.github.com/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member';
  let next: string | null = FIRST;
  for (let i = 0; i < pages && next !== null; i++) {
    const at: string = next;
    const res = await client.get<ApiRepo[]>(at);
    if (!Array.isArray(res.data)) break;
    for (const r of res.data) {
      const slug = str(r.full_name);
      // `full_name` is the only field this cannot do without, and it is the one
      // that goes into a URL. Anything shaped differently is skipped rather
      // than repaired.
      if (!slug || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(slug)) continue;
      out.push({
        slug,
        description: str(r.description),
        private: r.private === true,
        fork: r.fork === true,
        archived: r.archived === true,
        pushedAt: str(r.pushed_at),
        language: str(r.language),
        stars: typeof r.stargazers_count === 'number' && Number.isFinite(r.stargazers_count) ? r.stargazers_count : 0,
        empty: r.size === 0,
      });
    }
    next = res.link.next ?? null;
  }
  return out;
}
