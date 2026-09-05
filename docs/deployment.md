# Deployment

GitTimeline is a static bundle (`dist/`) with no runtime backend. Two workflows live in `.github/workflows/`:

- **`ci.yml`** — on pull requests and non-default branches: `npm ci`, lint, type-check, unit tests, build, Playwright browser tests against the built output (report uploaded on failure).
- **`deploy.yml`** — on pushes to `main`/`master` (and manually): the same verification, then a build with the GitHub Pages base path, a smoke run of the demo test, `404.html` copy for hash-routing safety, `actions/upload-pages-artifact` and `actions/deploy-pages` into the `github-pages` environment.

The base path is derived from the repository name: project sites are served from `/<repository>/`, user/organization sites (`<owner>.github.io`) from `/`. Locally `VITE_BASE` defaults to `/`.

## Publishing

Publishing requires a GitHub repository and Pages configured to deploy from **GitHub Actions**:

1. Push this project to a public GitHub repository.
2. In the repository, open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main` (or run the *Deploy to GitHub Pages* workflow manually). The workflow builds, verifies and publishes; the environment URL appears on the run.

No secrets are needed: `deploy-pages` uses the workflow's OIDC token (`id-token: write`, `pages: write`).

## Sign-in (optional)

The site works without it, at GitHub's anonymous rate limit, with a personal
access token as the manual alternative. Signing in raises that limit and lets a
visitor watch their own private repositories.

It needs one piece of server code and cannot be done without it: GitHub's OAuth
token endpoints send no CORS headers, so a browser physically cannot exchange
an authorization code for a token, and GitHub offers no PKCE for public
clients. `worker/` is a Cloudflare Worker that makes exactly that one call and
nothing else — 2.02 KiB gzipped. See `worker/README.md` for the routes, the
secrets and the threat model.

To turn it on:

1. Create a GitHub OAuth App and point its callback at the deployed Worker.
2. `cd worker && npx wrangler deploy`, then set the client secret with
   `wrangler secret put`. The secret is never entered anywhere else.
3. Set `VITE_AUTH_BASE` to the Worker's origin for the Pages build.

With `VITE_AUTH_BASE` unset the sign-in button explains that this deployment
has no auth configured rather than offering a control that cannot work.

Note that the flow is a top-level navigation (`location.href`), not a `fetch`.
That is why the page's `connect-src` does not list the Worker and does not need
to: nothing is ever requested from it by script.

## Size

A published GitHub Pages site may be no larger than 1 GB, and the pre-built
catalog is most of what is published. `deploy.yml` fails the build above that
ceiling and warns as it approaches.

Two things keep it under:

- `scripts/prune-catalog.mjs --apply` drops datasets nothing can ask for. When
  an entry ships a compiled plan the browser plays the plan and reads the
  dataset only to fill in commit subjects — and that fill-in is refused above
  `HYDRATE_MAX_BYTES` because it is one synchronous pass that would freeze the
  stage. Every dataset above that limit is therefore shipped and never fetched.
  Run it before publishing; keep the datasets locally, since they are what a
  plan is rebuilt from.
- `SHIPPED` in `scripts/index-artifacts.mjs` decides what is on the shelf at
  all.

## Security posture of the deployment

- Dependencies are installed from the lockfile (`npm ci`); Dependabot watches npm and Actions weekly/monthly.
- Actions are referenced by major version tags. Pinning to commit SHAs is recommended once the repository is public and a review process exists (see `SECURITY.md`).
- The page ships a `<meta>` Content-Security-Policy allowing scripts only from the site origin, connections only to `api.github.com`, and no `unsafe-eval`. (GitHub Pages cannot set response headers, so `frame-ancestors` cannot be enforced there.)
- The optional GitHub token (Settings) lives in memory for the tab only and is sent solely to `api.github.com`.

## Local preview of the production build

```bash
npm run build
npm run preview      # http://localhost:4173
```
