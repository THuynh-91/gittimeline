# GitTimeline — state, work, and direction

Updated 2026-09-05. Every number was measured, not estimated.

Implementation direction: [Fast static playback and a new viewing experience](docs/static-playback-plan.md).
That plan preserves the existing architecture and sequences progressive catalog
loading, playback optimisation, UI/demo redesign, and Pages release validation.
Its proposed acceptance budgets are targets, not completed measurements; no runtime
changes are implied by the plan.

Sections 4–7 are **briefs, not specifications**. They state the problem, the
constraint and how you would know it was solved, and deliberately stop short of
saying how. Where a number is given it is evidence, not a target to hard-code.

---

## 0. What exists and works

| | Status |
| --- | --- |
| **Shelf** | 12 histories: Linux, Chromium, LLVM, Rust, TensorFlow, VS Code, Kubernetes, CPython, Node, React, public-apis, mdBook |
| **Ingestion** | `git clone --bare --filter=tree:0`. Real commit graphs, **zero** GitHub API calls, 4.9 M commits |
| **Plans** | Precompiled `.gtperf.gz`; verified by recompiling and comparing — Linux matches 133,557,250 points |
| **Playback** | 60 fps locked, 2 min → 3 h, on a discrete GPU. 2 dropped frames in 1,188 |
| **Honesty** | Nothing is drawn before it happens; coverage badge states what was loaded |
| **Scope chooser** | Any year range, priced before you start, same download |
| **Ledger** | Real commit subjects, carried in the plan |
| **Sign-in** | Cloudflare Worker, 2 KiB gzipped, zero OAuth scopes, inert until configured |
| **Analytics** | Implemented, inert without `VITE_GA_ID`, allowlisted so a pasted repo never reaches Google |
| **Fallbacks** | SVG poster mode, text transcript, `MediaRecorder` capture |
| **Tests** | 169 unit, 50 e2e chromium (+ Firefox/WebKit on two specs). Green |
| **Size** | `dist` 401 MB against a 1 GB Pages ceiling |

---

## 0.5 The plan from here — no deadline, refine then deploy

Nothing is shipping today. The order below exists because of one fact:

> **Only changes to the *compiled plan* cost a rebuild.** Layout, spacing,
> pacing and density force a fresh ~3 h catalog build. Drawing and UI changes
> cost nothing. So finish every plan-affecting change, fire **one** rebuild,
> and do the drawing work while it runs.

### A. Before the rebuild — plan-affecting

**A1. Chromium, LLVM and Node are duds, and two of them are the headline
entries. — open, highest value**

| repo | commits | drawn as arrivals | runtime |
| --- | ---: | ---: | ---: |
| chromium/chromium | 1,817,062 | **923** (0.05%) | 3 min |
| llvm/llvm-project | 595,778 | **894** (0.15%) | 3 min |
| nodejs/node | 48,272 | **1,013** (2.1%) | 2 min |
| torvalds/linux | 1,481,850 | 332,279 (22%) | 12 h |
| kubernetes/kubernetes | 140,858 | 125,973 (89%) | 273 min |

Linux shows 22% of itself over twelve hours; Chromium is a *larger* repository
and shows 0.05% over three. That is not aggregation scaling smoothly — three
histories are collapsing almost entirely and the others are not. A visitor
clicking "nearly two million commits" gets three minutes of ribbons.

Find out why before rebuilding. Suspect the aggregate pass and the merge-ratio
input to it: `mergeRatio` decides how much can be gathered without hiding
topology, and a linear history collapses where a pull-request one does not.

**A2. Lane spacing — investigated, nothing to fix here, and the reason is
worth keeping.**

The theory was that lanes counted from zero put a branch at `side * bulge` —
twelve pixels off the spine at most — and so drew it along the main line.
**That does not happen.** `lane` starts at `minLane`, and `minLane` is 1 for a
branch off the spine and higher for a branch off a branch; lane 0 is never
assigned to anything but the spine itself. The change was made, measured, and
reverted, along with its `layoutVersion` bump.

What is actually within a few pixels of the main line, counted by edge kind:

| | |
| ---: | --- |
| 3 | divergence, at its **start** |
| 2 | divergence, in the middle |
| 1 | merge, in the middle |
| 1 | merge, at its **end** |

All correct. A branch has to touch the main line where it forks off it and
where it rejoins it; that is what those two events are.

