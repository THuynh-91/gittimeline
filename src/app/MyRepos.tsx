import { useEffect, useState } from 'preact/hooks';
import { store } from './store';
import { clearStoredHistories, loadRepo } from './controller';
import { formatReset } from '@/github/ratelimit';
import { GitHubError } from '@/github/adapter';
import { listMyRepositories, ListShapeError, type MyRepoList } from '@/github/repos';

/**
 * The repositories this credential can reach, to pick one from.
 *
 * Signing in used to raise the rate limit and then return somebody to a text
 * box, which is a capability rather than a workflow: you are told you may now
 * read five thousand things an hour and left to type their names. This is the
 * list.
 *
 * It asks `GET /user/repos`, which answers according to what the credential is
 * entitled to see and nothing more — see `src/github/repos.ts`. Signing in
 * gives a scopeless OAuth token, so what comes back is public repositories
 * only, and there is no request this app can make that would widen it.
 *
 * A private repository would appear here if the credential could see one, and
 * today none can: that needs a separate, deliberate per-repository grant which
 * has not been built. The `private` tag and the counts that mention it are
 * therefore currently unreachable rather than wrong, and this paragraph used
 * to describe a GitHub App in the present tense as though it existed.
 */
const fmtWhen = (iso: string | null): string => {
  // An empty column says "this repository has no last-pushed time", which is
  // not what a missing or unparseable field means — that is "GitHub did not
  // tell us", and the two are worth telling apart when the column is the thing
  // the list is sorted by.
  if (!iso) return 'unknown';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'unknown';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  // Clock skew, or a mirror with a bad timestamp. A repository stamped four
  // hundred days ahead was reported as pushed today, because the arithmetic
  // went negative and `days <= 0` swallowed it.
  if (days < 0) return 'dated ahead';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) {
    const months = Math.max(1, Math.round(days / 30));
    return months === 1 ? 'last month' : `${months} months ago`;
  }
  const years = days / 365;
  return years < 1.5 ? 'a year ago' : `${Math.round(years)} years ago`;
};

/** How many rows to draw. Past this the filter is the way through. */
const CAP = 300;

/**
 * What went wrong, said in a sentence, plus whether trying again could help.
 *
 * Every branch here was a raw string before, and each was wrong in its own
 * way. A 401 told the viewer to "remove it or supply a valid fine-grained
 * token" — a token they never supplied and have no box to type into — while
 * `store.token` stayed set, so the whole app went on saying it was connected.
 * A 403 said the *anonymous* limit for their *network* was exhausted, on a
 * page whose own lead paragraph two inches above says this call spends their
 * own five-thousand-an-hour allowance, and dropped the reset time that was
 * sitting in the response headers. A 404 said "this repository" on a page that
 * asked for a list. And a `TypeError` out of a malformed answer was printed
 * verbatim, directly under a comment promising that a `TypeError` is not
 * written for anybody.
 */
function explain(e: unknown): { message: string; retry: boolean; disconnect: boolean } {
  if (e instanceof ListShapeError) {
    return {
      message: 'GitHub answered, but not with a list of repositories. That is a fault at their end rather than anything about your account.',
      retry: true,
      disconnect: false,
    };
  }
  if (e instanceof GitHubError) {
    if (e.kind === 'unauthorized' || e.status === 401) {
      return {
        message: 'GitHub rejected this connection — the token has been revoked or has expired. Disconnecting and connecting again will fix it.',
        retry: false,
        disconnect: true,
      };
    }
    if (e.kind === 'rate-limited' || e.kind === 'secondary-limit' || e.status === 403) {
      const when = formatReset(e.rate?.resetAt ?? null);
      return {
        message: `Your GitHub request allowance is used up for now${when ? `; it resets ${when}` : ''}. The ready-made histories cost no requests at all in the meantime.`,
        retry: false,
        disconnect: false,
      };
    }
    if (e.kind === 'offline' || e.kind === 'network') {
      return { message: 'Your repositories could not be listed just now. Check your connection and try again.', retry: true, disconnect: false };
    }
    if (e.kind === 'server' || e.kind === 'malformed' || (e.status != null && e.status >= 500)) {
      return {
        message: 'GitHub is having trouble at the moment — it answered with a server error. Nothing is wrong with your account.',
        retry: true,
        disconnect: false,
      };
    }
  }
  const raw = e instanceof Error ? e.message : '';
  if (/failed to fetch|networkerror|load failed/i.test(raw) || !raw) {
    return { message: 'Your repositories could not be listed just now. Check your connection and try again.', retry: true, disconnect: false };
  }
  // Anything left is a shape nobody anticipated. It gets a sentence too,
  // because printing the shape is the thing this function exists to stop.
  return {
    message: 'Your repositories could not be read — GitHub answered with something this page could not make sense of.',
    retry: true,
    disconnect: false,
  };
}

