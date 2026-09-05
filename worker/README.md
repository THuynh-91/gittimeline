# GitTimeline auth — Cloudflare Worker

A GitHub sign-in function, and nothing else. **Deploying it is optional** — the
site is a static bundle on GitHub Pages and works without it, at the anonymous
rate limit, with a personal access token as the manual alternative.

This replaces `server/`, the Node service on Render. Same flow, same security
properties, no container: `task-additional.md` asks for "a tiny serverless
function only for GitHub authentication", not "a full Render server", and this
is that. It bundles to **5.26 KiB (2.02 KiB gzipped)** and has nothing to sleep.

## Why any server code exists at all

GitHub's OAuth token endpoints send no CORS headers, so a browser physically
cannot exchange an authorization code for a token, and GitHub offers no PKCE
for public clients. Measured, not assumed:

```
api.github.com                        Access-Control-Allow-Origin: *
github.com/login/oauth/access_token   (no CORS headers at all)
github.com/login/device/code          (no CORS headers at all)
```

The device flow does not help — same endpoint, same missing header. So exactly
one call has to happen off the browser. That call is all this does.

## What it does, and does not

| Route | What happens |
| --- | --- |
| `GET /auth/start?return=<url>` | Checks `return` against the allowlist, mints a state, sets two `HttpOnly` cookies, redirects to GitHub's consent screen. |
| `GET /auth/callback?code&state` | Compares state against the cookie in constant time, exchanges the code for a token, redirects to `return` with the token in the **fragment**. |
| `GET /health` | `{ ok, configured, allowed }`. Never reports the client id or the secret. |
| anything else | `404`. There is no other surface. |

It never sees a repository, never proxies the GitHub API, and stores nothing —
no database, no KV, no logs of the token. After the redirect the browser talks
to `api.github.com` directly, so "fetched from GitHub, rendered on your device"
stays literally true.

The token is requested with **no scopes**. An unscoped OAuth token reads exactly
what an anonymous request reads — public data — and differs only in rate limit:
5,000 requests an hour instead of 60. The worst case if one leaks is that
somebody reads public repositories quickly.

### The four things holding it up

Each of these is load-bearing, and each is commented at its decision point in
`src/index.mjs`:

- **The state cookie, compared in constant time.** Without it, an attacker can
  hand a victim a `/auth/callback` link carrying the attacker's own code and get
  a token for the *attacker's* account minted into the victim's browser, after
  which the victim's activity runs under it. Workers have no `node:crypto`, so
  there is no `timingSafeEqual` to call; the Worker uses a hand-written compare
  that never short-circuits, because a short-circuiting `===` leaks how many
  leading characters were right and turns forgery into a few hundred guesses.
- **The origin allowlist on the return URL** (`ALLOWED_ORIGINS`). Without it,
  anyone could point `?return=` at their own site and receive visitors' tokens.
  It is re-checked at the callback, not just at the start.
- **The token in the fragment, never the query string.** Browsers do not send
  fragments to servers, so the token cannot land in an access log, a `Referer`
  header, or the analytics call the page makes on load.
- **No scopes**, as above.

---

## Setting it up

Roughly fifteen minutes, most of it waiting for `npm`. Steps 1 and 2 have to be
done by hand: GitHub has no API for creating an OAuth App (`POST /applications`
returns 404), so nothing can automate it for you.

### 0. What you need

- A Cloudflare account — the free plan is enough. Sign up at
  <https://dash.cloudflare.com/sign-up>. No credit card, no domain required;
  the Worker gets a free `*.workers.dev` address.
- Node 20 or newer (`node -v`).

### 1. Pick the Worker's name first

The name in `wrangler.toml` decides the URL, and the URL has to be registered
with GitHub in step 2, so choose it before creating the OAuth App. As shipped:

```toml
name = "gittimeline-auth"
```

Your Worker will be at `https://gittimeline-auth.<your-subdomain>.workers.dev`.
`<your-subdomain>` is chosen once per Cloudflare account — it is shown in the
dashboard under **Workers & Pages**, and Wrangler prints the full URL the first
time you deploy. If you do not know it yet, deploy first (step 4), read the URL
off the output, then come back and do step 2.

### 2. Create the GitHub OAuth App

At <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
(An OAuth App, not a GitHub App — the two have different endpoints.)

- **Application name** — anything, e.g. `GitTimeline`.
- **Homepage URL** — your site, e.g. `https://thuynh-91.github.io/gittimeline/`
- **Authorization callback URL** —
  `https://gittimeline-auth.<your-subdomain>.workers.dev/auth/callback`

  This must match exactly, including `https://` and the `/auth/callback` path.
  GitHub refuses the exchange if it does not.

Then **Generate a new client secret**. GitHub shows it once. Copy both the
**Client ID** and the **Client secret** somewhere for the next step; do not put
either in a file in this repository.

### 3. Set the allowlist

Edit `ALLOWED_ORIGINS` in `wrangler.toml` to the exact origin your site is
served from — scheme and host, no path, no trailing slash:

```toml
ALLOWED_ORIGINS = "https://thuynh-91.github.io"
```

