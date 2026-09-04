# Deployment

GitTimeline is a static bundle (`dist/`) with no runtime backend. Two workflows live in `.github/workflows/`:

- **`ci.yml`** — on pull requests and non-default branches: `npm ci`, lint, type-check, unit tests, build, Playwright browser tests against the built output (report uploaded on failure).
- **`deploy.yml`** — on pushes to `main`/`master` (and manually): the same verification, then a build with the GitHub Pages base path, a smoke run of the demo test, `404.html` copy for hash-routing safety, `actions/upload-pages-artifact` and `actions/deploy-pages` into the `github-pages` environment.

The base path is derived from the repository name: project sites are served from `/<repository>/`, user/organization sites (`<owner>.github.io`) from `/`. Locally `VITE_BASE` defaults to `/`.

## Publishing

Publishing requires a GitHub repository and Pages configured to deploy from **GitHub Actions**:

1. Push this project to a public GitHub repository (the working directory is a fresh `git init` with no commits yet).
2. In the repository, open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main` (or run the *Deploy to GitHub Pages* workflow manually). The workflow builds, verifies and publishes; the environment URL appears on the run.

No secrets are needed: `deploy-pages` uses the workflow's OIDC token (`id-token: write`, `pages: write`).

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
