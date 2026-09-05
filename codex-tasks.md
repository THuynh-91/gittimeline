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

## ~~1. GitHub Action that builds the preloaded catalog~~ — DONE

`.github/workflows/datasets.yml` was rewritten and `deploy.yml` was changed to
publish what it produces. The draft was never run and had six things wrong with
it, each of which would have cost a run:

- **The cached clone was never brought up to date.** `build-clone-dataset.mjs`
  reuses a bare repository it finds and does not fetch into it, and the draft
  had no fetch step despite a comment promising one — so every week after the
  first would have rebuilt the same history. Worse, the obvious fix does not
  work: `git clone --bare` sets `remote.origin.url` but no
  `remote.origin.fetch`, so a plain `git fetch origin` in one of these updates
  nothing at all. Verified against React by rewinding `main` 200 commits: the
  plain fetch left it rewound; `fetch --filter=tree:0 --prune
  '+refs/heads/*:refs/heads/*'` brought it back in one second.
- **The cache key contained `github.run_id`**, so it named a run that had not
  happened and could only ever miss. It now restores by prefix and saves under
  the tip it ended at, which also means a week with no new commits writes no
  new entry — twelve clones are about 2.5 GB against a 10 GB per-repository cap.
- **The plan step was missing entirely.** `build-performance.mjs` did not exist
  when the draft was written, so the catalog would have shipped histories with
  no `.gtperf.gz` beside them and every visitor would have paid the compile:
  142 s for Kubernetes, 639 s for Rust, never for Linux.
- **The artifacts did not carry the plans.** The upload listed only
  `*.gittimeline.gz` and `*.meta.json`.
- **`npx wait-on`** is not a dependency of this project and would have been
  fetched from the registry on every run; it is a `curl` poll now.
- **`git log`'s raw output lands in the work directory** — 4.7 MB for React,
  about half a gigabyte for Chromium — and the draft cached it. It is deleted
  before the save now.

Also: the matrix was missing `BurntSushi/ripgrep` and `rust-lang/mdBook`, both
of which are in `SHIPPED`, so both would have been reported "not built yet"
every week; `--max-old-space-size` is now per repository (4096 to 12288, the
last being about the ceiling on a 16 GB runner) rather than one number for all;
and the per-repository timeouts run from 20 minutes to 350 rather than a flat
90, which Chromium would not have finished inside.

`deploy.yml` no longer drives `build-catalog.mjs` through a browser with an
Actions token. It takes the catalog artifact from the last successful
`datasets.yml` run instead, best effort, so a deploy without one is quiet rather
than broken. The two used to write the same `index.json` from different shelves.

**Proven locally, end to end, for `facebook/react`** with the same commands and
flags the workflow uses: cloned in 8 s (19 MB bare), 21,678 commits read in
1.4 s, normalized to 2.6 MB gzipped; the plan compiled in 1.3 s to 1.8 MB and
round-tripped identically; `vite build`, `vite preview` and
`index-artifacts.mjs` then wrote an `index.json` with a real thumbnail, and the
browser reported the entry opening **from a shipped plan in 0.4 s**. All three
workflows pass `actionlint` with `shellcheck` over every `run:` block.

**One thing needs a decision, and it is not a CI problem.** A full shelf is
982 MB and `dist` measures **1,014 MB**. GitHub Pages will not publish a site
over 1 GB. Chromium and Linux are 610 MB of that between their histories and
their plans. `deploy.yml` now measures `dist`, prints the breakdown, warns past
900 MB and refuses past a gibibyte — but something has to come off the shelf, or
the catalog has to live somewhere other than Pages.

<details>
<summary>Original task</summary>

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

</details>

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

## ~~4. Port the auth service off Render to a serverless function~~ — DONE

Built in `worker/` as a Cloudflare Worker: `wrangler.toml`, `src/index.mjs`
(5.26 KiB, 2.02 KiB gzipped), and a `README.md` written for someone who has
never used Wrangler. The flow was ported as-is — same routes, `HttpOnly` state
cookie, origin allowlist, token in the fragment, no scopes — with the one
substitution the platform forces: Workers have no `node:crypto`, so
`timingSafeEqual` is replaced by a hand-written compare that never
short-circuits.

Proven under `wrangler dev` in the real workerd runtime against a stubbed
GitHub token endpoint: 21 checks, including a forged state and a return URL off
the allowlist both rejected before the code ever reaches GitHub, and a valid
round trip putting the token in the fragment. Plus 24 unit tests over
`handleRequest` — `npx vitest run --config worker/vitest.config.mjs`. Not
deployed; that needs your Cloudflare account and an OAuth App, which GitHub has
no API for creating. `worker/README.md` has the steps.

`src/app/auth.ts` needs no change to work with it beyond `VITE_AUTH_BASE`, so
it was left alone. `server/` is still in place, with a note at the top of its
README pointing here; delete it once a real sign-in through the Worker has
completed.

<details>
<summary>Original task</summary>

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

</details>

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
