# GitTimeline — where it stands, what is left, what could be next

Updated 2026-09-05. Every number here was measured, not estimated. 36 commits
ahead of `origin/main`; nothing has been pushed.

---

## 0. What exists and works

| | Status |
| --- | --- |
| **Shelf** | 12 pre-built histories: Linux, Chromium, LLVM, Rust, TensorFlow, VS Code, Kubernetes, CPython, Node, React, public-apis, mdBook |
| **Ingestion** | `git clone --bare --filter=tree:0` — real commit graphs, **zero** GitHub API calls. 4.9 M commits on the shelf |
| **Precompiled plans** | Every entry ships a `.gtperf.gz`; the browser plays it instead of compiling. Verified by recompiling and comparing — Linux matches 133,557,250 points |
| **Playback** | 60 fps locked, 2 min → 3 h, on a discrete GPU. 2 dropped frames in 1,188 |
| **Scope chooser** | Pick any year range; the runtime is priced before you start. Same download either way |
| **Commit ledger** | Real subjects, carried in the plan — works on histories whose dataset is never fetched |
| **Sign-in** | Cloudflare Worker, 2.02 KiB gzipped. Zero OAuth scopes. Inert until configured |
| **Analytics** | Implemented, inert without `VITE_GA_ID`. Honours Do Not Track; an allowlist means a pasted repo never reaches Google |
| **Fallbacks** | SVG poster mode when Canvas is unavailable; a text transcript of the choreography |
| **Video export** | `MediaRecorder` capture of the canvas — present, lightly exercised |
| **Tests** | 169 unit, 50 e2e chromium (+ Firefox/WebKit on two specs). Green |
| **Size** | `dist` 401 MB against a 1 GB Pages ceiling |

---

## 1. Blocked on you

Nothing else in this file blocks a deploy.

| | Task | Why you |
| --- | --- | --- |
| 1.1 | **Push.** 36 commits. | — |
| 1.2 | **Settings → Pages → Source → GitHub Actions.** | One-time setting |
| 1.3 | **Run `datasets.yml` once, manually.** | Without it the first deploy ships an **empty shelf** — see section 2 |
| 1.4 | **Create the OAuth App.** | No API exists; `POST /applications` is a 404. `docs/github-oauth-setup.md` has every field |
| 1.5 | **Deploy the Worker, then `wrangler secret put`.** | Your Cloudflare account; the secret must not pass through chat |
| 1.6 | **Set `VITE_AUTH_BASE`** as an Actions *variable*. | Read at build time |
| 1.7 | **Rotate the GitHub PAT and the Render key.** | Both were pasted into chat earlier |
| 1.8 | **Decide the author-name rewrite.** 25 commits show as **Akifuma-91**. | Much easier before the first push |
| 1.9 | *Optional:* set `VITE_GA_ID` to enable analytics. | — |

Order for 1.4 to 1.6: **Worker first.** The OAuth App needs a callback URL that
does not exist until the Worker is deployed.

---

## 2. The first deploy publishes an empty shelf unless 1.3 happens first

`deploy.yml` pulls the catalog from the `catalog` artifact of the last
successful `datasets.yml` run. There has never been one. That step is
best-effort by design, so the deploy **succeeds** and Selection is **empty**.

The first run is the slow one — it clones Chromium, Linux and LLVM cold.
Afterwards the clones are cached and it runs weekly (Sunday). That is also how
it stays current: what you watch is the repository as of the last successful
run, and every artifact records its own read time.

---

## 3. Engineering, in priority order

### 3.1 Never run on CI — highest risk
Everything was verified on one Windows machine. No workflow has ever executed on
a runner. Most exposed: the **~945 MB catalog artifact hand-off** between the two
workflows, which I have no measurement of. Expect the first run to find
something — it found the ripgrep mismatch the moment I looked.

### 3.2 Weak machines — the honest gap
With no usable GPU (software rasterisation) it is **19 to 26 fps**. At two
minutes in, with only twenty threads alive, it is already 39 ms a frame — so
that is the baseline cost of compositing the canvas, which detail reduction
cannot touch.

The lever is **dynamic resolution scaling**: render at 0.6 to 0.8x and upscale
when frames are being missed. Standard technique, moderate effort. Worth a
decision first — the picture becomes softer on weak machines, which is the
opposite of the "same repository looks the same everywhere" rule I used for the
detail thresholds.

### 3.3 Remaining render cost — comfort, not correctness
Neither grows with elapsed time:

- `glow`, 1 to 3 ms — a full-canvas `blur(6px)` every frame, applied at
  destination resolution even though the glow buffer is half-size. Blurring at
  buffer resolution instead would be four times cheaper.
- `settledEdges`, 1.5 to 2.5 ms — flat, and now the largest fixed cost.

### 3.4 CI time
`tests/e2e/large.spec.ts` takes 7.3 minutes — it opens Linux and counts what the
renderer draws. Worth keeping; worth knowing it dominates the suite.

### 3.5 Stale documentation
- `docs/architecture.md` quotes pre-fix compile times and says Linux and
  Chromium "never finished". Both compile now.
