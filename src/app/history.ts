import { store } from './store';

/**
 * Make the browser's Back button mean something.
 *
 * `store.mode` is this app's router and every route has always lived at the
 * same URL, so the browser had no idea navigation was happening: pressing Back
 * from the selection page left the site entirely, or — worse, from a bookmark
 * — did nothing at all while looking exactly like a button that should work.
 *
 * The player is deliberately not given a route of its own. What is playing is
 * held in memory, not in the URL, so a route that restored to an empty stage
 * would be a link that lies; Back from a performance returns to the page that
 * started it, which is the only honest destination available.
 *
 * The routes are hashes rather than paths because the site is static. A real
 * path would work until somebody reloaded on it or opened a link cold, at
 * which point GitHub Pages would look for a `/selection` file, fail to find
 * one, and serve a 404 — a deep link that works only if you never use it as a
 * link. A hash never reaches the server.
 */
const HASHES = { landing: '', catalog: '#selection', signin: '#sign-in' } as const;
type Routed = keyof typeof HASHES;

const routeOf = (hash: string): Routed =>
  hash === '#selection' ? 'catalog' : hash === '#sign-in' ? 'signin' : 'landing';

const urlFor = (r: Routed) => `${location.pathname}${location.search}${HASHES[r]}`;

export function startHistory(): () => void {
  // Whatever the visitor arrived at wins the first round: a link to
  // /selection should open the selection page, not bounce to the landing one.
  const initial = routeOf(location.hash);
  if (initial !== 'landing') store.mode.value = initial;
  // A share link is also a hash — `#repo=owner/name&t=12` — and rewriting the
  // URL to a bare route here would throw away the thing the visitor followed
  // before `boot()` had finished reading it. Only normalise a hash we own.
  const ours = initial !== 'landing' || location.hash === '';
  history.replaceState({ route: initial }, '', ours ? urlFor(initial) : location.href);

  let current: Routed = initial;

  const onPop = (e: PopStateEvent) => {
    const route = (e.state?.route as Routed | undefined) ?? routeOf(location.hash);
    current = route;
    // Leaving the stage means leaving the sound behind with it; a performance
    // that keeps playing under the selection page is the bug people report as
    // "the music won't stop".
    if (store.mode.value === 'player') store.chromeHidden.value = false;
    store.panel.value = 'none';
    store.mode.value = route;
  };
  window.addEventListener('popstate', onPop);

  const stop = store.mode.subscribe((mode) => {
    // A performance is not a route, but it must still be undoable: it pushes
    // an entry pointing back at wherever it was started from, so one Back
    // press returns there.
    const route: Routed = mode === 'player' ? current : mode;
    if (mode !== 'player' && route === current) return;
    if (mode === 'player') {
      // Same URL, new entry. Rewriting it to the bare route here threw away a
      // share link — `#repo=owner/name&t=12` is what *started* the
      // performance, and replacing it with `#selection` the moment the stage
      // appeared meant a shared link could not survive being followed.
      history.pushState({ route }, '', location.href);
      return;
    }
    current = route;
    history.pushState({ route }, '', urlFor(route));
  });

  return () => {
    window.removeEventListener('popstate', onPop);
    stop();
  };
}
