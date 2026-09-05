# GitTimeline auth

> **Superseded by [`worker/`](../worker/README.md).**
>
> This is the Node original, and it is being replaced by a Cloudflare Worker
> that does the same thing in 2 KB gzipped. `task-additional.md` asks for "a
> tiny serverless function only for GitHub authentication" and says a
> traditional Render backend "should not be necessary"; this was written before
> that document was read. It works, but it is the wrong shape — a container that
> idles, sleeps on the free tier, and has to be maintained, for a job that is a
> few hundred bytes of request handling a handful of times a day.
>
> The flow is identical in both, deliberately: same routes, same `HttpOnly`
> state cookie compared in constant time, same origin allowlist, same token in
> the URL fragment, same absence of scopes. Porting it was not a redesign.
>
> This directory stays until the Worker is deployed and sign-in is confirmed
> against it — deleting a working implementation before its replacement is live
> would leave sign-in broken in between. Once `VITE_AUTH_BASE` points at the
> Worker and a real sign-in has completed, delete `server/` and update
> `DEFAULT_AUTH_BASE` in `src/app/auth.ts`.

A GitHub sign-in service, and nothing else. **Deploying it is optional** — the
site is a static bundle and works without it.

## Why it has to exist

GitHub's OAuth token endpoints send no CORS headers, so a browser cannot
exchange an authorization code for a token. Measured, not assumed:

```
api.github.com                  Access-Control-Allow-Origin: *
github.com/login/device/code    (no CORS headers at all)
```

The device flow does not help — the same endpoint, the same missing header. So
the exchange has to happen somewhere with a server.

## What it does, and does not

It swaps the code for a token and redirects back with the token in the URL
**fragment**, which browsers do not send to servers and which never reaches an
access log or a referrer header. From there the browser talks to
`api.github.com` directly. This service never sees a repository, never proxies
the API, and stores nothing.

The token is requested with **no scopes**. An unscoped OAuth token reads
exactly what an anonymous request reads — public data — and differs only in
rate limit: 5,000 requests an hour instead of 60.

## Setting it up

1. Create an OAuth App at <https://github.com/settings/developers>.
   - Homepage URL: your site, e.g. `https://thuynh-91.github.io/gittimeline/`
   - Authorization callback URL: `https://<this-service>.onrender.com/auth/callback`
2. Set these on the service (in the dashboard, so the secret is never in code):
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `ALLOWED_ORIGINS` — comma-separated exact origins allowed to receive a
     token. This is what stops the service being used as an open redirect.
3. Build the site with `VITE_AUTH_BASE=https://<this-service>.onrender.com`.
   Without that variable the sign-in button does not appear at all.

`GET /health` reports whether it is configured.

Note that a free Render instance sleeps when idle, so the first sign-in after a
quiet period waits for a cold start.
