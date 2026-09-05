# Work that can be handed to Codex

Self-contained tasks, each with enough context to start cold. They are ordered
by how much they unblock. Tasks 1–3 don't touch each other or the files I'm
working in; 4–6 do overlap, so check with me first.

**Repo:** `C:\Dev\Visual Studio\GitDance1` — TypeScript strict, Vite, Preact +
`@preact/signals`, Vitest, Playwright, ESLint flat config. Static site, no
backend, deployed to GitHub Pages.

**House rules that apply to every task below:**

- JSX uses `class`, not `className` (Preact).
- **No `Math.random` anywhere in `src/`** — lint-enforced. Determinism is a
  product invariant; use the seeded PRNG in `src/model/prng.ts`.
- Every `data-testid` in the tree is load-bearing. Grep `tests/e2e/` before
  renaming one.
- Comments explain *why*, in prose, at the point of the decision. Match the
  density of the surrounding file. Don't write comments that restate the code.
- Definition of done for anything touching `src/`:
  `npx tsc --noEmit && npx eslint . && npx vitest run && npx playwright test`
- Don't commit or push. Leave the work in the tree.

---

## 1. GitHub Action that builds the preloaded catalog

**Why it matters:** `task-additional.md` asks for famous repositories to be
pre-mapped so visitors can watch them instantly without spending API requests.
The builder exists and works; nothing runs it on a schedule.

**What exists:** `scripts/build-clone-dataset.mjs`. Run it as

```
node scripts/build-clone-dataset.mjs torvalds/linux --out public/catalog
```

It clones with `--filter=tree:0` (commit objects only — no source code is
transferred), reads the graph with `git log`, normalizes through the app's own
`buildDataset`, and writes `<owner>-<name>.gittimeline.gz`. Measured on Linux:
817 MB clone in ~4 min, 1,481,850 commits read in 21 s, normalized in 57 s.

**Build:** `.github/workflows/datasets.yml`

- Matrix over the showcase list in `task-additional.md`: torvalds/linux,
  chromium/chromium, llvm/llvm-project, kubernetes/kubernetes, python/cpython,
  rust-lang/rust, microsoft/vscode, tensorflow/tensorflow, facebook/react,
  nodejs/node.
- Cache the bare clones between runs (`actions/cache` keyed on the repo slug)
  and `git fetch` rather than re-cloning when the cache hits. A cold Chromium
  clone is large; don't pay for it weekly.
- Run on a schedule (weekly is plenty — these are historical) and on
  `workflow_dispatch`.
- Commit the artifacts back, or upload them as a Pages artifact. Prefer *not*
  committing 27 MB files into git history; publish them with the site instead.
  `public/catalog/*.gittimeline.gz` is already gitignored — keep it that way.
- `node --max-old-space-size=12288` is needed for the large repos.
- Sizes to expect, measured: react 3.5 MB, node 7.6 MB, cpython 22.8 MB,
  kubernetes 25.3 MB, vscode 26.1 MB. Runner disk is ~14 GB; Chromium and
  Linux together will be tight, so consider one repo per job rather than one
  job for all.

**Note:** the builder currently clones with `--no-tags`, so `0 tags land on
commits we have` for every repo and no releases appear in the performance.
Fixing that is task 2.

---

## 2. Make tags work in the clone builder

**Why it matters:** releases are one of the things the visualization is
supposed to show ("major releases or milestones appearing during playback" —
`task.md`). Right now every clone-built dataset has exactly one ref, the
default branch, so nothing is marked.

**Where:** `scripts/build-clone-dataset.mjs`, the `git clone` invocation and
the `for-each-ref` block near "tags, so releases show up".

The clone passes `--no-tags`, so `refs/tags` is empty and the lookup finds
nothing. Fetch tags — but a naive `git fetch --tags` on a `--filter=tree:0`
clone may try to fault in objects, so verify what it actually downloads and
how long it takes on a large repo before settling on an approach.

Linux has ~800 tags, and they are the v2.6.x/v6.x releases — this should
visibly change the performance. Verify by loading the artifact and checking
`window.__gittimeline.events('RELEASE')` (or grep `ChoreographyEvent` types in
`src/model/types.ts` for the right name) is non-empty.

---

## 3. Google Analytics, with the privacy rules actually enforced

**Why it matters:** asked for in `task-additional.md`. The privacy constraint
there is not decoration — the app's whole promise is that repository data never
leaves the browser.

**Spec, from `task-additional.md`:**

- Track visitors, page views, which showcase repos are opened, how often a
  visualization is started.
- **Never** send private repository names, source code, commit contents, or
  any private repository information.

