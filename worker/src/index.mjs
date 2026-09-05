/**
 * GitHub sign-in, and nothing else.
 *
 * GitTimeline is a static site and stays one. This exists because of a single
 * hard limitation: GitHub's OAuth token endpoints send no CORS headers, so a
 * browser physically cannot exchange an authorization code for a token, even
 * with the device flow, and GitHub does not offer PKCE for public clients.
 * Measured, not assumed —
 *
 *   api.github.com                        Access-Control-Allow-Origin: *
 *   github.com/login/oauth/access_token   (no CORS headers at all)
 *   github.com/login/device/code          (no CORS headers at all)
 *
 * — so exactly one call has to happen somewhere with a server. This is that
 * call and nothing more. It never sees a repository, never proxies the API,
 * and stores nothing: it swaps the code for a token, hands the token to the
 * browser in a URL fragment, and the browser talks to api.github.com directly
 * from then on. "Fetched from GitHub, rendered on your device" stays literally
 * true.
 *
 * This is a Cloudflare Worker rather than a container because the workload is
 * a few hundred bytes of request handling a handful of times a day. A Render
 * instance for that idles, sleeps on the free tier — so the first sign-in
 * after a quiet period pays a cold start — and has to be maintained. A Worker
 * has no process to sleep. the Node original this was ported from is gone, and the two
 * behave identically; it stays until this one is deployed and proven.
 *
 * Configuration (all through Worker secrets and vars, never in wrangler.toml):
 *   GITHUB_CLIENT_ID      from the OAuth App
 *   GITHUB_CLIENT_SECRET  from the OAuth App — `wrangler secret put`, never in code
 *   ALLOWED_ORIGINS       comma-separated exact origins allowed to receive a token
 *   GITHUB_OAUTH_BASE     optional; where the OAuth dance happens
 */

/** Where the OAuth endpoints live. Overridable for two honest reasons: GitHub
 *  Enterprise Server hosts them on the customer's own domain, and the flow
 *  cannot be exercised end to end without pointing the token exchange at a
 *  stub. It is never read from the request, only from deployment config, so a
 *  visitor cannot aim the exchange anywhere. */
const DEFAULT_OAUTH_BASE = 'https://github.com';

/** Read the origin allowlist. This is the single thing standing between the
 *  Worker and being an open redirect that mints tokens into any site that asks,
 *  so an unset or unparseable value has to fail closed rather than default to
 *  "anywhere". */
function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/** Where the browser is sent afterwards, checked against the allowlist so this
 *  can never be used as an open redirect. An attacker who could pass their own
 *  site here would receive the visitor's token in their own address bar. */
function safeReturn(raw, allowed) {
  if (!raw) return allowed[0] ?? null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const origin = `${url.protocol}//${url.host}`;
  if (!allowed.includes(origin)) return null;
  // Drop any fragment the caller supplied: the token is appended as the
  // fragment later and a pre-existing one would either be overwritten silently
  // or, worse, concatenated into something the client parser misreads.
  url.hash = '';
  return url.toString();
}

function cookies(request) {
  const out = new Map();
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
  }
  return out;
}

/**
 * Constant-time string comparison.
 *
 * Workers have no `node:crypto`, so there is no `timingSafeEqual` to call and
 * the obvious substitute — `a === b` — is exactly what must not happen here.
 * A short-circuiting compare leaks how many leading characters of the state
 * were right, which turns forging a callback into a few hundred guesses rather
 * than 2^128. So: no early return anywhere, walk the longer of the two, and
 * fold the length difference into the same accumulator rather than testing it
 * separately.
 */
function sameState(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  if (x.length === 0 || y.length === 0) return false;
  const n = Math.max(x.length, y.length);
  // Seeded with the length difference so a wrong-length guess cannot be
  // distinguished from a wrong-content one by timing.
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i += 1) {
    // `charCodeAt` past the end is NaN, and NaN ^ n is n — usable, but relying
    // on that would be a puzzle to read, so index modulo length and let the
    // length term above carry the mismatch.
    diff |= x.charCodeAt(i % x.length) ^ y.charCodeAt(i % y.length);
  }
  return diff === 0;
}

/** 128 bits from the platform CSPRNG, hex-encoded. `Math.random` is banned in
 *  this project for determinism reasons; this is the opposite requirement —
 *  the state must be unguessable, so it has to come from `crypto`. */
function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `Secure` everywhere except a plain-http loopback, which is the only address
 *  `wrangler dev` can serve. Without this the local flow silently drops the
 *  state cookie and every callback fails verification, which reads as a bug in
 *  the code rather than a property of the browser. Anything that is not
 *  literally loopback keeps the flag. */
