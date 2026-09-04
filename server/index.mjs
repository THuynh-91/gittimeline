import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * GitHub sign-in, and nothing else.
 *
 * GitTimeline is a static site and stays one. This exists because of a single
 * hard limitation: GitHub's OAuth token endpoints send no CORS headers, so a
 * browser physically cannot exchange an authorization code for a token, even
 * with the device flow. Measured, not assumed —
 *
 *   api.github.com                  Access-Control-Allow-Origin: *
 *   github.com/login/device/code    (no CORS headers at all)
 *
 * — so the exchange has to happen somewhere with a server. That is all this
 * does. It never sees a repository, never proxies the API, never stores
 * anything: it swaps the code for a token, hands the token to the browser in a
 * URL fragment (fragments are not sent to servers and do not appear in
 * referrer headers or access logs), and the browser talks to api.github.com
 * directly from then on. "Fetched from GitHub, rendered on your device" stays
 * literally true.
 *
 * The token is requested with **no scopes**. An unscoped OAuth token can read
 * exactly what an anonymous request can — public data — and differs only in
 * rate limit: 5,000 requests an hour instead of 60. So the worst case if one
 * leaks is that somebody reads public repositories quickly.
 *
 * Deploying this is optional. Without it the app behaves exactly as before and
 * a viewer can still paste a personal access token.
 *
 * Required environment:
 *   GITHUB_CLIENT_ID      from the OAuth App
 *   GITHUB_CLIENT_SECRET  from the OAuth App — set it in the dashboard, never in code
 *   ALLOWED_ORIGINS       comma-separated exact origins allowed to receive a token
 */

const CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? '';
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? 'https://thuynh-91.github.io')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);
const PORT = Number(process.env.PORT ?? 10000);

/** Where the browser is sent afterwards, checked against the allowlist so this
 *  can never be used as an open redirect. */
function safeReturn(raw) {
  if (!raw) return ALLOWED[0] ?? null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const origin = `${url.protocol}//${url.host}`;
  if (!ALLOWED.includes(origin)) return null;
  url.hash = '';
  return url.toString();
}

function cookies(req) {
  const out = new Map();
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
  }
  return out;
}

/** Constant-time compare that does not throw on length mismatch. */
function sameState(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/health') {
    return send(res, 200, JSON.stringify({ ok: true, configured: Boolean(CLIENT_ID && CLIENT_SECRET), allowed: ALLOWED }), {
      'content-type': 'application/json',
    });
  }

  if (url.pathname === '/auth/start') {
    if (!CLIENT_ID || !CLIENT_SECRET) return send(res, 503, 'Sign-in is not configured on this deployment.');
    const back = safeReturn(url.searchParams.get('return'));
    if (!back) return send(res, 400, 'That return address is not on this deployment’s allowlist.');

    const state = randomBytes(16).toString('hex');
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.searchParams.set('client_id', CLIENT_ID);
    authorize.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
    // No scopes. Public data at a higher rate limit is the entire point; asking
    // for more would be asking a viewer to trust this with something it does
    // not need and does not want.
    authorize.searchParams.set('scope', '');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('allow_signup', 'false');

    return send(res, 302, '', {
      location: authorize.toString(),
      'set-cookie': [
        `gt_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        `gt_back=${encodeURIComponent(back)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      ],
    });
  }

  if (url.pathname === '/auth/callback') {
    const jar = cookies(req);
    const back = safeReturn(jar.get('gt_back'));
    if (!back) return send(res, 400, 'This sign-in attempt has expired. Please start again.');
    // The state cookie is what makes a forged callback useless: without it an
    // attacker cannot get a token minted into somebody else's browser.
    if (!sameState(jar.get('gt_state'), url.searchParams.get('state'))) {
      return send(res, 400, 'Sign-in could not be verified. Please start again.');
    }
    const code = url.searchParams.get('code');
    if (!code) return send(res, 400, 'GitHub did not return an authorization code.');

    let token = null;
    try {
      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          redirect_uri: `${url.origin}/auth/callback`,
        }),
      });
      const data = await r.json();
      token = typeof data?.access_token === 'string' ? data.access_token : null;
    } catch {
      token = null;
    }

    const clear = [
      'gt_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      'gt_back=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    ];
    // In the fragment, never the query: fragments are not sent to servers and
    // do not reach access logs or referrer headers.
    const target = `${back}#${token ? `gh_token=${encodeURIComponent(token)}` : 'gh_error=1'}`;
    return send(res, 302, '', { location: target, 'set-cookie': clear });
  }

  send(res, 404, 'Not found');
});

server.listen(PORT, () => {
  console.log(`gittimeline auth listening on ${PORT}; configured=${Boolean(CLIENT_ID && CLIENT_SECRET)}; allowed=${ALLOWED.join(', ')}`);
});
