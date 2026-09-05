# What is left

> **Resume here.** The plan format now carries commit subjects
> (`PERF_SCHEMA_VERSION` 3) and nine of eleven plans have been rebuilt. Linux
> and Chromium are still version 2, so a build made from the current source
> would refuse them. `dist/` is the *previous* build and is self-consistent, so
> `npm run preview` on http://localhost:4173 still works exactly as it did.
>
> To finish, in order — about twenty minutes:
> ```
> node --max-old-space-size=14336 scripts/build-performance.mjs torvalds/linux chromium/chromium --force
> npm run dev &                      # the indexer needs a server
> node scripts/index-artifacts.mjs --open-seconds 900
> npm run build && node scripts/prune-catalog.mjs --dir dist/catalog --apply
> node gt-smoke.mjs                  # 21 journey checks
> ```
> Then re-measure §4.1, which is the one claim in this file that is not yet
> backed by a number.

Written 2026-09-05. Everything here is either measured or a decision nobody has
made yet — there is no speculation in the priorities.

---

## 1. Yours, because I cannot do them

These are the only things standing between the repository and a live site.

| | Task | Why it has to be you |
| --- | --- | --- |
| 1.1 | **Push.** `origin/main` is on `434d257`; local is well ahead. | Nothing has been pushed all session. |
| 1.2 | **Settings → Pages → Source → GitHub Actions.** | One-time repository setting. |
| 1.3 | **Run `datasets.yml` once, manually, and let it finish.** | See §2 — the first deploy publishes an empty shelf without it. |
| 1.4 | **Create the GitHub OAuth App.** Callback → the deployed Worker's `/auth/callback`. | GitHub has no API for creating OAuth Apps. `POST /applications` is a 404. It is a form, by design. |
| 1.5 | **Deploy the Worker** (`cd worker && npx wrangler deploy`), then `wrangler secret put GITHUB_CLIENT_SECRET`. | Needs your Cloudflare account. The secret must never travel through a chat window. |
| 1.6 | **Set `VITE_AUTH_BASE`** to the Worker origin for the Pages build. | Until then the sign-in page says it is not configured, which is true. |
| 1.7 | **Rotate the GitHub PAT and the Render API key.** | Both were pasted into chat earlier in this project. |
| 1.8 | **Decide the author-name rewrite.** 25 commits are authored `altus <altuser91@gmail.com>` and render as **Akifuma-91**. | Far easier before the first push than after. |

---

## 2. The first deploy will publish an empty shelf unless 1.3 happens first

`deploy.yml` gets the catalog by downloading the `catalog` artifact from the
most recent successful `datasets.yml` run. There has never been one. That step
is deliberately best-effort — it prints a warning and carries on — so the deploy
will **succeed** and the Selection page will be **empty**.

`datasets.yml` is a long first run: it clones Chromium, Linux and LLVM from
scratch with no warm cache, and the clones are cached for later runs.

It is scheduled `17 4 * * 0` — **weekly, Sunday morning**. That is also the
answer to "does it update itself": the shelf refreshes once a week, and a
performance you watch is the repository as of the last successful run, not as
of now. Every artifact records its own `fetchedAt`.

---

## 3. Never run on CI

Everything in this project has been verified on one Windows machine. No
workflow has ever executed on a runner. Specifically unexercised:

- the `catalog` artifact hand-off — roughly **945 MB** uploaded by `datasets.yml`
  and downloaded by `deploy.yml`. I have no measurement of whether that is
  within Actions' practical limits.
- the prune step in `deploy.yml`.
- the 1 GB size guard.
- `index-artifacts.mjs` answering the scope chooser (fixed this session; the
  bug made it report "DID NOT OPEN" for every entry and, once, overwrite a good
  index with an empty one).

Expect the first CI run to find something. It found the ripgrep mismatch when I
finally looked: removed from the shelf, still in the build matrix, so CI would
have rebuilt it and put it back.