export function MyRepos() {
  const token = store.token.value;
  const [list, setList] = useState<MyRepoList | null>(null);
  const [error, setError] = useState<{ message: string; retry: boolean; disconnect: boolean } | null>(null);
  const [filter, setFilter] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) {
      setList(null);
      return;
    }
    const abort = new AbortController();
    setError(null);
    setList(null);
    void listMyRepositories(token, abort.signal)
      .then((got) => {
        if (!abort.signal.aborted) setList(got);
      })
      .catch((e: unknown) => {
        if (abort.signal.aborted) return;
        setError(explain(e));
      });
    return () => abort.abort();
  }, [token, attempt]);

  if (!token) return null;

  const all = list?.repos ?? [];
  const q = filter.trim().toLowerCase();
  const shown = q ? all.filter((r) => r.slug.toLowerCase().includes(q)) : all;
  const drawn = shown.slice(0, CAP);
  const privateCount = all.filter((r) => r.private).length;

  // No heading of its own: `ReposPage` names it, and a card captioned the same
  // as the page above it is two answers to one question. The label is still
  // there for anyone not looking at it.
  return (
    <section class="myrepos" aria-label="Your repositories" data-testid="my-repos">
      {error ? (
        <div class="myrepos-error" data-testid="my-repos-error">
          <p>{error.message}</p>
          <div class="btn-row">
            {error.retry && (
              <button type="button" class="btn" onClick={() => setAttempt((n) => n + 1)} data-testid="my-repos-retry">
                Try again
              </button>
            )}
            {error.disconnect && (
              // Disconnecting means disconnecting, on this button as much as on
              // the sign-in page's. This one dropped the token and left
              // everything fetched with it on the device, so "revoke" was a
              // word about GitHub rather than about this machine — the exact
              // thing the other button's comment says it is not.
              <button
                type="button"
                class="btn"
                onClick={() => {
                  store.token.value = null;
                  void clearStoredHistories();
                }}
                data-testid="my-repos-disconnect"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      ) : list === null ? (
        <p class="dim">Asking GitHub what you can see…</p>
      ) : all.length === 0 ? (
        <p class="dim">
          {list.unreadable > 0
            ? 'GitHub returned no repositories this page could read. That is a fault at their end rather than an empty account.'
            : 'Nothing to watch here. This credential can see no repositories — which, for a connection that asks for no permissions, means you have no public ones.'}
        </p>
      ) : (
        <>
          {/* A live region, so the count follows the filter for somebody who
              cannot see the rows change. It printed the unfiltered total
              whatever was typed — nine rows under a sentence saying twenty —
              and "Nothing matches" was an ordinary paragraph, so emptying the
              list announced nothing at all. Both bounds are named here too:
              being shown sixty of three hundred with no sentence admitting it
              is the opposite of what this page is for. */}
          <p class="dim" role="status" data-testid="my-repos-count">
            {q
              ? `${shown.length} of ${all.length} match “${filter.trim()}”.`
              : `${all.length} to choose from${privateCount > 0 ? `, ${privateCount} of them private and granted by hand` : ''}. Most recently pushed first.`}
            {drawn.length < shown.length ? ` Showing the first ${drawn.length}; filter by name to reach the rest.` : ''}
            {list.truncated ? ' You have more than this page reads — the most recently pushed are the ones here.' : ''}
            {list.unreadable > 0 ? ` ${list.unreadable} could not be read and are not listed.` : ''}
          </p>
          {all.length > 10 && (
            <input
              type="text"
              class="myrepos-filter"
              placeholder="Filter by name"
              aria-label="Filter your repositories"
              aria-controls="my-repos-list"
              value={filter}
              onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
              data-testid="my-repos-filter"
            />
          )}
          <ul class="myrepos-list" id="my-repos-list" data-testid="my-repos-list">
            {drawn.map((r) => (
              <li key={r.slug}>
                <button
                  type="button"
                  onClick={() => {
                    // The landing page's box, but only for a public one.
                    //
                    // Filling it is a convenience — it shows what is playing
                    // and makes a second look easy. For a private repository
                    // it is the same exposure the recents row was excluded
                    // for, by a different route: pressing Back put the name in
                    // plain sight on the landing page, where it survived
                    // navigation, for whoever next looked at the screen.
                    if (!r.private) store.input.value = r.slug;
                    void loadRepo(r.slug, { autoplay: true });
                  }}
                  data-testid={`my-repo-${r.slug.replace('/', '-')}`}
                >
                  <span class="myrepo-name">{r.slug}</span>
                  {r.private && <span class="myrepo-tag private">private</span>}
                  {r.fork && <span class="myrepo-tag">fork</span>}
                  {r.archived && <span class="myrepo-tag">archived</span>}
                  {r.language && <span class="myrepo-tag lang">{r.language}</span>}
                  <span class="myrepo-when">{fmtWhen(r.pushedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