function cookieAttrs(url) {
  const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  return `Path=/; HttpOnly; ${local ? '' : 'Secure; '}SameSite=Lax`;
}

function text(status, body, headers = {}) {
  return new Response(body, { status, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8', ...headers } });
}

/** 302 with however many `Set-Cookie` headers are needed. `Headers` is the only
 *  correct way to send more than one — an object literal would collapse them. */
function redirect(location, setCookies = []) {
  const headers = new Headers({ 'cache-control': 'no-store', location });
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
}

/**
 * The whole Worker, as a function of its inputs.
 *
 * `doFetch` is injected so the token exchange can be driven against a stub in
 * tests without a network. Production passes nothing and gets the global.
 */
export async function handleRequest(request, env, doFetch = fetch) {
  const url = new URL(request.url);
  const clientId = String(env.GITHUB_CLIENT_ID ?? '');
  const clientSecret = String(env.GITHUB_CLIENT_SECRET ?? '');
  const allowed = allowedOrigins(env);
  const oauthBase = String(env.GITHUB_OAUTH_BASE ?? DEFAULT_OAUTH_BASE).replace(/\/$/, '');
  const attrs = cookieAttrs(url);

  if (url.pathname === '/health') {
    // Deliberately reports only whether it is configured, never the secret or
    // the client id, so it is safe to leave reachable.
    return new Response(JSON.stringify({ ok: true, configured: Boolean(clientId && clientSecret), allowed }), {
      status: 200,
      headers: { 'cache-control': 'no-store', 'content-type': 'application/json' },
    });
  }

  if (url.pathname === '/auth/start') {
    if (!clientId || !clientSecret) return text(503, 'Sign-in is not configured on this deployment.');
    const back = safeReturn(url.searchParams.get('return'), allowed);
    if (!back) return text(400, 'That return address is not on this deployment’s allowlist.');

    const state = randomState();
    const authorize = new URL(`${oauthBase}/login/oauth/authorize`);
    authorize.searchParams.set('client_id', clientId);
    authorize.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
    // No scopes. Public data at a higher rate limit is the entire point; asking
    // for more would be asking a viewer to trust this with something it does
    // not need and does not want.
    authorize.searchParams.set('scope', '');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('allow_signup', 'false');

    // Both cookies are HttpOnly so that script on the return origin — ours or
    // anyone else's, via an XSS — cannot read the state and forge a matching
    // callback. Ten minutes is long enough to read GitHub's consent screen and
    // short enough that an abandoned attempt does not linger.
    return redirect(authorize.toString(), [
      `gt_state=${state}; ${attrs}; Max-Age=600`,
      `gt_back=${encodeURIComponent(back)}; ${attrs}; Max-Age=600`,
    ]);
  }

  if (url.pathname === '/auth/callback') {
    const jar = cookies(request);
    // Checked against the allowlist a second time rather than trusted because
    // it was set at /auth/start. A cookie is client-held state: it survives an
    // allowlist being tightened, and the whole point of the allowlist is that
    // the one place a token can be handed out is guarded. The check costs
    // nothing, so it happens at the moment the token actually leaves.
    const back = safeReturn(jar.get('gt_back'), allowed);
    if (!back) return text(400, 'This sign-in attempt has expired. Please start again.');
    // The state cookie is what makes a forged callback useless: without it an
    // attacker can hand a victim a /auth/callback URL carrying their own code
    // and get a token for the attacker's account minted into the victim's
    // browser, after which the victim's activity runs under it.
    if (!sameState(jar.get('gt_state'), url.searchParams.get('state'))) {
      return text(400, 'Sign-in could not be verified. Please start again.');
    }
    const code = url.searchParams.get('code');
    if (!code) return text(400, 'GitHub did not return an authorization code.');

    let token;
    try {
      const r = await doFetch(`${oauthBase}/login/oauth/access_token`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: `${url.origin}/auth/callback`,
        }),
      });
      const data = await r.json();
      token = typeof data?.access_token === 'string' ? data.access_token : null;
    } catch {
      // Any failure is reported to the visitor the same way. GitHub's error
      // bodies are about the OAuth App's configuration, not about them, and
      // echoing one back would put the client secret's error text on screen.
      token = null;
    }

    const clear = [`gt_state=; ${attrs}; Max-Age=0`, `gt_back=; ${attrs}; Max-Age=0`];
    // In the fragment, never the query: browsers do not send fragments to
    // servers, so the token cannot reach an access log, a referrer header, or
    // the analytics call the page makes on load.
    const target = `${back}#${token ? `gh_token=${encodeURIComponent(token)}` : 'gh_error=1'}`;
    return redirect(target, clear);
  }

  return text(404, 'Not found');
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
