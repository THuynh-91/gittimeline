# Setting up GitHub sign-in

About ten minutes, most of it waiting for a deploy. The site works without any
of this — at GitHub's anonymous rate limit, with a personal access token as the
manual alternative — so nothing here is urgent and nothing here is risky to
defer.

Only step 2 genuinely has to be done by hand. GitHub has no API for creating an
OAuth App: `POST /applications` returns 404. It is a form, deliberately.

---

## Why any server exists at all

GitHub's token endpoint sends no CORS headers, so a browser physically cannot
exchange an authorization code for a token, and GitHub offers no PKCE for
public clients. Measured, not assumed:

```
api.github.com                        Access-Control-Allow-Origin: *
github.com/login/oauth/access_token   (no CORS headers at all)
github.com/login/device/code          (no CORS headers at all)
```

Exactly one call has to happen off the browser. `worker/` does that call and
nothing else — 2.02 KiB gzipped, no database, no logs.

---

## 1. Deploy the Worker (before the OAuth App)

This order is deliberate: the OAuth App needs a callback URL, and the callback
URL is the Worker's, so the Worker has to exist first. It will deploy fine
without its secrets — it just answers "not configured" until step 3.

```bash
cd worker
npm install
npx wrangler login       # opens a browser once
npx wrangler deploy
```

Note the URL it prints. It will look like:

```
https://gittimeline-auth.<your-subdomain>.workers.dev
```

Call that **`WORKER_URL`** below.

---

## 2. Create the OAuth App — the one manual step

Go to **https://github.com/settings/developers** → **OAuth Apps** → **New OAuth App**.

| Field | Value |
| --- | --- |
| Application name | `GitTimeline` |
| Homepage URL | `https://thuynh-91.github.io/gittimeline/` |
| Authorization callback URL | **`WORKER_URL/auth/callback`** |
| Enable Device Flow | leave **unchecked** |

Press **Register application**. On the next screen:

- copy the **Client ID**;
- press **Generate a new client secret** and copy it. GitHub shows it once.

Do not paste the secret into a chat window, a commit, or this file. It goes
straight into step 3 and nowhere else.

---

## 3. Give the Worker its credentials

```bash
cd worker
npx wrangler secret put GITHUB_CLIENT_ID       # paste the Client ID
npx wrangler secret put GITHUB_CLIENT_SECRET   # paste the secret
```

`wrangler secret put` stores these encrypted against the deployed Worker. They
are never in the repository — `wrangler.toml` has no secrets in it and must
never gain any.

Check it came up:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$WORKER_URL/auth/start?return=https://thuynh-91.github.io/gittimeline/"
# 302 means configured. 503 means the secrets are missing.
```

---

## 4. Point the site at it

`VITE_AUTH_BASE` is read at build time, so it has to be set where the site is
built — GitHub Actions.

**Settings → Secrets and variables → Actions → Variables → New repository variable**

| Name | Value |
| --- | --- |
| `VITE_AUTH_BASE` | `WORKER_URL` (no trailing slash) |

Then re-run the deploy workflow. With it unset the sign-in page says this
deployment has no auth configured, which is honest rather than broken.

---

## 5. To try it on localhost first

`ALLOWED_ORIGINS` in `worker/wrangler.toml` is the single control that stops
this Worker minting a token into somebody else's site, so it is in the
repository where a change shows up in a diff rather than in a dashboard where
it would not.

It currently reads:

```toml
ALLOWED_ORIGINS = "https://thuynh-91.github.io"
```

To test against a local preview, add the local origin, redeploy, and **take it
out again before you are done**:

```toml
ALLOWED_ORIGINS = "https://thuynh-91.github.io,http://localhost:4173"
```

```bash
npx wrangler deploy
VITE_AUTH_BASE=<WORKER_URL> npm run build && npm run preview
```

---

## What signing in actually does

- **Raises the rate limit** from about 60 requests an hour to about 5,000.
  That is the whole of it for public repositories.
- **Asks for no permissions.** The authorize URL sets `scope=''`, so GitHub
  issues a token that can read what any logged-out visitor can read and nothing
  more. It cannot star, fork, comment, push, or change anything.
- **Stores nothing.** The token lives in the tab's memory and is sent only to
  `api.github.com`. There is no backend and no database to keep it in.
- Workers Logs are switched off in `wrangler.toml` on purpose: observability
  records request URLs, and `/auth/callback` carries the authorization code in
  its query string. Use `npx wrangler tail` if you need to watch it live.

Private repositories are a **second, separate** authorization the visitor grants
per repository. They are never included by signing in.

---

## If it does not work

| Symptom | Cause |
| --- | --- |
| Sign-in button says "not connected on this deployment" | `VITE_AUTH_BASE` unset at build time. It is baked in at build, not read at runtime. |
| `/auth/start` returns 503 | The Worker has no `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`. Step 3. |
| Redirected back with an error banner | The callback URL on the OAuth App does not exactly match `WORKER_URL/auth/callback`. |
| Returns to the site but no token | The site's origin is not in `ALLOWED_ORIGINS`. Step 5. |
