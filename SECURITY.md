# Security policy

## Scope

GitTimeline is a static site with no backend. The attack surface is the browser: repository data fetched from `api.github.com`, `.gittimeline` artifacts imported by the user, share-link parameters, and the optional GitHub token.

## What the code does

- **Hostile text.** Commit messages, names, ref names and descriptions are sanitized (`src/model/sanitize.ts`): control and bidi characters stripped, lengths capped, everything rendered as text nodes. Only `https://github.com/...` links are navigable. JSON from GitHub and artifacts is deep-cloned with prototype-polluting keys dropped.
- **Artifacts.** Size-bounded (400 MB, bounded decompression), schema-versioned, content-hash verified, and rebuilt through the same normalizer as live data. They contain data only — never code, tokens or raw e-mail addresses. The bound was 60 MB when this was written and rose with the shelf; `MAX_ARTIFACT_BYTES` in `src/export/artifact.ts` is the number that matters.
- **Tokens.** An optional fine-grained token stays in memory for the tab, is sent only to `api.github.com` as a bearer header, and is never stored, logged, exported or placed in links.
- **CSP.** `index.html` ships a `<meta>` Content-Security-Policy: scripts from the site origin only, no `unsafe-eval`, no third-party scripts, self-hosted assets (system fonts). `connect-src` is the site origin, `api.github.com`, the configured catalog host (`VITE_CATALOG_BASE`, injected at build time — the shelf moved to an object store and the page has to be allowed to read it), and the Google Analytics hosts, which are reachable only when `VITE_GA_ID` is set and are unused on a build without it. This line previously said "connections only to `api.github.com`", which was true before the shelf moved.
- **No `Math.random`, no `eval`, no HTML injection.** The poster SVG escapes all text.
- **Supply chain.** Locked dependencies, Dependabot for npm and Actions, minimal runtime dependencies (`preact`, `@preact/signals`).

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository (Security → Advisories → Report a vulnerability) or contact the maintainers privately. Do not open a public issue for exploitable problems. We aim to acknowledge reports within a week.

## Supported versions

The `main` branch and the latest deployed site.