---

## 4. Performance, with numbers

Measured on Linux (332,279 nodes, 12 h) at 1440×900, per frame:

| | start | 1 h in | 2 h in |
| --- | --- | --- | --- |
| whole frame | 5.09 ms | 14.28 ms | 19.25 ms |
| label pass | 0.32 ms | 3.30 ms | **5.91 ms** |
| settled edges | 2.11 ms | 2.75 ms | 3.05 ms |
| active edges | 0.60 ms | 1.98 ms | 2.54 ms |

Two causes found and fixed this session — **both need re-measuring to confirm
the gain**, which is the top item below:

- the label pass walked each thread from its beginning every frame, stopping at
  the playhead, so its cost was a function of elapsed time and nothing else.
  Now a binary search.
- `visibleEdgeIndices` pushed all ~109,000 "long" edges into a candidate array
  every frame and then **sorted it**, to draw about thirteen. Now filtered by
  the same bounds test the draw loop applies a moment later.

### Still open

4.1 **Re-measure at 1 h / 2 h / 5 h and confirm.** Nothing below is worth doing
until this says where the time actually goes now. `node gt-late.mjs torvalds/linux`
with the profile hook (`window.__gittimeline.render`).

4.2 **Idle frames while paused.** The renderer redraws a paused stage.

4.3 **Sub-pixel node level-of-detail.** At Linux's zoom most nodes are under a
pixel and are still drawn individually.

4.4 **The settled-edge pass** — flat rather than growing, so lower priority, but
it is the largest fixed cost.

4.5 **`candidates.sort()` still runs every frame** in `visibleEdgeIndices`, on a
much smaller array now. Probably fine; measure before touching.

---

## 5. Correctness — verified, but worth knowing

Two timestamp defects were fixed this session and both were in Linux:

- five commits stamped 2030–2085 (broken clocks) dragged 1,475,072 dates forward;
- commit `a27ac38efd6d` has author date **2019-04-05** against committer date
  **2005-07-12** — one mistyped digit — which folded 2006–2018 into about two
  minutes of a twelve-hour show. Verified against GitHub, not inferred.

Linux now offers **22 years** in the scope chooser. It offered 2 before.

**Are the prefetched animations accurate?** Yes, and it is checked rather than
asserted. `build-performance.mjs` re-reads every plan it writes, recompiles from
the dataset and compares — Linux verifies **133,557,250 points identical** and
the `planHash` round-trips. The datasets come from `git clone --bare
--filter=tree:0`, so they are the real commit graph with zero GitHub API calls.
Where a history is partial, the coverage badge says so.

---

## 6. Documentation that has gone stale

6.1 `docs/architecture.md` still quotes pre-fix compile times and says "Linux
and Chromium never finished at all". Both compile now.

6.2 `README.md` has a benchmark table with a ripgrep row; ripgrep is off the shelf.

6.3 `scripts/build-catalog.mjs` still writes `poster`/`posterBytes`. Harmless —
the parser ignores them — but it produces an index with no `nodes` or `years`.

6.4 `HYDRATE_MAX_BYTES` (8 MB) was the reason the ledger was empty on large
histories. Subjects now ship inside the plan, so the dataset refetch is only
about parent lists and GitHub links. The threshold and its comment should be
revisited in that light.

---

## 7. Test suite

- 169 unit, 88 end-to-end across Chromium/Firefox/WebKit. All green.
- `tests/e2e/large.spec.ts` takes **7.3 minutes** — it opens Linux and counts
  what the renderer draws. It is in its own file because `trace: 'off'` is only
  allowed at file level, and the tracer screenshots the page, which never
  returns on a `desynchronized` canvas that size. Worth keeping; worth knowing
  it dominates CI time.
- `tests/unit/performance.test.ts` self-skips its real-artifact case when the
  artifacts are mid-rebuild. It flakes if you run the suite during a
  `build-performance --all`.
