# What is left

Updated 2026-09-05, late. Everything here is either measured or a decision
nobody has made yet.

---

## 1. Blocked on you

The only things between this repository and a live site. Nothing else in this
file blocks a deploy.

| | Task | Why it has to be you |
| --- | --- | --- |
| 1.1 | **Push.** `origin/main` is far behind. | Nothing has been pushed all session. |
| 1.2 | **Settings → Pages → Source → GitHub Actions.** | One-time repository setting. |
| 1.3 | **Run `datasets.yml` manually, once, and let it finish.** | Without it the first deploy publishes an **empty shelf** — see §2. |
| 1.4 | **Create the GitHub OAuth App.** | GitHub has no API for it; `POST /applications` is a 404. It is a form. Walkthrough: `docs/github-oauth-setup.md`. |
| 1.5 | **Deploy the Worker**, then `wrangler secret put` the client id and secret. | Needs your Cloudflare account, and the secret must not travel through a chat window. |
| 1.6 | **Set `VITE_AUTH_BASE`** to the Worker origin, as an Actions *variable*. | Read at build time, so it must exist where the build runs. |
| 1.7 | **Rotate the GitHub PAT and the Render API key.** | Both were pasted into chat earlier in this project. |
| 1.8 | **Decide the author-name rewrite.** 25 commits render as **Akifuma-91**. | Far easier before the first push than after. |
| 1.9 | *Optional:* set `VITE_GA_ID` to switch analytics on. | Implemented and inert without it — see §6. |

**Order matters for 1.4–1.6:** Worker first. The OAuth App needs a callback URL,
and that URL is the Worker's.

---

## 2. The first deploy publishes an empty shelf unless 1.3 happens first

`deploy.yml` takes the catalog from the `catalog` artifact of the most recent
successful `datasets.yml` run. There has never been one. That step is
best-effort by design — it warns and carries on — so the deploy **succeeds** and
the Selection page is **empty**.

The first `datasets.yml` run is the slow one: it clones Chromium, Linux and LLVM
with no warm cache. Afterwards the clones are cached and it runs weekly,
`17 4 * * 0`. That is also the answer to "does it update itself": the shelf
refreshes weekly and what you watch is the repository as of the last successful
run. Every artifact records its own `fetchedAt`.

---

## 3. Mine — and the top one is a claim I have not yet earned

**3.1 — Prove it is smooth, not merely under the line.** *The open item.*

Every number so far is a **mean over 1.4 s of playback**, and a mean of 12 ms can
hide a frame at 40. Smoothness is the tail, not the average. `gt-frames.mjs`
records every frame's render cost and every frame's wall-clock interval and
reports p50/p90/p99/max plus frames the viewer never got. It is written and has
**not been run** — the machine has been rebuilding plans all evening and a
contended measurement is worse than none.

Run it densely from two minutes to three hours and report the tail. Until then
the honest claim is "no sampled point exceeded 16.7 ms", which is weaker than
"smooth throughout".

**3.2 — Remaining render cost, if more headroom is wanted.** Neither grows with
elapsed time, so this is comfort rather than correctness:

- `activeEdges` ~4.6 ms at peak — two `setLineDash` calls and a composite-state
  change per edge; grouping the dashed approach paths would set the dash once
  instead of ~780 times a frame.
- `glow` ~2.9 ms.

**3.3 — CI cost.** `tests/e2e/large.spec.ts` takes 7.3 minutes: it opens Linux
and counts what the renderer draws. Worth keeping; worth knowing it dominates.

**3.4 — Stale documentation.**

- `docs/architecture.md` quotes pre-fix compile times and says Linux and
  Chromium "never finished at all". Both compile now.
- `README.md` has a benchmark table with a ripgrep row; ripgrep is off the shelf.
- `scripts/build-catalog.mjs` still writes `poster`/`posterBytes`, which nothing
  reads.
- `HYDRATE_MAX_BYTES` (8 MB) was why the ledger was empty on large histories.
  Subjects ship in the plan now, so the refetch is only about parent lists and
  GitHub links. The threshold and its comment should be revisited.
- `codex-tasks.md` is an older task list that now contradicts this one.

---

## 4. Why the rebuilds, and when they are needed

A plan is compiled ahead of time, so anything that changes the **compiler**
changes the artifact and the whole shelf has to be recompiled — about thirty
minutes. Anything that changes only the **renderer** is instant.

| | Rebuild? |
| --- | --- |
| Timestamps, lane layout, camera, plan format, event detection | **Yes** |
| Spark detail, caption culling, polyline clipping, the scrubber, any UI | **No** |

Today was rebuild-heavy because the bugs were in the compiler. The optimisation
work needed none.

---

## 5. Fixed today, with the numbers

- **Linux was drawing nothing at all.** The camera's spring integrator diverged
  once the keyframe grid stretched for long performances; Rust went non-finite
  3.2 s in. Sub-stepped now.
- **Nested lanes were unbounded** — CPython reached lane 2,304, and 62% of its
  edges were being drawn outside the visible band forever.
- **Two timestamp defects.** Five broken clocks dragged 1,475,072 dates forward;
  and one mistyped digit in `a27ac38efd6d` (authored 2019-04-05, committed
  2005-07-12) folded 2006–2018 into about two minutes. Linux offers **22 years**
  now; it offered 2.
- **The ledger had no words in it** on any large history. Subjects ship in the
  plan.
- **Frame cost stopped growing with elapsed time.** Peak on Linux **22.56 ms →
  8.57 ms**; the scrubber went from 2.4 million `fill()` calls per four seconds
  to 5,880.
- **"Up to 108,690 threads moving at once"** was the union of every thread in one
  broken twelve-hour phrase event. True peak is **458**, mean 244.
- **public-apis added**; the shelf is 12 entries.

---

## 6. Answers to things asked more than once

**Are the prefetched animations accurate?** Yes, and checked rather than
asserted: `build-performance.mjs` recompiles every plan it writes and compares —
Linux verifies 133,557,250 points identical. Datasets come from
`git clone --bare --filter=tree:0`, so it is the real commit graph with zero
GitHub API calls.

**Does it update itself?** Weekly, Sunday. See §2.

**Is Google Analytics implemented?** Yes, `src/app/analytics.ts`, inert until
`VITE_GA_ID` is set. It defines no `gtag`/`dataLayer` globals, honours Do Not
Track, validates the measurement id, and runs an allowlist so only catalog slugs
are ever sent — a repository a visitor pastes never reaches Google.
`tests/e2e/analytics.spec.ts` asserts that.

**How many threads are alive at once?** 458 at Linux's busiest instant, 244 mean.
The renderer draws only the subset on screen, which peaks around 350.
