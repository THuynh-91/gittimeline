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
}

/** What one call to the list came back with, including what it left out. */
export interface MyRepoList {
  repos: MyRepo[];
  /**
   * More pages exist than were read. The page has to say so: somebody with
   * three hundred repositories was told they had two hundred, on a page whose
   * whole purpose is not being a box to type a name into.
   */
  truncated: boolean;
  /** Entries GitHub sent that could not be read. Reported, not hidden. */
  unreadable: number;
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
 * The answer was not a list of repositories.
 *
 * Its own type because the caller has to tell it apart from an empty account,
 * and could not: a non-array answer used to `break` and return `[]`, which
 * rendered as "you have no public ones" — a server fault reported as a fact
 * about the person reading it. Measured with `{"message":"nope"}` and with
 * `null`, both of which produced that sentence.
 */
export class ListShapeError extends Error {
  constructor() {
    super('GitHub did not answer with a list of repositories.');
    this.name = 'ListShapeError';
  }
}

/**
 * Read at most `pages` pages, newest activity first.
 *
 * Ten, not two. Two was 200 repositories, chosen on the reasoning that a list
 * to choose from is not a dataset — which is true, and was implemented by
 * silently not having the rest: 300 repositories became "200 with a history to
 * watch", of which 60 were rendered, with no sentence anywhere admitting
 * either bound. Ten pages is a thousand, and `truncated` says when even that
 * was not enough. Ten requests against a signed-in allowance of five thousand
 * an hour, and this call is only ever made with a token.
 */
export async function listMyRepositories(token: string, signal?: AbortSignal, pages = 10): Promise<MyRepoList> {
  // No cache, deliberately — see above. `ApiCache` is required by the options
  // type, so the absence has to be explicit.
  const client = new GitHubClient({ token, signal, cache: null });
  const out: MyRepo[] = [];
  let unreadable = 0;
  const FIRST = 'https://api.github.com/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member';
  let next: string | null = FIRST;
  let i = 0;
  for (; i < pages && next !== null; i++) {
    const at: string = next;
    const res = await client.get<ApiRepo[]>(at);
    if (!Array.isArray(res.data)) throw new ListShapeError();
    for (const r of res.data) {
      // `full_name` is the only field this cannot do without, and it is the one
      // that goes into a URL. Anything shaped differently is skipped rather
      // than repaired — which is what the comment said before, while the line
      // above it read `str(r.full_name)` on an element that could be `null`.
      // A list holding one null threw "Cannot read properties of null" and put
      // that on the screen.
      const slug = r && typeof r === 'object' ? str((r as ApiRepo).full_name) : null;
      if (!slug || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(slug)) {
        unreadable++;
        continue;
      }
      out.push({
        slug,
        description: str(r.description),
        private: r.private === true,
        fork: r.fork === true,
        archived: r.archived === true,
        pushedAt: str(r.pushed_at),
        language: str(r.language),
        stars: typeof r.stargazers_count === 'number' && Number.isFinite(r.stargazers_count) ? r.stargazers_count : 0,
      });
    }
    next = res.link.next ?? null;
  }
  /**
   * `size` is gone from `MyRepo`, and it was the wrong field to have used.
   *
   * The rule — a repository with no commits has no history to perform — is
   * right. `size` is the repository's disk usage in kilobytes, rounded down,
   * and `/user/repos` carries no commit count at all. So a new repository
   * holding an initial commit and a short README reports `size: 0` and was
   * silently removed from the list: uncounted, unmentioned, and if it was the
   * only one, replaced with "you have no public ones".
   *
   * A repository that really has no commits is a 409 from the commits
   * endpoint, and the ingest already has an `empty-repository` path that says
   * "No commits yet" in as many words. Letting the row through and letting
   * that path answer is both simpler and true.
   */
  return { repos: out, truncated: next !== null, unreadable };
}
