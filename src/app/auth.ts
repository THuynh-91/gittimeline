import { store } from './store';

/**
 * Optional GitHub sign-in.
 *
 * GitHub's OAuth token endpoints send no CORS headers, so a browser cannot
 * complete the exchange itself — not even with the device flow. If a deployment
 * provides a tiny service that can (see `server/`), this offers sign-in; if not,
 * `AUTH_BASE` is empty, nothing renders, and the site is exactly as static as
 * it was.
 *
 * The resulting token carries no scopes. It reads precisely what an anonymous
 * request reads, and differs only in rate limit: about 5,000 requests an hour
 * rather than 60.
 */
/**
 * Where the token exchange happens.
 *
 * `VITE_AUTH_BASE` overrides it — a fork with its own service, or a local one
 * during development. The default is the deployed instance, because leaving it
 * empty meant the sign-in button did not render at all: the page explained
 * what connecting GitHub would do and then offered no way to do it, which
 * reads as broken rather than as unconfigured.
 */
const DEFAULT_AUTH_BASE = 'https://gittimeline-auth.onrender.com';

export const AUTH_BASE: string = (import.meta.env.VITE_AUTH_BASE ?? DEFAULT_AUTH_BASE).replace(/\/$/, '');

export function signInWithGitHub() {
  if (!AUTH_BASE) return;
  const back = `${location.origin}${location.pathname}${location.search}`;
  location.href = `${AUTH_BASE}/auth/start?return=${encodeURIComponent(back)}`;
}

/**
 * Pick up a token handed back in the URL fragment, then remove it from the
 * address bar. The fragment is used precisely because browsers never send it
 * to a server, so the token cannot appear in an access log or a referrer.
 */
export function claimTokenFromUrl(): boolean {
  if (!location.hash.includes('gh_token=') && !location.hash.includes('gh_error=')) return false;
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const token = params.get('gh_token');
  params.delete('gh_token');
  params.delete('gh_error');
  const rest = params.toString();
  history.replaceState(null, '', `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`);
  if (token) {
    store.token.value = token;
    return true;
  }
  // A failed sign-in used to vanish silently: the fragment was stripped, no
  // token appeared, and the page looked exactly as it had before the round
  // trip. Somebody who has just authorised an application and been returned to
  // an unchanged screen has no way to tell whether it worked.
  const err = new URLSearchParams(location.hash.replace(/^#/, '')).get('gh_error') ?? params.get('gh_error');
  if (err !== null) {
    store.banner.value = {
      kind: 'rate-limited',
      message: 'GitHub sign-in did not complete. Public repositories still work at the anonymous rate, and the ready-made histories cost no requests at all.',
    };
  }
  return false;
}