**The real cause of lines looking crowded is the camera, not the layout — and
that is good news, because it costs no rebuild.** Lanes are 54 world units
apart, but the camera fits the bounding box of the work, so the more lanes are
open the further it pulls back and the fewer screen pixels those 54 units
become. Note the corollary: **raising `LANE_GAP` cannot help.** A wider gap
makes a proportionally taller box, the fit scale shrinks by the same factor,
and the picture is pixel-for-pixel identical. Any real improvement has to come
from the camera framing fewer lanes, or from C1.

### B. Independent of the rebuild — deploy configuration

**B1. The shelf does not fit. — open, blocking the deploy**
The finished catalog artifact is **1,742 MB** against a **1 GB** Pages ceiling.

| | MB |
| --- | ---: |
| torvalds/linux | 662 |
| chromium/chromium | 311 |
| rust-lang/rust | 302 |
| kubernetes/kubernetes | 142 |
| llvm/llvm-project | 106 |
| tensorflow, vscode, cpython, node, react, public-apis, mdBook | 213 |

Page packaging roughly doubled the large entries, which is what bought the
freeze fix. Recommended lever: an entry that ships a `.pages` package plays
from it, so its monolithic `.gtperf.gz` is only a fallback — drop that for
packaged entries and recover ~350 MB. The cost is real and should be written
down: a package that fails its hash check then has nothing to fall back to and
that entry will not open.

Alternatives, both worse: do not package Linux and Chromium (keeps the
fallbacks, keeps their 21–27 s and 9 s freezes), or stop publishing the raw
datasets for the biggest repos (the ledger loses real commit subjects there).

### C. While the rebuild runs — renderer and UI only

**C1. The stage is nearly empty. — open, biggest single visual gain**
Measured ink coverage of the canvas: **0.61–1.61%** on desktop, **0.3%** on a
phone, where the graph is a 500×70 sliver in a 1170×1560 stage. The camera
never fills the frame. Everything else on this list is polish on a picture that
is mostly black.

**C2. Delete `src/app/experience.css`.** 86 lines of an abandoned green
redesign. Its `:root` override loses to `styles.css` in both dev and build, so
it is smaller than it looks — but it still forces Georgia onto catalog titles
and `#293c35` green hairlines onto a `#07080c` blue-black stage, and 17 of its
19 class families match nothing.

**C3. Accessibility, from the audit.** The scope chooser traps no focus (19
tabbable elements remain behind it); cancel and "Not this one" dump focus to
`<body>`; a 12 h performance reads as `720:00` because `fmtClock` has no hours
branch; screen readers are read the raw phase enum `FETCHING_TOPOLOGY`.

**C4. Design system.** 24 distinct font sizes (thirteen of them inside a 6px
range), 13 border radii, 9 spellings of near-white, `--radius` declared and
never used. One scale each.

**C5. The nav overflow reported on 2026-09-06** — "Connect GitHub" running off
the right. Not reproduced at any width from 390 to 1920 on either server;
`scrollWidth` never exceeds the viewport. Needs the reporter's window width or
browser zoom before it can be chased.

### D. After the deploy

**D1. Private repositories.** Designed in full, blocked on registering a GitHub
App and deploying the Worker. The two privacy holes that had to close first —
response bodies to IndexedDB, and the repo slug appearing as a landing-page
suggestion chip — are closed, with tests.

---

## 0.6 The main line and the threads around it

Two complaints have repeatedly been reported as one. They are not.

### Threads drawn *on* the main line — not a defect either

See A2. The lane-0 theory was wrong, and what touches the main line is
divergences starting and merges ending, which is what those edges are for.
Crowding is the camera's zoom, and `LANE_GAP` is a dead end because the fit
scales with it.

### Threads drawn *past* the main line — not a defect, and not fixable

`layoutGraph` sets `x = impact * xScale`. Horizontal position **is** the clock.
So a line further right is a commit that happened later, and main advances only
when a pull request merges — between merges every open branch keeps committing.
On Kubernetes, with 284 branches open at once, main is temporally behind
something essentially always.

This was attempted and reverted. Framing the camera on the newest commit on any
thread, rather than on main:

| | bodies in frame | furthest body vs the right border |
| --- | ---: | ---: |
| main held at 60–70% (current) | **87–94%** | 571–602px clear |
| newest commit held near the right | **0%** | 2,591–3,560px clear |

Long-lived branches have bodies spread across months of x, so chasing the front
drags the camera to the extreme right of the work and empties the screen. The
current framing already lets nothing escape the right border — 0 of 30 frames
at the reported timestamp.

What would genuinely help is not framing but **emphasis**: main is ivory
against coloured branches, which reads at five threads and disappears at fifty.
Thickening the main stroke and dimming distant branches is the open proposal.
It changes what every repository looks like, so it is not being done unasked.