Comma-separate several if you need to. Origins are compared exactly, so
`https://example.github.io` does not match `https://example.github.io.evil.com`
and `http://` does not match `https://`. This lives in the repository on purpose
— a change to the one control that stops tokens going to strangers should show
up in a diff.

### 4. Deploy

From this directory:

```bash
cd worker
npm install                       # installs wrangler only
npx wrangler login                # opens a browser; authorises Wrangler once
npx wrangler deploy
```

`wrangler deploy` prints the Worker's URL. If you skipped ahead in step 1, this
is where you learn `<your-subdomain>` — go back and register the callback URL
with GitHub now.

### 5. Set the secrets

Secrets are set *after* the first deploy, because they attach to a Worker that
exists. They are stored encrypted by Cloudflare and are never written to
`wrangler.toml` or anywhere else in this repository:

```bash
npx wrangler secret put GITHUB_CLIENT_ID        # paste the Client ID,     press Enter
npx wrangler secret put GITHUB_CLIENT_SECRET    # paste the Client secret, press Enter
```

Each command prompts for the value and does not echo it. The client ID is not
actually a secret — it appears in the authorize URL every visitor sees — but it
is per-deployment configuration, so it does not belong in a checked-in file
either, and storing it the same way keeps a fork from accidentally signing in
against somebody else's OAuth App.

Check it took:

```bash
curl https://gittimeline-auth.<your-subdomain>.workers.dev/health
# {"ok":true,"configured":true,"allowed":["https://thuynh-91.github.io"]}
```

`configured: false` means one of the two secrets is missing.

### 6. Point the site at it

The client reads `VITE_AUTH_BASE` at build time (`src/app/auth.ts`). Set it to
the Worker's origin — **no trailing slash, no `/auth` path**:

```
VITE_AUTH_BASE=https://gittimeline-auth.<your-subdomain>.workers.dev
```

For GitHub Pages that means adding it to the deploy workflow's build step, next
to `VITE_BASE`. For a local build, `VITE_AUTH_BASE=… npm run build`.

`src/app/auth.ts` needs no other change: it appends `/auth/start?return=…` and
reads the token out of the fragment, and this Worker speaks exactly the routes
the Render service spoke. Its hard-coded fallback still names the Render
instance, so once you have deployed the Worker and confirmed sign-in, change
`DEFAULT_AUTH_BASE` there to the Worker's URL and delete `server/`.

---

## Running it locally

```bash
cd worker
cp .dev.vars.example .dev.vars    # then fill in a real client id and secret
npx wrangler dev
```

`.dev.vars` is gitignored — it holds the client secret in plain text.

`wrangler dev` serves on `http://localhost:8787` in a local copy of the real
Workers runtime. Two things to know:

- Set `ALLOWED_ORIGINS` in `.dev.vars` to your dev server's origin
  (`http://localhost:5173` for `npm run dev`), or every attempt is refused —
  correctly, since your production allowlist does not include localhost.
- The Worker drops the `Secure` cookie flag for plain-http **loopback only**, so
  the state cookie survives locally. Anything that is not literally `localhost`
  or `127.0.0.1` keeps the flag. Without this the local flow fails at the state
  check for a reason that looks nothing like the cause.

For a full round trip without touching real GitHub, point the OAuth endpoints at
a stub — the same seam that exists for GitHub Enterprise Server:

```bash
npx wrangler dev --var GITHUB_OAUTH_BASE:http://127.0.0.1:8788
```

## Tests

```bash
npx vitest run --config worker/vitest.config.mjs   # from the repository root
```

24 tests over `handleRequest`, driven with a stubbed token endpoint. They are
kept out of the app's suite on purpose: `worker/` is a separate deployable, and
a green app suite should not depend on a service the app does not need in order
to work.

Every test there is a security property rather than a feature, because a
regression in any of them is silent — sign-in still appears to work, and the
thing that broke is the part stopping somebody else's site from getting a token.
The suite covers: no scopes requested; a fresh 128-bit state per attempt; the
cookies being `HttpOnly`, `Secure` and `SameSite=Lax`; `Secure` dropped for
loopback and nothing else; disallowed and lookalike return origins refused; an
empty allowlist failing closed; a forged state, a 31-of-32-character state, a
missing state and a rewritten `gt_back` cookie all rejected *without* the code
ever reaching GitHub; the token arriving in the fragment and not the query; the
cookies being cleared afterwards; a failed exchange surfacing as `gh_error=1`
rather than a blank return; and GitHub's error text never being echoed back.

## Cost and limits

The free plan gives 100,000 Worker requests a day. A sign-in is two requests.
There is no idle instance, so nothing sleeps and there is no cold start to wait
through — which is the concrete thing the Render version got wrong.

## Configuration reference

| Name | Where it goes | Purpose |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | `wrangler secret put` | OAuth App client id |
| `GITHUB_CLIENT_SECRET` | `wrangler secret put` | OAuth App client secret — never in a file |
| `ALLOWED_ORIGINS` | `[vars]` in `wrangler.toml` | Comma-separated exact origins allowed to receive a token |
| `GITHUB_OAUTH_BASE` | optional, `[vars]` or `--var` | OAuth host. Defaults to `https://github.com`; set it only for GitHub Enterprise Server or to point the flow at a stub |
