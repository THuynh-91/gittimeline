# Security policy

## Scope

GitDance is a static site with no backend. The attack surface is the browser: repository data fetched from `api.github.com`, `.gitdance` artifacts imported by the user, share-link parameters, and the optional GitHub token.

## What the code does

- **Hostile text.** Commit messages, names, ref names and descriptions are sanitized (`src/model/sanitize.ts`): control and bidi characters stripped, lengths capped, everything rendered as text nodes. Only `https://github.com/...` links are navigable. JSON from GitHub and artifacts is deep-cloned with prototype-polluting keys dropped.
- **Artifacts.** Size-bounded (60 MB, bounded decompression), schema-versioned, content-hash verified, and rebuilt through the same normalizer as live data. They contain data only — never code, tokens or raw e-mail addresses.
- **Tokens.** An optional fine-grained token stays in memory for the tab, is sent only to `api.github.com` as a bearer header, and is never stored, logged, exported or placed in links.
- **CSP.** `index.html` ships a `<meta>` Content-Security-Policy: scripts from the site origin only, connections only to `api.github.com`, no `unsafe-eval`, no third-party scripts, self-hosted assets (system fonts).
- **No `Math.random`, no `eval`, no HTML injection.** The poster SVG escapes all text.
- **Supply chain.** Locked dependencies, Dependabot for npm and Actions, minimal runtime dependencies (`preact`, `@preact/signals`).

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository (Security → Advisories → Report a vulnerability) or contact the maintainers privately. Do not open a public issue for exploitable problems. We aim to acknowledge reports within a week.

## Supported versions

The `main` branch and the latest deployed site.