Worth knowing: no common Git tool shows this, because gitk, `git log --graph`,
GitKraken and GitHub's network graph all lay out by **topological order**, where
main is the trunk by construction and cannot trail. A time axis is the honest
choice and this is its one uncomfortable consequence.

---

## 1. Blocked on you

| | Task | Why you |
| --- | --- | --- |
| 1.1 | **Push.** 38 commits. | — |
| 1.2 | **Settings → Pages → Source → GitHub Actions.** | One-time |
| 1.3 | **Run `datasets.yml` once, manually.** | Otherwise the first deploy ships an **empty shelf** — section 2 |
| 1.4 | **Create the OAuth App.** | No API exists. `docs/github-oauth-setup.md` has every field |
| 1.5 | **Deploy the Worker, then `wrangler secret put`.** | Your Cloudflare account; the secret must not pass through chat |
| 1.6 | **Set `VITE_AUTH_BASE`** as an Actions *variable*. | Read at build time |
| 1.7 | **Rotate the GitHub PAT and the Render API key.** | Both were pasted into chat during this project and should be treated as burned |
| 1.8 | **Decide the author-name rewrite** — 25 commits render as Akifuma-91. | Far easier before the first push than after |
| 1.9 | *Optional:* `VITE_GA_ID`. | — |

Worker before OAuth App: the App needs a callback URL that does not exist yet.

---

## 2. The first deploy publishes an empty shelf unless 1.3 happens first

`deploy.yml` pulls the catalog from the last successful `datasets.yml` run.
There has never been one, and the step is best-effort — so the deploy
**succeeds** and Selection is **empty**. The first run is slow (cold clones of
Chromium, Linux, LLVM); afterwards it is cached and runs weekly.

---

## 3. Known defects

### 3.1 The camera frames behind the front of the work — **open**
On Linux, four of five sampled moments have drawn content **clipped at the right
edge of the screen**. Nothing false is being drawn — no node renders before its
impact, and every edge is bounded by its own progress — but landed threads run
off the frame because the camera is centred behind them.

It reads as "the lines are ahead of the camera", which is nearly as damaging as
actually drawing the future: a viewer cannot tell the difference between "you
are seeing ahead" and "the camera is behind".

Constraint: the frame is capped (`MAX_FRAME_W`/`MAX_FRAME_H`) for a good reason —
without it, a dense era frames years at once and the performance becomes an
invisible thread. So this is not "pull back further". It is a question about
where the frame should sit within what it cannot fully contain.

Solved when: at any sampled moment, the newest arrival is inside the frame, and
the amount of landed-but-unframed material to the right is small and stable.

### 3.2 Never run on CI — highest risk
Everything was verified on one machine. Most exposed: the ~945 MB `catalog`
artifact hand-off between the two workflows, unmeasured.

### 3.3 Weak machines
With no usable GPU, 19–26 fps. At two minutes in with twenty threads alive it is
already 39 ms a frame, so that is baseline canvas compositing, not detail. See
5.4.

### 3.4 Smaller
- `glow` runs a full-canvas `blur(6px)` per frame at *destination* resolution,
  although the glow buffer is half-size. Blurring at buffer size would be ~4×
  cheaper.
- `tests/e2e/large.spec.ts` takes 7.3 min and dominates CI.
- Stale docs: `docs/architecture.md` (pre-fix compile times, claims Linux never
  finished), `README.md` (benchmark table lists ripgrep, which is off the
  shelf), `scripts/build-catalog.mjs` (writes `poster`/`posterBytes` nothing
  reads), `HYDRATE_MAX_BYTES` comment (subjects ship in the plan now),
  `codex-tasks.md` (an older list that contradicts this one).

---

## 4. Brief: the demo feels slow — **it is**

Measured on the built-in demo: **57.6 s, 56 commits, 0.97 arrivals per second**.
Every history on the shelf runs at **7.7**. And for its first eight seconds
there is exactly **one** moving thing on screen:

```
0s:0  2s:1  4s:1  6s:1  8s:1  10s:3  12s:3  14s:3  16s:3  18s:4  ...
```

So the first thing anyone sees is the slowest thing this app ever does, at an
eighth the density of the real product, and the landing page is playing it
behind the form as the argument for staying.

**What it has to do:** convince someone in the first two or three seconds that
something worth watching is happening, and be representative — a visitor who
likes the demo and then opens Linux should not find a different app.

**Constraints:** it is a *generated* history and must stay honest about that
(the landing page already says so). It must remain deterministic — it is a test
fixture as well as a shop window, and several suites assert against its shape.
It must stay tiny; it ships in the bundle and must render before anything is
fetched.

