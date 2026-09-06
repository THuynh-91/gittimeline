import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/index.mjs';

/**
 * These tests exist because every branch below is a security property rather
 * than a feature. A regression in any of them is silent: sign-in still appears
 * to work, and the thing that broke is the part that was stopping somebody
 * else's site from receiving a token.
 */

const ORIGIN = 'https://gittimeline-auth.example.workers.dev';
const SITE = 'https://thuynh-91.github.io';
const ENV = {
  GITHUB_CLIENT_ID: 'Ov23liTESTCLIENTID',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  ALLOWED_ORIGINS: `${SITE}, https://gittimeline.example`,
  GITHUB_OAUTH_BASE: 'https://github.test',
};

/** A stand-in for GitHub's token endpoint that records what it was asked. */
function stubGitHub(body = { access_token: 'gho_stubtoken', token_type: 'bearer', scope: '' }, status = 200) {
  const calls = [];
  const doFetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { doFetch, calls };
}

function get(path, { cookie } = {}) {
  return new Request(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} });
}

function cookieJar(res) {
  const jar = new Map();
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i).trim(), { value: pair.slice(i + 1).trim(), attrs: raw });
  }
  return jar;
}

function header(jar) {
  return [...jar].map(([k, v]) => `${k}=${v.value}`).join('; ');
}

describe('/health', () => {
  it('reports configuration without leaking the secret', async () => {
    const res = await handleRequest(get('/health'), ENV);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, configured: true, allowed: [SITE, 'https://gittimeline.example'] });
    expect(JSON.stringify(json)).not.toContain('test-client-secret');
    expect(JSON.stringify(json)).not.toContain('Ov23liTESTCLIENTID');
  });

  it('reports unconfigured rather than pretending', async () => {
    const res = await handleRequest(get('/health'), { ...ENV, GITHUB_CLIENT_SECRET: '' });
    expect((await res.json()).configured).toBe(false);
  });
});