- `README.md` benchmark table still lists ripgrep, which is off the shelf.
- `scripts/build-catalog.mjs` writes `poster`/`posterBytes`; nothing reads them.
- `HYDRATE_MAX_BYTES` (8 MB) — subjects ship in the plan now, so the refetch is
  only parent lists and GitHub links. The threshold and its comment should be
  revisited.
- `codex-tasks.md` is an older list that contradicts this one.

---

## 4. Enhancements worth building

Roughly best value first. Effort is rough.

### 4.1 "Director's cut" — a 60-second version of any repository · medium
The plan already knows where the interesting moments are: `MAJOR_MERGE`,
`PARALLEL_PHRASE`, `ERA_TRANSITION`, `QUIET_GAP`. Pick the six best and cut
between them. Turns a twelve-hour Linux into something somebody will actually
watch, and makes the largest entries approachable instead of daunting. Needs no
new data — it is a playlist over a plan that already exists.

### 4.2 Deep-link to a moment, and a downloadable poster · small
The share hash already carries `repo`, `t`, `focus` and `seed`, and
`renderPosterSvg` already draws exact geometry as SVG. Wire "copy a link to this
moment" and "download this frame" into the UI. Cheap, and it is how a thing like
this spreads.

### 4.3 Incremental dataset updates · medium, large infra win
The weekly job re-reads every history in full. The clones are already cached, so
`git log <last-tip>..HEAD` would read only what is new and append to the
artifact. Turns the weekly run from an hour into minutes, and makes adding
entries cheap.

### 4.4 Follow a person through the history · small, half of it exists
`focusContributor` already dims everything else. Add a proper picker: search a
name, watch only their commits light up, and show a small card — first commit,
last commit, busiest year. The most personal thing this app could offer.

### 4.5 Compare two repositories side by side · large
Two stages, one clock, normalised to the same commits per second. "React against
Vue over the same decade" is a genuinely interesting picture and nothing else
shows it.

### 4.6 A WebGL renderer for the stage · large
The real answer to "hundreds of thousands of nodes on any machine". Sparks
become one instanced draw call instead of about thirty-five canvas operations
each; edges become a vertex buffer. Would make 3.2 moot rather than mitigated.
Big rewrite — keep Canvas2D as the fallback, which already exists.

### 4.7 OffscreenCanvas in a worker · medium
Move rendering off the main thread so the UI never stutters during a heavy frame
and a slow frame cannot block input. Complements 4.6, and simpler on its own.

### 4.8 Click a commit, open it on GitHub · small
`githubUrl` lives in the dataset, which is not fetched for large entries — so
the one thing a viewer most wants to click is missing exactly where the history
is most interesting. Same fix as the commit subjects: carry it in the plan. A
few megabytes on Linux.

### 4.9 Embeddable widget · medium
An iframe mode with no chrome that autoplays a chosen span, so a project can
drop its own history into its README or docs site.

### 4.10 Beyond GitHub · medium
The ingestion is `git clone` — it does not actually need GitHub. GitLab,
Codeberg, or any URL `git clone` accepts would work with a different link
builder. The catalog is already provider-tagged.

---

## 5. Reference

### When a rebuild is needed
A plan is compiled ahead of time. Anything touching the **compiler** invalidates
every plan, about thirty minutes for the shelf. Anything touching only the
**renderer** is instant.

| | Rebuild? |
| --- | --- |
| Timestamps, lane layout, camera, plan format, event detection | **Yes** |
| Spark and edge detail, culling, clipping, the scrubber, any UI | **No** |

### Fixed this session, with numbers
- **Linux drew nothing at all.** The camera's spring integrator diverged once
  the keyframe grid stretched for long performances — Rust went non-finite 3.2
  seconds in. Sub-stepped now.
- **Nested lanes were unbounded.** CPython reached lane 2,304; 62% of its edges
  were being drawn outside the visible band forever.
- **Two timestamp defects.** Five broken clocks dragged 1,475,072 dates forward.
  Then one mistyped digit — `a27ac38efd6d`, authored 2019-04-05, committed
  2005-07-12 — folded 2006 to 2018 into about two minutes. Linux offers **22
  years** now; it offered 2.
- **The ledger had no words in it** on any large history. Subjects ship in the
  plan.
- **Frame cost stopped growing with elapsed time.** Peak 22.56 to 8.57 ms; the
  scrubber went from 2.4 million `fill()` calls per four seconds to 5,880.
- **60 fps locked**, 2 minutes to 3 hours; dropped frames 337 of 1558 to 2 of
  1188.
- **"Up to 108,690 threads moving at once"** was the union of every thread in a
  single broken twelve-hour event. True peak **458**, mean 244.
- A measurement correction: headless Chromium rasterises on the **CPU**. Every
  frame-pacing number reported before that was found describes the harness, not
  the app.

### Answers to questions asked more than once
**Accurate?** Yes, and checked rather than asserted: `build-performance.mjs`
recompiles every plan it writes and compares. Real commit graphs, no API calls.

**Self-updating?** Weekly, Sunday.

**Analytics?** Implemented, inert without `VITE_GA_ID`, allowlisted so a pasted
repository never reaches Google.

**Threads alive at once?** 458 at Linux's peak, 244 mean. The renderer draws
only the subset on screen, around 350.
