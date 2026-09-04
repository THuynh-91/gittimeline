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
export const AUTH_BASE: string = (import.meta.env.VITE_AUTH_BASE ?? '').replace(/\/$/, '');

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
  return false;
}