describe('/auth/start', () => {
  it('redirects to GitHub with no scopes and a fresh state', async () => {
    const res = await handleRequest(get(`/auth/start?return=${encodeURIComponent(`${SITE}/gittimeline/`)}`), ENV);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location'));
    expect(to.origin + to.pathname).toBe('https://github.test/login/oauth/authorize');
    // No scopes: an unscoped token reads exactly what an anonymous request
    // reads and differs only in rate limit. Anything else would be asking a
    // visitor to grant access the app never uses.
    expect(to.searchParams.get('scope')).toBe('');
    expect(to.searchParams.get('client_id')).toBe(ENV.GITHUB_CLIENT_ID);
    expect(to.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
    expect(to.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('sets the state cookie HttpOnly, Secure and SameSite=Lax', async () => {
    const res = await handleRequest(get(`/auth/start?return=${encodeURIComponent(SITE)}`), ENV);
    const jar = cookieJar(res);
    for (const name of ['gt_state', 'gt_back']) {
      const attrs = jar.get(name).attrs;
      // HttpOnly is what stops script on the return origin reading the state
      // and forging a matching callback.
      expect(attrs, name).toMatch(/HttpOnly/);
      expect(attrs, name).toMatch(/Secure/);
      expect(attrs, name).toMatch(/SameSite=Lax/);
    }
    expect(jar.get('gt_state').value).toMatch(/^[0-9a-f]{32}$/);
  });

  it('drops Secure only on a plain-http loopback, so wrangler dev works', async () => {
    const res = await handleRequest(
      new Request(`http://localhost:8787/auth/start?return=${encodeURIComponent(SITE)}`),
      ENV,
    );
    expect(cookieJar(res).get('gt_state').attrs).not.toMatch(/Secure/);
    // ...and keeps it for anything that is not loopback, http or not.
    const remote = await handleRequest(
      new Request(`http://evil.example/auth/start?return=${encodeURIComponent(SITE)}`),
      ENV,
    );
    expect(cookieJar(remote).get('gt_state').attrs).toMatch(/Secure/);
  });

  it('issues a different state every time', async () => {
    const seen = new Set();
    for (let i = 0; i < 20; i += 1) {
      const res = await handleRequest(get(`/auth/start?return=${encodeURIComponent(SITE)}`), ENV);
      seen.add(cookieJar(res).get('gt_state').value);
    }
    expect(seen.size).toBe(20);
  });

  it('refuses a return address outside the allowlist', async () => {
    for (const bad of [
      'https://evil.example/',
      // A prefix of an allowed origin, which a naive startsWith check passes.
      'https://thuynh-91.github.io.evil.example/',
      // Same host, different scheme.
      'http://thuynh-91.github.io/',
      'javascript:alert(1)',
      '//evil.example',
      'not a url',
    ]) {
      const res = await handleRequest(get(`/auth/start?return=${encodeURIComponent(bad)}`), ENV);
      expect(res.status, bad).toBe(400);
      expect(res.headers.get('location'), bad).toBe(null);
    }
  });

  /**
   * The production allowlist pins a path, because the production origin is
   * shared. `thuynh-91.github.io` is a GitHub Pages *user* origin and every
   * project under that account is served from it, so an origin-only entry
   * hands the token to any of them — a review demonstrated the live Worker
   * accepting a return address pointing at a neighbouring site on the same
   * host.
   */
  describe('an allowlist entry that carries a path', () => {
    const PINNED = { ...ENV, ALLOWED_ORIGINS: `${SITE}/gittimeline` };

    it('accepts the site it names', async () => {
      for (const good of [`${SITE}/gittimeline`, `${SITE}/gittimeline/`, `${SITE}/gittimeline/?x=1`]) {
        const res = await handleRequest(get(`/auth/start?return=${encodeURIComponent(good)}`), PINNED);
        expect(res.status, good).toBe(302);
      }
    });

    it('refuses a neighbour sharing the origin', async () => {
      for (const bad of [
        `${SITE}/tri-huynh-portfolio/`,
        `${SITE}/`,
        `${SITE}`,
        // A path that merely starts with the same characters must not pass:
        // the prefix has to end at a segment boundary.
        `${SITE}/gittimeline-evil/`,
        `${SITE}/gittimelineevil`,
        // And traversal must not climb back out of it.
        `${SITE}/gittimeline/../tri-huynh-portfolio/`,
      ]) {
        const res = await handleRequest(get(`/auth/start?return=${encodeURIComponent(bad)}`), PINNED);
        expect(res.status, bad).toBe(400);
        expect(res.headers.get('location'), bad).toBe(null);
      }
    });

    it('an entry with no path still means the whole origin', async () => {
      // So deploying the code without narrowing the allowlist changes nothing.
      const res = await handleRequest(get(`/auth/start?return=${encodeURIComponent(`${SITE}/anything/`)}`), ENV);
      expect(res.status).toBe(302);
    });
  });

  it('falls back to the first allowed origin when no return is given', async () => {
    const res = await handleRequest(get('/auth/start'), ENV);
    expect(res.status).toBe(302);
    const back = decodeURIComponent(cookieJar(res).get('gt_back').value);
    expect(new URL(back).origin).toBe(SITE);
  });

  it('fails closed when the allowlist is empty', async () => {
    const res = await handleRequest(get('/auth/start'), { ...ENV, ALLOWED_ORIGINS: '' });
    expect(res.status).toBe(400);
  });

  it('refuses to start when the OAuth App is not configured', async () => {
    const res = await handleRequest(get('/auth/start'), { ...ENV, GITHUB_CLIENT_SECRET: '' });
    expect(res.status).toBe(503);
  });
});

describe('/auth/callback', () => {
  /** Drive /auth/start, then hand the cookies it set back to /auth/callback —
   *  the same sequence a browser performs. */
  async function roundTrip({ code = 'the-code', state, env = ENV, gh = stubGitHub(), returnTo = `${SITE}/gittimeline/` } = {}) {
    const start = await handleRequest(get(`/auth/start?return=${encodeURIComponent(returnTo)}`), env);
    const jar = cookieJar(start);
    const real = jar.get('gt_state').value;
    const q = new URLSearchParams({ code, state: state ?? real });
    const res = await handleRequest(get(`/auth/callback?${q}`, { cookie: header(jar) }), env, gh.doFetch);
    return { res, gh, state: real };
  }

  it('completes a valid round trip with the token in the fragment', async () => {
    const { res, gh } = await roundTrip();
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location'));

    // The token rides in the fragment and nowhere else. Fragments are not sent
    // to servers, so it cannot reach an access log or a Referer header.
    expect(to.hash).toBe('#gh_token=gho_stubtoken');
    expect(to.search).toBe('');
    expect(to.href).toBe(`${SITE}/gittimeline/#gh_token=gho_stubtoken`);
    expect(`${to.origin}${to.pathname}${to.search}`).not.toContain('gho_stubtoken');

    // The exchange went to the token endpoint with the secret, and asked for
    // nothing else.
    expect(gh.calls).toHaveLength(1);
    expect(gh.calls[0].url).toBe('https://github.test/login/oauth/access_token');
    expect(gh.calls[0].init.method).toBe('POST');
    expect(gh.calls[0].body).toEqual({
      client_id: ENV.GITHUB_CLIENT_ID,
      client_secret: ENV.GITHUB_CLIENT_SECRET,
      code: 'the-code',
      redirect_uri: `${ORIGIN}/auth/callback`,
    });
    expect(gh.calls[0].body.scope).toBeUndefined();
  });

  it('clears both cookies once they have been used', async () => {
    const { res } = await roundTrip();
    const cleared = cookieJar(res);
    expect(cleared.get('gt_state').value).toBe('');
    expect(cleared.get('gt_state').attrs).toMatch(/Max-Age=0/);
    expect(cleared.get('gt_back').attrs).toMatch(/Max-Age=0/);
  });

  it('rejects a forged state and never reaches GitHub', async () => {
    const { res, gh } = await roundTrip({ state: 'f'.repeat(32) });
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBe(null);
    // The exchange must not happen at all — a rejected callback that still
    // burns the code would let an attacker probe with real codes.
    expect(gh.calls).toHaveLength(0);
  });

  it('rejects a state that shares a long prefix, so the compare cannot be walked', async () => {
    const start = await handleRequest(get(`/auth/start?return=${encodeURIComponent(SITE)}`), ENV);
    const jar = cookieJar(start);
    const real = jar.get('gt_state').value;
    const gh = stubGitHub();
    for (const forged of [
      real.slice(0, 31) + (real[31] === 'a' ? 'b' : 'a'), // 31 of 32 characters right
      real.slice(0, 31), // a correct prefix, one character short
      real + '0', // correct plus one
      '',
    ]) {
      const res = await handleRequest(get(`/auth/callback?code=c&state=${forged}`, { cookie: header(jar) }), ENV, gh.doFetch);
      expect(res.status, forged).toBe(400);
    }
    expect(gh.calls).toHaveLength(0);
  });

  it('rejects a callback with no state at all', async () => {
    const gh = stubGitHub();
    const start = await handleRequest(get(`/auth/start?return=${encodeURIComponent(SITE)}`), ENV);
    const res = await handleRequest(get('/auth/callback?code=c', { cookie: header(cookieJar(start)) }), ENV, gh.doFetch);
    expect(res.status).toBe(400);
    expect(gh.calls).toHaveLength(0);
  });

  it('rejects a callback with no cookies, which is what a bare forged link is', async () => {
    const gh = stubGitHub();
    const res = await handleRequest(get('/auth/callback?code=c&state=abc'), ENV, gh.doFetch);
    expect(res.status).toBe(400);
    expect(gh.calls).toHaveLength(0);
  });

  it('re-checks the return cookie against the allowlist', async () => {
    // A hand-written cookie naming a site that is not allowed. The allowlist is
    // consulted again here rather than trusted from /auth/start, because the
    // cookie is the attacker's to write if they can reach this host.
    const gh = stubGitHub();
    const cookie = `gt_state=${'a'.repeat(32)}; gt_back=${encodeURIComponent('https://evil.example/')}`;
    const res = await handleRequest(get(`/auth/callback?code=c&state=${'a'.repeat(32)}`, { cookie }), ENV, gh.doFetch);
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBe(null);
    expect(gh.calls).toHaveLength(0);
  });

  it('reports a refused exchange as gh_error rather than a blank return', async () => {
    const { res } = await roundTrip({ gh: stubGitHub({ error: 'bad_verification_code' }, 200) });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location'));
    expect(to.hash).toBe('#gh_error=1');
    expect(to.origin).toBe(SITE);
  });

  it('reports a token endpoint that throws the same way', async () => {
    const doFetch = async () => {
      throw new Error('network down');
    };
    const start = await handleRequest(get(`/auth/start?return=${encodeURIComponent(SITE)}`), ENV);
    const jar = cookieJar(start);
    const res = await handleRequest(
      get(`/auth/callback?code=c&state=${jar.get('gt_state').value}`, { cookie: header(jar) }),
      ENV,
      doFetch,
    );
    expect(new URL(res.headers.get('location')).hash).toBe('#gh_error=1');
  });

  it('never echoes GitHub error text, which could carry configuration detail', async () => {
    const { res } = await roundTrip({
      gh: stubGitHub({ error: 'incorrect_client_credentials', error_description: 'secret test-client-secret is wrong' }),
    });
    expect(res.headers.get('location')).not.toContain('test-client-secret');
    expect(await res.text()).toBe('');
  });

  it('drops a fragment the caller tried to smuggle into the return address', async () => {
    const { res } = await roundTrip({ returnTo: `${SITE}/gittimeline/#gh_token=attacker` });
    expect(res.headers.get('location')).toBe(`${SITE}/gittimeline/#gh_token=gho_stubtoken`);
  });

  it('preserves the query string of the return address', async () => {
    const { res } = await roundTrip({ returnTo: `${SITE}/gittimeline/?repo=torvalds%2Flinux` });
    expect(res.headers.get('location')).toBe(`${SITE}/gittimeline/?repo=torvalds%2Flinux#gh_token=gho_stubtoken`);
  });
});

describe('everything else', () => {
  it('is a 404 — this Worker has no other surface', async () => {
    for (const path of ['/', '/auth', '/api/repos', '/auth/callback/../health']) {
      expect((await handleRequest(get(path), ENV)).status).toBe(404);
    }
  });

  it('is never cached', async () => {
    for (const path of ['/health', `/auth/start?return=${encodeURIComponent(SITE)}`, '/nope']) {
      expect((await handleRequest(get(path), ENV)).headers.get('cache-control')).toBe('no-store');
    }
  });
});