**Build:**

- A small `src/app/analytics.ts` with a typed event surface. Nothing else in
  the app should touch `gtag` directly.
- An **allowlist**, not a blocklist: an event carrying a repository identifier
  may only name a repo that is in the shipped catalog (`public/catalog/index.json`).
  Anything a visitor pasted is reported as a shape — "a public repository",
  with commit-count bucket — never as `owner/name`. Getting this backwards is
  the failure mode that matters, so write the unit test first.
- No analytics at all when the visitor has done nothing to opt in, if you add
  a consent gate — check with me before adding UI for it.
- Respect Do Not Track and `navigator.globalPrivacyControl`.
- The measurement ID belongs in an env var (`VITE_GA_ID`), and the whole module
  must no-op when it is unset, so local development and CI send nothing.

**Test:** unit tests over the allowlist, and a Playwright assertion that no
network request to a Google endpoint carries a pasted repository slug.

---

## 4. Port the auth service off Render to a serverless function

**Why it matters:** `task-additional.md` says explicitly that a traditional
Render backend should not be necessary, and that a tiny serverless function
should handle only the OAuth token exchange. I built the Render version before
reading that document. It works but it is the wrong shape.

**What exists:** `server/index.mjs` (~200 lines) — GitHub OAuth, no scopes
requested, token returned in a URL fragment, HttpOnly state cookie compared
with `timingSafeEqual`, `ALLOWED_ORIGINS` allowlist. `server/README.md`
documents the deployment. `src/app/auth.ts` is the client half and reads
`VITE_AUTH_BASE`.

**Build:** a Cloudflare Worker (preferred — free tier, no cold start) in
`worker/`, with `wrangler.toml`. Port the logic as-is; do not redesign the
flow. Keep:

- the state cookie and its constant-time comparison,
- the origin allowlist,
- the token in the fragment rather than the query string (fragments are not
  sent to servers and don't land in logs),
- no scopes requested — public data only.

Secrets go in Worker secrets, never in `wrangler.toml`.

Leave `server/` in place; I'll delete it once the Worker is proven.

---

## 5. Documentation sweep

**Why it matters:** two large things changed tonight and the docs describe
neither. Someone reading them now would be actively misled.

- `README.md`, `docs/architecture.md`, `docs/choreography.md` still present the
  GitHub REST API as the only way history is obtained. The clone pipeline
  (task 1) is now the path for anything large, and the trade-off is worth
  explaining: the API is what a visitor's browser can do live, cloning is what
  CI can do ahead of time, and they produce the same normalized dataset because
  they share `buildDataset`.
- The sound sections were rewritten once already for recorded music, but they
  name the wrong tracks. The shipped soundtrack is now three **Rock** pieces
  from Kevin MacLeod's catalog — *Ready Aim Fire* (frantic), *Riptide*
  (driving), *Cold Funk* (calm) — chosen against the catalog's own genre
  metadata, with the build failing if a pick is not filed under Rock. The
  previous three were Soundtrack, Electronica and Funk, which is why it sounded
  like a war film. That story is worth keeping; it is the reason the check
  exists.

Don't invent numbers. Every measurement in the docs should be one you can
reproduce, and say how.

---

## 6. Raise `--max` handling so a bounded build is honest

Small, and it needs care rather than effort.

`scripts/build-clone-dataset.mjs --max N` takes the N *newest* commits, which
leaves a contiguous run ending at the tip and one boundary at the far end —
the same shape a rate-limited API fetch produces. That is deliberate.

But `coverage.summary` for a bounded build reads "N recent commits loaded;
earlier topology is not yet available (GitHub reports about M)", which is
phrased for the API path and mentions GitHub reporting something it did not.
Reword it for the clone path so it says plainly that the build was bounded and
by how much. `src/model/dataset.ts` builds the summary; check
`CoverageHints` and how `truncated` flows through.

---

## Not ready to hand off

These are mine, and they are the blocking work:

- **A compact dataset format.** `JSON.stringify` on the whole of Linux throws
  `RangeError: Invalid string length` — 1,481,850 commits is roughly 600 MB of
  JSON and Node's string ceiling is ~512 MB. This is not a tuning problem; the
  format cannot hold the data. Columnar, with parent *indices* rather than
  repeated 40-character shas, measures at ~19 MB gzipped for the whole history.
- **Why compiling a large history is slow.** Unmeasured as of writing. 60,000
  Linux commits did not produce a frame in twelve minutes, and I do not yet
  know whether that is layout, threading, choreography, or the renderer.
  Nobody should build on top of this until it is diagnosed.