**Deliberately open:** whether the fix is density, pacing, a different scripted
shape, starting *in medias res* rather than from an empty stage, or a different
fixture for the landing page than for the tests. Multiple of those may be right.

**Solved when:** something is moving within a second of the page appearing, the
arrival rate is within sight of the shelf's, and the fixture-based tests still
pass or have been deliberately re-baselined.

---

## 5. Brief: optimisation without sacrificing quality

The principle that has held so far, and is worth keeping: **remove work, not
fidelity — and when fidelity has to go, spend it where it cannot be seen.**

Everything gained today came from the first half. In order of preference:

1. **Do not iterate what you can find.** Aggregate captions went from 71,571
   loop iterations a frame to 6,519 by indexing ribbons by world x. Same 26
   captions drawn.
2. **Do not draw what is off screen.** Clipping polylines to the view made a
   thread's cost depend on what is visible rather than on how long it had been
   alive.
3. **Do not compute what elapsed time made expensive.** Four label passes walked
   from the beginning of the performance every frame; binary search fixed all
   four.
4. **Then, and only then, reduce detail — by density, not by clock.** Sparks and
   edges thin out when the stage is crowded, where the detail is not legible
   anyway. Thresholds are in *objects*, not milliseconds, so the same repository
   looks the same on a fast machine and a slow one.

### 5.4 The one place that rule may have to bend
A machine with no GPU is fill-rate bound before any detail is drawn, so nothing
above helps. **Dynamic resolution** — render at 0.6–0.8× and upscale — is the
standard answer, and it does break rule 4: the picture is softer on weaker
hardware.

That is a product decision, not a technical one. If taken, it should be visible
and reversible rather than silent.

### 5.5 Remaining headroom, unprescribed
Known costs that do **not** grow with elapsed time: the glow blur (3.4), the
settled-edge pass, per-edge canvas state changes. Bigger swings — a WebGL stage
with instanced sparks, or moving rendering to a worker via `OffscreenCanvas` —
would change the ceiling rather than the constant, and would make 5.4 moot.
Neither is scoped here on purpose.

---

## 6. Brief: a tremendous UI upgrade

The stage is good. The *frame around it* has grown by accretion — one control at
a time, each defensible, never designed together.

**The standard to hold it to:** a stranger who lands on this page should be able
to say what they are looking at within about ten seconds, without opening help,
and should be able to find their way back to any state they have been in.

**Where the seams are, without saying how to fix them:**

- **First run.** The landing page has a paste field, a demo behind it, and a
  shelf one click away. Which of those is the offer is not obvious.
- **The transport.** Play, scrub, speed, camera mode, follow, sound, labels,
  panels — these accumulated. They are not grouped by how often they are used or
  by what they affect.
- **The ledger.** It is a list of commit subjects beside a picture, and the
  relationship between a row and a mark on the stage is not drawn.
- **Panels.** Settings, help and the inspector share a drawer and three
  different information densities.
- **Reading the stage.** The vocabulary — ivory spine, slate threads, rings,
  ribbons, dashed grey — is explained in help and nowhere else. A legend that
  earns its space is an open question.
- **Type and colour.** One accent, one ivory, and a lot of greys chosen
  individually. There is no scale.
- **Motion.** Panels appear, toasts arrive, the camera moves — three different
  easings and durations.
- **Mobile.** It works, in the sense that nothing overflows.

**Constraints:** the stage may not be crowded — chrome that competes with the
picture has failed. Nothing may claim more certainty than the data has. Poster
mode and the transcript are the accessible path and must keep working.

**Deliberately open:** everything about how. A redesign that deletes controls is
as valid as one that arranges them better.

---

## 7. Brief: a better discography

Three tracks, one artist, one source: Kevin MacLeod via incompetech, CC-BY 4.0,
about 32 MB total. `characterOf`/`registerFor` in `src/audio/score.ts` choose
between them by the shape of the repository — a project that merges constantly
gets the frantic one, a long quiet one something unhurried.

**What is thin about it:** three tracks across every repository ever written is
a narrow palette, and one of them will be wrong for something. Twelve hours of
Linux is a lot of one loop. The selection is made once at load and never
revisited, although the *history* changes character — an early quiet era and a
late frantic one get the same music.

**Worth considering, none of it decided:** more registers; a second source or
artist so the whole shelf does not sound like one album; music that follows the
performance's own eras rather than being chosen once; crossfades at era
boundaries; and a credits surface that does the licence justice — attribution is
currently one line in a help panel.

