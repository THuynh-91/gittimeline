import { useEffect, useState } from 'preact/hooks';
import { store } from './store';
import { loadRepo } from './controller';
import { listMyRepositories, type MyRepo } from '@/github/repos';

/**
 * The repositories this credential can reach, to pick one from.
 *
 * Signing in used to raise the rate limit and then return somebody to a text
 * box, which is a capability rather than a workflow: you are told you may now
 * read five thousand things an hour and left to type their names. This is the
 * list.
 *
 * It asks `GET /user/repos`, which answers according to what the credential is
 * entitled to see and nothing more — see `src/github/repos.ts`. With the OAuth
 * app's scopeless token that is public repositories only. A private one
 * appears here when, and only when, a GitHub App has been installed on it by
 * hand; there is no request this app can make that would widen that.
 */
const fmtWhen = (iso: string | null): string => {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) {
    const months = Math.max(1, Math.round(days / 30));
    return months === 1 ? 'last month' : `${months} months ago`;
  }
  const years = days / 365;
  return years < 1.5 ? 'a year ago' : `${Math.round(years)} years ago`;
};

export function MyRepos() {
  const token = store.token.value;
  const [repos, setRepos] = useState<MyRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!token) {
      setRepos(null);
      return;
    }
    const abort = new AbortController();
    setError(null);
    setRepos(null);
    void listMyRepositories(token, abort.signal)
      .then((list) => {
        if (!abort.signal.aborted) setRepos(list);
      })
      .catch((e: unknown) => {
        if (abort.signal.aborted) return;
        // Named rather than shown raw: a `TypeError` or a bare status is not
        // written for anybody.
        const raw = e instanceof Error ? e.message : '';
        setError(/failed to fetch|networkerror|load failed/i.test(raw) || !raw ? 'Your repositories could not be listed just now. Check your connection and try again.' : raw);
      });
    return () => abort.abort();
  }, [token]);

  if (!token) return null;

  // Something to perform. An empty repository has no history, and an archived
  // one is still worth watching, so only the first is excluded.
  const usable = (repos ?? []).filter((r) => !r.empty);
  const q = filter.trim().toLowerCase();
  const shown = q ? usable.filter((r) => r.slug.toLowerCase().includes(q)) : usable;
  const privateCount = usable.filter((r) => r.private).length;

  // No heading of its own: `ReposPage` names it, and a card captioned the same
  // as the page above it is two answers to one question. The label is still
  // there for anyone not looking at it.
  return (
    <section class="myrepos" aria-label="Your repositories" data-testid="my-repos">
      {error ? (
        <p class="dim">{error}</p>
      ) : repos === null ? (
        <p class="dim">Asking GitHub what you can see…</p>
      ) : usable.length === 0 ? (
        <p class="dim">
          Nothing with a history to watch. This credential can see no repositories with commits in them — which for a
          connection that asks for no permissions means you have no public ones.
        </p>
      ) : (
        <>
          <p class="dim">
            {usable.length} with a history to watch
            {privateCount > 0 ? `, ${privateCount} of them private and granted by hand` : ''}. Most recently pushed
            first.
          </p>
          {usable.length > 12 && (
            <input
              type="text"
              class="myrepos-filter"
              placeholder="Filter by name"
              aria-label="Filter your repositories"
              value={filter}
              onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
              data-testid="my-repos-filter"
            />
          )}
          <ul class="myrepos-list">
            {shown.slice(0, 60).map((r) => (
              <li key={r.slug}>
                <button
                  type="button"
                  onClick={() => {
                    store.input.value = r.slug;
                    void loadRepo(r.slug, { autoplay: true });
                  }}
                  data-testid={`my-repo-${r.slug.replace('/', '-')}`}
                >
                  <span class="myrepo-name">{r.slug}</span>
                  {r.private && <span class="myrepo-tag private">private</span>}
                  {r.fork && <span class="myrepo-tag">fork</span>}
                  {r.archived && <span class="myrepo-tag">archived</span>}
                  {r.language && <span class="myrepo-tag">{r.language}</span>}
                  <span class="myrepo-when">{fmtWhen(r.pushedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p class="dim">Nothing matches “{filter}”.</p>}
        </>
      )}
    </section>
  );
}