**Constraints:** everything must stay licence-clean and attributed. The bundle
must not balloon — audio is already the largest non-catalog asset. Sound must
remain off on the landing page and during idle, which was asked for explicitly
and is now asserted in tests.

**Solved when:** a visitor watching three different repositories does not hear
the same thing three times, and the attribution is somewhere a person would
actually find it.

---

## 8. Enhancements

Not defects and not briefs — things that would make this better rather than
correct. Roughly best value first; effort is rough.

**8.1 "Director's cut" — a 60-second version of any repository · medium.**
The plan already knows where the interesting moments are: `MAJOR_MERGE`,
`PARALLEL_PHRASE`, `ERA_TRANSITION`, `QUIET_GAP`. Pick the best half-dozen and
cut between them. Turns twelve hours of Linux into something a person will
actually watch, and needs no new data — it is a playlist over a plan that
already exists. Also the obvious answer to "the shelf's best entries are too
long to try".

**8.2 Deep-link to a moment, and a downloadable poster · small.**
The share hash already carries `repo`, `t`, `focus` and `seed`, and
`renderPosterSvg` already draws exact geometry as SVG. Both exist and neither is
reachable from the UI. Wire "copy a link to this moment" and "save this frame".

**8.3 Incremental dataset updates · medium, large infra win.**
The weekly job re-reads every history in full. The clones are already cached, so
`git log <last-tip>..HEAD` would read only what is new. Turns the Sunday run
from an hour into minutes and makes adding entries cheap.

**8.4 Follow a person through the history · small, half of it exists.**
`focusContributor` already dims everything else. Add a picker: search a name,
watch only their commits light up, and show first commit, last commit, busiest
year. The most personal thing this app could offer.

**8.5 Click a commit, open it on GitHub · small.**
`githubUrl` lives in the dataset, which is never fetched for large entries — so
the thing a viewer most wants to click is missing exactly where the history is
most interesting. Same fix as commit subjects: carry it in the plan.

**8.6 Compare two repositories side by side · large.**
Two stages, one clock, normalised to the same commits per second. "React against
Vue over the same decade" is a picture nothing else shows.

**8.7 A WebGL stage · large.**
The real answer to "hundreds of thousands of nodes on any machine". Sparks
become one instanced draw call instead of ~35 canvas operations each. Would make
3.3 and 5.4 moot rather than mitigated. Keep Canvas2D as the fallback, which
already exists.

**8.8 OffscreenCanvas in a worker · medium.**
Rendering off the main thread, so a heavy frame cannot block input. Complements
8.7 and is simpler alone.

**8.9 Embeddable widget · medium.**
An iframe mode with no chrome that autoplays a chosen span, so a project can put
its own history in its README.

**8.10 Beyond GitHub · medium.**
Ingestion is `git clone` — it never needed GitHub. GitLab, Codeberg, or any URL
`git clone` accepts would work with a different link builder. The catalog is
already provider-tagged.

---

## 8. Reference

### When a rebuild is needed
Anything touching the **compiler** invalidates every plan (~30 min for the
shelf). Anything touching only the **renderer** is instant.

| | Rebuild? |
| --- | --- |
| Timestamps, lane layout, camera, plan format, event detection | **Yes** |
| Spark/edge detail, culling, clipping, scrubber, any UI | **No** |

### Fixed this session
- **Linux drew nothing at all** — the camera's spring integrator diverged once
  the keyframe grid stretched; Rust went non-finite 3.2 s in.
- **Nested lanes were unbounded** — CPython reached lane 2,304; 62% of its edges
  were drawn outside the visible band forever.
- **Two timestamp defects** — five broken clocks dragged 1,475,072 dates
  forward; then one mistyped digit (`a27ac38efd6d`, authored 2019-04-05,
  committed 2005-07-12) folded 2006–2018 into two minutes. Linux offers **22
  years** now; it offered 2.
- **The ledger had no words** on large histories. Subjects ship in the plan.
- **Frame cost stopped growing with elapsed time** — peak 22.56 → 8.57 ms; the
  scrubber went from 2.4 M `fill()` calls per four seconds to 5,880.
- **60 fps locked**, 2 min → 3 h; dropped frames 337/1558 → 2/1188.
- **"Up to 108,690 threads at once"** was the union of every thread in one
  broken twelve-hour event. True peak **458**, mean 244.
- **Nothing is drawn before it happens** — a dashed line was drawing a branch's
  entire future route, and a ring lit a merge 0.6 s before it landed.
- **The main line carries its name**, instead of being labelled once at a commit
  that scrolls away.
- A measurement correction: headless Chromium rasterises on the **CPU**. Every
  frame-pacing number found before that describes the harness, not the app.
