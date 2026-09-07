# Adversarial review of today's work — rev1

Target: `C:\Dev\Visual Studio\GitDance1`, HEAD `12f1ba0`.
Everything below is measured unless it says otherwise. Scripts and raw JSON are in `x/rev1/`.

## Verdicts

1. **Render-scale ladder (`d3528c4`) — PARTIALLY.** The five rungs exist, fire in order,
   never came back up, and I could not make them false-fire. **The published fps and p95
   figures reproduce**, all four inside their stated ranges, once I stopped contaminating
   my own measurement. But: the **0.6 floor is wrong for closely spaced lanes** (modulation
   collapses 87%); the commit's stated invariant "**ninety frames of a performance** … so a
   step costs a canvas reallocation only once the show is actually running" is **false** —
   it steps down with the clock parked at 0 and nothing playing; the clock holds real time
   to **0.92–1.00x**, not the 0.96–1.00x `docs/status.md` claims; and the prescribed
   instrument reports a phantom scale for one frame after every resize.
2. **Two new readouts (`3ecd8f5`) — PARTIALLY.** Neither overflows nor overlaps anywhere,
   on any engine. But "N branches open" **contradicts the app's own peak stat inside its
   own tooltip** on 7 of 9 shelf entries — 88% of mdBook's timeline, worst case 99 against
   16 — and the code comment's stated justification for counting unlanded threads is
   **false on all thirteen shipped plans**, which silently closes the one genuinely-open
   branch for the last 3.2 s of every history. "Open N days" is honest where it appears.
3. **Commit rail's click (`3ecd8f5`) — CONFIRMED.** Click seeks and selects, drag still
   docks, a drag does not also seek, a sub-threshold wobble still clicks — on Chromium,
   Firefox, WebKit and with touch. Two caveats, neither a regression.
4. **Mute fixture (`1d7d9f9`) — CONFIRMED.** Truly silent, through accessors asserted to be
   native, with the app's own element mid-performance, on all three engines. Two structural
   holes exist; this app does not currently walk into either.

Outside the numbered list:

5. **`docs/pacing.md` — REFUTED in three numbers, and its central reassurance is
   contradicted by a figure already in `docs/status.md` at this commit.** The measurement it
   names as missing has been taken (§6c) and it strengthens the diagnosis while relocating
   the cause to a single constant.
6. **`docs/status.md` — six stale or wrong items**, one of them introduced by HEAD itself.

---

## Build provenance, stated up front, because it nearly invalidated the whole review

The brief said to serve on port 4187. **Port 4187 was already occupied by another process
serving a different build** — `vite preview --outDir x/qa7/dist-ga --port 4187` (PID 35256).
It answers 200 and serves `assets/index-BRgS6XUz.js`. Following the instruction literally
would have meant measuring `x/qa7/dist-ga` all session. Separately, that process **rebuilt
the shared `dist/` at 04:11:55** while my first preview server was serving out of it — the
exact failure `playwright.config.ts` documents.

So I built my own tree into `x/rev1/dist-rev1` and served it on **4192**, and every probe
from `p5` onward records the served bundle filename beside its numbers.

| probe | served bundle | tree |
|---|---|---|
| `p1*` (mute), `p2` (**withdrawn**) | `index-THAMS_Pm.js` | pure HEAD, built 03:53 |
| `p3`, `p3b` | not captured — straddles the 04:11:55 rebuild | see distrusted §4 |
| `p2b`, `p5`–`p11` | `index-CRRVZag9.js` from my private `x/rev1/dist-rev1` on 4192 | HEAD + one uncommitted diff |

The uncommitted diff in that tree (`+54/−2` in `src/renderer/canvas.ts`) was entirely
contributor-focus work (`focusRuns`/`markFocusRuns`/`inFocus`) from the concurrent process. It
has since been committed as **`c51eb06`** ("Let a contributor's work in the aggregated runs
count as theirs"), so my private build is exactly **`12f1ba0` + `c51eb06`** and nothing else.
The ladder is unaffected: lines 660–745 of `12f1ba0`'s blob and of the build I served hash
**identically** (`md5 afa03a07…`), and no `+`/`-` line touches `watchFrameRate`, `slowShare`,
`frameEma`, `framesSeen`, `sinceStep`, `dprEarned`, `qualityEarned`, `MIN_RENDER_SCALE` or
`resize`.

**`HEAD` moved during this review.** It was `12f1ba0` when I started and is `a8850a5` now
(`c51eb06` → `17351a9` "Make the Events panel the thing accessibility.md says it is" →
`a8850a5` "Stop a bounded build crediting its own commit count to GitHub"). The two later
commits are **not** in anything I measured. Every finding here is against `12f1ba0`
(+ `c51eb06` for probes `p2b`, `p5`–`p11`), and anyone re-running "against HEAD" will be
running against a different tree.

I did not use 4187 and did not kill the process holding it.

---

# Findings

## 1. CONFIRMED — the picture is *not* honest at 0.6 for closely spaced lanes; the spine is fine

The one substantive defect in the new rungs, and the one measurement here that CPU load
cannot touch, because it is taken from a paused, settled frame.

Pixels via `drawImage` into an `OffscreenCanvas` + `getImageData` **at CSS size** — which is
what the compositor puts in front of a viewer, since at 0.6 the backing store is upscaled.
`pause()` → wait `buffering === false` → 1100 ms → three `requestAnimationFrame`s. Never
`page.screenshot`, never `canvas.toDataURL`.

Same plan, same playhead (t = 90), and I verified the two frames were comparable *before*
comparing them: camera x 7706.53 vs 7707.67, camera w 1932.26 vs 1932.37, viewport scale
0.637595 vs 0.637558. Five vertical scanlines; peaks are strict local maxima ≥6 above the
10th-percentile luminance floor; separation is Michelson modulation between an adjacent pair
of lines and the darkest point between them.

**The main line survives, comfortably:**

| | scale 1.0 | scale 0.6 |
|---|---|---|
| brightest peak luminance | 181.8 | **181.8** |
| brightest peak FWHM | 3 px | **3 px** |
| mean luminance along the spine row | 121.5 | **120.0** (−1.2%) |
| lit pixels on the spine row | 804 | 808 |
| lit fraction of frame | 0.01766 | 0.01844 |

**Lane separation does not, where lanes are close:**

| scanline | gap between the two lines | modulation at 1.0 | modulation at 0.6 | loss |
|---|---|---|---|---|
| x=640 | 32–40 px | 0.810 / 0.822 / 0.717 / 0.719 | 0.653 / 0.713 / 0.625 / 0.625 | −13% to −19% |
| x=160 | 79 px, 17 px | 0.597 / 0.748 | 0.480 / 0.511 | −20% / −32% |
| **x=400** | **4 px** | **0.539** | **0.175** | **−67%** |
| **x=400** | **5 px** | **0.455** | **0.060** | **−87%** |

At the worst pair the two lines have peak luminance 24.1 with a valley of 21.4 between them
— a difference of **2.7 levels out of 255** on a near-black field. Two branches have become
one thick line.

So the floor's justification — `MIN_RENDER_SCALE = 0.6` "because the stage is drawn in
hairlines: **the lane glow and the 1px spine** survive a bit over a third of the pixels" — is
half right, and it is the wrong half that was verified. The 1px spine survives (−1.2%). The
lane separation, the other thing the comment names, collapses wherever lanes land within
~5 px of each other, and that happens in the shipped demo at an ordinary playhead.

Related, and probably the real root: `MIN_LANE_PX = 26` is described as "the least room two
neighbouring branches may be given **on screen**", yet at t=90 I measured adjacent lanes
**4–7 CSS px** apart. That guarantee is not holding once the camera is zoomed out, which is
what puts the 0.6 rung in a position to destroy them. Fixing the lane spacing would matter
more than raising the floor.

Arithmetic the commit does not address: on a HiDPI display `dprEarned = 0.6` means a backing
store of 0.6 CSS px/px against a panel with 2 device px/px — a **3.33× upscale** and **9% of
the device's pixels** (0.6²/2²), not "a little over a third". "Over a third" is only true at
`devicePixelRatio === 1`.

Raw: `x/rev1/p8-asshipped.json`. Reproduce: `node x/rev1/p8-pixels.mjs 90`.
**Caveat:** the 0.6 read is also at `minimal` quality (the ladder drops bloom and dust on the
way down), so this compares as-shipped 1.0+full against as-shipped 0.6+minimal. My attempt to
isolate the render scale failed and I discarded it — see distrusted §3.

## 2. CONFIRMED — the ladder steps down with nothing playing, refuting the commit's stated invariant

`d3528c4` says, of the new 90-frame gate:

> "It now wants ninety frames **of a performance** before it will judge anything, reset
> whenever a new performance is loaded, **so a step costs a canvas reallocation only once the
> show is actually running.**"

It does not. `framesSeen` counts every frame the renderer draws, and `controller.ts:747`
draws every frame regardless of playback: `if(player.buffered)renderer.render(t, dt)`. Ninety
idle frames at 60 Hz is 1.5 seconds of a *paused* stage.

Measured — `#demo=1` at `deviceScaleFactor: 2`, 1280×720, **`play()` never called**, clock
seeked to 0 and paused, no CPU throttling:

```
{"showTime":0,"playing":false,"phase":"READY","scale":1,"d":1,"q":0}
canvas at start: 2560x1440 (scale 2)   canvas after: 1280x720 (scale 1)
```

Within the first 2-second sample the ladder had spent a rung — `dprSteppedDown: 1`, backing
store halved — with the performance clock at **0.000**, `playing: false`, `phase: READY`.
Independently visible in the throttled dpr-2 run, where the step is logged at wall 13.879 s
with `showTime: 0.00`.

Consequence: the guard does not guard against the thing it was written for. The commit's own
reasoning — "a load is a burst of slow frames for reasons that have nothing to do with the
device: the compile finishes on this thread, the first paint touches every cache, and the
geometry is being built" — describes frames that `framesSeen` happily counts, because during
a load the show is not running. Gating on frames drawn cannot express "of a performance"; the
condition needs `player.playing`, or performance seconds elapsed, or a reset on the first
frame after playback starts.

**Fairness:** I did not catch this producing a *wrong* rung. On this machine the step was
earned — see finding 3 — and my six false-fire attacks all stayed far below the trigger. This
is a demonstrated broken invariant, not a demonstrated wrong step.

Reproduce: `node x/rev1/p11-idle.mjs` (raw `x/rev1/p11.json`).

## 3. CONFIRMED — the top rung is unreachable on an ordinary retina desktop, and the step is honest

Healthy, unthrottled Chromium, `deviceScaleFactor: 2`, 1280×720 (a 2560×1440 = 3.7 Mpx
backing store), the shipped demo, 45 s, 1233 frames recorded in-page:

| | |
|---|---|
| mean frame | 48.2 ms (**20.7 fps**) |
| p50 / p95 / max | 39.2 / **140.8** / 236.6 ms |
| frames ≥100 ms | **93 of 1233** |
| longest consecutive run of slow frames | **92** |
| peak `slowShare` (trigger 0.7) | **1.000** |
| step | `dprSteppedDown` 1 at wall **13.879 s**, scale 2 → 1 |

92 consecutive slow frames is far past even the old twenty-consecutive rule, so the step is
**correct** — this configuration genuinely cannot hold ten frames a second at 2× device
pixels. Reported because it means something the commit does not say: on any retina or
4K-at-200% desktop of roughly this capability, the stage shows its full 2× resolution for
about fourteen seconds and never again. The "2x device pixels" top rung is not a state such a
machine occupies. Raw: `x/rev1/p10.json`.

## 4. CONFIRMED — "N branches open" contradicts the app's own peak, in the same tooltip, on 7 of 9 entries

The strongest finding in area 2. `src/app/DateBar.tsx` renders

```
title={`${open} of ${perf.stats.threads} branches are open at this point;
        the busiest moment of this history has ${perf.stats.maxConcurrentThreads}.`}
```

`open` counts threads whose *span* covers the playhead (`th.start <= t && th.end > t`).
`stats.maxConcurrentThreads` is `plan.peakConcurrentThreads`, which
`src/choreography/events.ts:322-356` computes as the largest number of threads with a
**moving performer edge** at any 0.1 s step. Different quantities — and the first routinely
exceeds the second, so the tooltip asserts both "99 are open now" and "the busiest moment
ever had 16".

Verbatim, read out of the live DOM on **rust-lang/mdBook**, a shipped shelf entry, with the
browser's `planHash` (`20fddabc6c11…`) asserted equal to my independently decoded plan:

> **`99 of 1033 branches are open at this point; the busiest moment of this history has 16.`**

at t = 10.325 s; visible text "99 branches open"; `nodesDrawn` 608; not travelling.

Across the shelf — every whole `.gtperf.gz` in `dist/catalog/` decoded with the app's own
`readCompiledPerformance` under Node (no browser), `open(t)` computed at 801 evenly spaced
playheads per entry:

| entry | threads | `maxConcurrentThreads` | max `open` | worst excess | positions where `open` > peak |
|---|---|---|---|---|---|
| **microsoft/vscode** | 12,238 | 84 | **343** | **+259** | 674 / 801 (**84%**) |
| **rust-lang/mdBook** | 1,033 | 16 | **100** | **+84** | 706 / 801 (**88%**) |
| **facebook/react** | 2,576 | 23 | **157** | **+134** | 584 / 801 (73%) |
| **kubernetes** | 57,738 | 284 | **425** | **+141** | 178 / 801 (22%) |
| python/cpython | 12,022 | 10 | 15 | +5 | 92 / 801 |
| public-apis | 1,713 | 138 | 161 | +23 | 24 / 801 |
| nodejs/node | 327 | 4 | 5 | +1 | 3 / 801 |
| chromium/chromium | 64 | 11 | 11 | 0 | 0 / 801 |
| llvm/llvm-project | 6 | 4 | 4 | 0 | 0 / 801 |

Chromium and LLVM escape only because aggregation leaves them 64 and 6 threads in total.
Every entry with a non-trivial thread count contradicts itself.

The readout faithfully implements what the code says, so this is a design fault rather than an
implementation slip: 81 DOM samples against the decoded curve agree to **±1**
(`maxAbsDelta: 1`, the worst-excess sample agreeing exactly), the ±1 being the offset between
my 81 sample points and the 801-point reference grid.

The fix is a choice, not a patch: drop the second clause, or count what
`peakConcurrentThreads` counts, or rename one of them. As shipped, a viewer who reads the
tooltip is told two incompatible things in one sentence.

Raw: `x/rev1/p5.json`, `x/rev1/gt-*.json`. Reproduce: `node x/rev1/gt-threads.mjs
dist/catalog/rust-lang-mdBook.gtperf.gz out.json` then `node x/rev1/p5-dom.mjs`.

## 5. CONFIRMED — the comment's premise about unlanded threads is false on all thirteen plans

`src/app/DateBar.tsx`:

> "`end` is **the plan's end** for a thread that never lands — a live ref tip, or one that
> simply went quiet — and counting those as open is the honest reading rather than a
> convenience. **They are open; nobody merged them.**"

Decoded from all thirteen shipped plans: **no thread's `end` is ever the plan's end.**
`duration − max(thread.end)` is **exactly 3.20 s for every single entry** — that is
`CLOCK_TAIL` (`src/choreography/clock.ts:62`), the closing tableau.

| entry | duration | max thread end | threads ending at duration |
|---|---|---|---|
| torvalds/linux | 43200.47 | 43197.27 | **0** |
| kubernetes | 16380.69 | 16377.49 | **0** |
| rust-lang/mdBook | 162.80 | 159.60 | **0** |
| … all 13 | | duration − 3.20 | **0** |

So the one branch that genuinely *is* open — the live ref tip, one per entry — is reported as
**closed for the last 3.2 seconds of every history**, which is exactly the closing tableau
where the whole shape is on screen. Measured on mdBook at t = 162.6 of 162.8:

- `open-threads` element: **absent** (count 0)
- caption, simultaneously: **"Present day · 1 live tip"**
- `nodesDrawn` **27,680**, `edgesDrawn` **37,425**

Two adjacent readouts, one saying a live tip exists and the other declining to say a single
branch is open. Also absent at t = 160.88 with 8,160 nodes drawn, and at the final frame with
11,820 drawn. That answers "does it go to 0 where work is plainly on screen?" — **yes, for
the last 3.2 s of every entry.**

## 6. CONFIRMED — `docs/pacing.md`: the headline figure is 97.8% closing tableau, and is wrong by 45×

Recomputed from `.catalog-release/*/manifest.json` in plain Node (`x/rev1/pacing.mjs`).

The document's premise about the manifest is subtly wrong. `years` is written by
`scripts/package-catalog.mjs:90-92` as `for (let y = first; y <= last+1; y++)`, and
`mapMonotone` **clamps**, so the final entry is a **sentinel** labelled `lastYear+1` clamped
to the last node's impact. `scripts/catalog-release.mjs:63` already drops it
(`manifest.years.slice(0,-1)`) — the codebase knows; the document's script did not.
`duration − years.at(-1)[1] = exactly 3.200 s for all twelve entries`, i.e. `CLOCK_TAIL`.

| claim | recomputed | verdict |
|---|---|---|
| nodejs "2016 onward = 3.27 s = **2.4%**" | 3.200 s of that 3.273 s is the closing tableau. Real 2016-onward = **0.0728 s = 0.054%** | **WRONG — understates the defect 45×** |
| nodejs "2017–2026, 0.007 s each" | 2016 = 0.00684 (identically thin); 2017–2025 = 0.00682; **2026 = 0.00461** | **WRONG — off by a year at both ends; eleven thin years, not ten** |
| kubernetes "2027 (3.2 s)" as its thinnest year | 2027 is not a year of Kubernetes' history (tip 2026-09-04); it is `CLOCK_TAIL`, identical for all twelve. **Kubernetes' thinnest real year is 2014 at 451.4 s (2.76%)** — seven and a half minutes | **WRONG — it has no thin year at all** |
| nodejs 135.9 s; fattest 2012 38.0 / 2013 37.2 / 2011 26.6 / 2014 15.1 | 135.89; 37.963 / 37.187 / 26.563 / 15.054 | MATCHES |
| nodejs "86% to 2011–2014" | 85.93% | MATCHES |
| chromium 165.0/117.5/71%; llvm 154.6/103.6/67%; kubernetes 16,380.7/13,866/85% | all reproduce by the document's own method | MATCHES |
| second table (commits, aggregated away, visible, merges, threads), all nine cells | exact from `summary.stats`; `aggregates.ndjson.gz` member counts cross-check to `stats.aggregatedCommits` | MATCHES; the `~` on "left visible" is unnecessary |

One systematic error: an extra bucket for the sentinel with `duration` as its end. It adds a
flat 3.200 s to every "2016 onward" cell — **2% for Chromium, 3% for LLVM, 0.02% for
Kubernetes, and 44× for Node**. That asymmetry is exactly what made the four-entry comparison
look reassuring.

### 6b. CONFIRMED — "This is not a general pacing fault" is not supported, and the repo already knew

All twelve entries, not the four the document chose:

| entry | duration | 2016+ (tail excluded) | 2018–2026 | years under 0.05 s | fat : thin |
|---|---|---|---|---|---|
| **python/cpython** | 3,178.9 | 619.6 / 19.5% | **9.71 s / 0.305%** | **22** | **213,610 : 1** |
| **nodejs/node** | 135.9 | **0.073 s / 0.054%** | 0.06 s / 0.044% | **11** | 8,231 : 1 |
| **facebook/react** | 550.7 | 162.1 / 29.4% | 72.7 / 13.2% | 1 | 6,086 : 1 |
| public-apis | 316.6 | 312.4 / 98.7% | 217.5 / 68.7% | 3 | 5,887 : 1 |
| chromium | 165.0 | 114.3 / 69.3% | 100.6 / 61.0% | 3 | 1,124 : 1 |
| llvm | 154.6 | 100.4 / 65.0% | 84.2 / 54.5% | 0 | 107 : 1 |
| rust, tensorflow, vscode, mdBook, kubernetes, linux | — | 63.6–99.3% | 52.2–86.0% | **0** | 5–504 : 1 |

**CPython is worse than Node, at both ends.** Its sixteen years 1990–2005 get 0.0026–0.0066 s
each — **1.10 s total, 0.03% of a 53-minute show** — and 2018–2021 get 0.0211 s each; its
whole 2018-onward decade is 9.71 s = 0.305%. React gives 2015 alone 36.7% and its last seven
years 3.42 s = 0.62%; its 2016-onward share (29.4%) is **worse than Chromium's or LLVM's**,
the two entries the document holds up as healthy.

**And this was already recorded in this repository at this commit.** `docs/status.md` §5, in
the rejected-time-ticks writeup: "Per-year width across one history varies by up to
**213,610 : 1** (CPython), and 22 of its 36 years occupy under 0.05 s of runtime." My harness
computed the same figure independently. `docs/pacing.md` §3C **cites that very document**
(`x/ticks-review/VERDICT.md`) — so the CPython number was read, and "This is not a general
pacing fault" was then written from a four-entry sample that excluded CPython. The reassuring
half of the diagnosis is the half that is wrong, and it is the half the recommendation
("do not republish on the strength of this alone") leans on.

### 6c. The missing measurement, taken: per-year distribution of *visible* nodes

`docs/pacing.md` §2 calls this "the one measurement this document is missing and the first
thing to take before rebuilding anything". `node_modules` has no esbuild (Vite 8 ships
rolldown), so the entry was bundled with `node_modules/rolldown` (`x/rev1/build.mjs`, alias
`@`→`src`); `readCompiledPerformance` + `gunzipIfNeeded` then ran **unmodified** under Node
22. No `src/` file touched, no browser, no network. Every geometry page read and
**de-duplicated by `sha`** — necessary, because edge pages carry their endpoints' node records
(`src/export/catalogPackage.ts:32-33`): Node's 3,129 node records collapse to 1,013 distinct.

**Distinct visible nodes: 1,013 / 923 / 894 — exactly the document's "~1,013 / ~923 / ~894".**

nodejs/node, per calendar year:

| year | runtime s | % | **visible nodes** | s/node | agg members behind them |
|---|---|---|---|---|---|
| 2009 | 2.176 | 1.65 | 20 | 0.109 | 931 |
| 2010 | 11.351 | 8.62 | 82 | 0.138 | 1,840 |
| 2011 | 26.563 | 20.17 | 186 | 0.143 | 2,127 |
| 2012 | 37.963 | 28.83 | 299 | 0.127 | 2,066 |
| 2013 | 37.187 | 28.24 | 296 | 0.126 | 1,658 |
| 2014 | 15.054 | 11.43 | 119 | 0.127 | 939 |
| 2015 | 1.324 | 1.01 | 10 | 0.132 | **37,698** |
| **2016–2025** | 0.0068 each | 0.005 | **0 each** | — | 0 |
| 2026 | 0.0046 | 0.004 | 1 | — | 0 |

**The diagnosis is confirmed and stronger than the document claims.** `s/node` is flat inside
every entry (Node 0.126–0.143 across 2009–2015), corroborated in source at
`src/choreography/compile.ts:300` — `duration = max(targetSeconds, HEAD + TAIL +
visible.length * perNode)`. Node's later years hold **not "almost nothing" but exactly zero**
visible nodes, so the 0.0068 s they appear to receive **is not runtime at all — it is a
linear-interpolation artifact**:

- second-to-last visible node `79a7a86d4d`, date 2015-05-02, impact **132.6126**, carrying
  aggregate `agg-0-462` = **36,848 members spanning 2015-05-02 → 2026-09-04 (11.35 years, 0
  merges)**;
- last visible node `57860ef5d4`, date 2026-09-04, impact **132.690** = `duration − CLOCK_TAIL`;
- so 2015-05 → 2026-09 is **one 0.0774 s interval between two consecutive nodes**, and the
  year marks for 2016–2026 are `mapMonotone` subdividing that single gap pro-rata by wall
  clock. Check: `132.6126 + (244/4143) × 0.0774 = 132.61716` = the manifest's 2016 mark exactly.

Eleven "calendar years" are eleven subdivisions of one gap. Chromium's largest aggregate is
2,426 members / 1.20 years; LLVM's 676 / 0.36 years; **neither has a span over 1.2 years.**
Node has exactly one span over 400 days and it holds 36,848 commits. **This is a single
runaway aggregate, not a diffuse property** — which changes the fix.

Controls: chromium 923 visible nodes, s/node 0.015–0.210 (13.8×); llvm 894, 0.034–0.187
(5.5×). One correction to the mechanism story: **60 of Chromium's 64 threads first appear in
2013**, and 2013 is its fattest year (17.08 s, 192 nodes against 30–68 elsewhere) — so
Chromium is a control for the *magnitude* but not for the mechanism. Also from the same
harness: python/cpython has **21 years with zero visible nodes** (1991–2005, 2007, 2010,
2018–2021); public-apis three (2023–2025); react one (2023).

**And §3B is already half-implemented, which the document does not know.**
`src/choreography/compile.ts:263`:

```ts
weight = Math.max(1.5, Math.min(3.2, Math.log2(span.memberCount + 1) * 0.55));
```

Beats are **already** sized by `log2(memberCount)`, sub-linearly, exactly as §3B proposes.
Node's 36,848-member span computes `log2(36849) × 0.55 = 8.34` and is **clamped to 3.2**. So
§3B is not a new mechanism; the operative change is that `3.2` ceiling, and the fact that a
span holding 78% of a repository's commits is worth at most 3.2 beats. §3B and §4 should be
rewritten around that constant — and "it changes every entry's pacing" becomes directly
testable by re-running the compiler with the clamp raised, far cheaper than the document
assumes.

## 7. CONFIRMED — `docs/status.md`: six stale or wrong items

Line numbers are `docs/status.md` at HEAD; source citations from `git show HEAD:…`.

1. **Item 4 is stale, and the fix landed one commit before this file was last edited.**
   `status.md:115` — "The only lever left is drawing at a fraction of the CSS resolution and
   upscaling, **which no setting currently permits**." It exists at HEAD: `canvas.ts:179`
   `MIN_RENDER_SCALE = 0.6`; `canvas.ts:735` the 0.75/0.6 selection. Added by **d3528c4 =
   HEAD~1**, whose commit message cites *the very three measurements this item quotes*
   (5.65 / 3.55 / 2.43 fps). HEAD then edited `status.md`, inserting item 3 and renumbering
   this one from 3 to 4, without updating it. Same item: "a configuration that needs **both
   rungs** of the quality ladder" — the ladder has five steps now.
2. **Item 3 transposes two numbers.** `status.md:101` — "Chromium, LLVM and Kubernetes give
   **67%, 71%** and 85%". Chromium is 71.2%, LLVM 67.0%. `docs/pacing.md:20-21` has them the
   right way round, so `status.md` contradicts its own cited source. It also inherits
   pacing.md's 2.4% and "2017 to 2026" errors (finding 6).
3. **A broken cross-reference introduced by HEAD itself.** `status.md:147` — "which is **item
   3 above**", pointing at the frame-rate item, which HEAD's own renumbering moved to item 4.
   Item 3 is now the Node pacing item.
4. **§3's "0.96x to 1.00x in every cell" is outside my measurements.** Two independent quiet
   runs inside their stated grid (Chromium, 8x CPU throttling, dpr 1 and dpr 2, 1280×720):
   per-rung clock ratios of **0.924** and **0.930**, and whole-run ratios of **0.9420** and
   **0.9398**. Modest, but below the stated floor, and it is the number item 4 leans on when
   it says "Nothing stalls and nothing drifts". Detail and full tables in finding 8.
   *(§3's companion claim "Frames over one second: 0, anywhere" I could **not** refute — see
   distrusted §1.)*
5. **§5's "Speculative prefetch" idea is already built.** It reads "The worker cancels its
   previous request on every message, so the next window cannot be warmed while the current
   one plays. A separate speculative channel **would** remove the remaining stalls." At HEAD
   `src/workers/catalog.worker.ts:35-49` is a comment titled "A speculative fetch, running
   beside the live one instead of replacing it", with `warmAbort` as its own controller that
   "never touches `abort`"; `CatalogSource.warm()` exists; `controller.ts:710-733` calls it.
   The item's second half (a second worker is not the answer) is still valid.
6. **§6's pixel-reading doctrine is contradicted by the shipped suite.** `status.md:344`:
   "**Never `page.screenshot` or `canvas.toDataURL`** on the stage … **both hang above about
   40k nodes**. Use `drawImage` into an `OffscreenCanvas`". `tests/e2e/stage.spec.ts:21-31`
   does the opposite and asserts the reverse: "`drawImage(canvas, ...)` **never returned on
   Linux's 332,279 nodes** … **`toDataURL` does**." Two other places side with the doctrine
   (`large.spec.ts:28`, and the concurrent process's new `focus.spec.ts:35-36`). They cannot
   all be right, and one of them is misdirecting future measurements. It survives because
   `stage.spec.ts` runs on the 177-commit demo, where both methods work. My reads used
   `drawImage` and it returned promptly on the demo and on mdBook every time; I did not test
   either method on Linux, so I cannot say which claim is false — only that the repository
   asserts both.

Items 1, 2 and 5 of §2 I checked and found accurate at HEAD — with one caveat on item 1: the
named evidence, `tests/e2e/catalog.spec.ts:116`, picks the single **cheapest** entry by bytes
(`:121-124`) and tolerates ±1 year (`:140`), which is the "one entry is not the shelf" trap
`status.md:288` warns about. The "believed fixed" hedge is fair; the evidence is thinner than
the prose implies.

## 8. CONFIRMED (modest) — the clock holds real time to 0.92–1.00x, not 0.96–1.00x

Chromium, 8x CPU throttling via CDP `Emulation.setCPUThrottlingRate`, 1280×720, `#demo=1`
stretched to 190.118 s, `source = {provider:'synthetic', slug:'gittimeline/A generated
history'}`, `mode = player`, bundle `index-CRRVZag9.js`. Frame timestamps collected **inside
the page** in a `requestAnimationFrame` loop and read out afterwards; render scale read per
frame as `canvas.width / cssWidth`; **machine otherwise idle**.

**dpr 1** — 1133 frames, `monotonicDown: true`, ends at scale 0.6
(`dprSteppedDown: 2`, `qualitySteppedDown: 2` — four rungs):

| scale | frames | fps | mean ms | p50 | p95 | max | show/wall |
|---|---|---|---|---|---|---|---|
| 1.0 | 74 | 3.51 | 284.9 | 233.3 | 649.9 | 866.5 | **0.957** |
| 0.75 | 32 | 3.80 | 262.9 | 200.0 | 666.6 | 783.4 | **0.924** |
| 0.6 | 1027 | 7.94 | 126.0 | 100.1 | 316.6 | 700.0 | 0.997 |
| whole run | 1133 | — | — | — | — | — | **0.9420** |

**dpr 2** — 2169 frames, `monotonicDown: true`, `dprSteppedDown: 3` + `qualitySteppedDown: 2`
= **all five rungs**:

| scale | frames | fps | mean ms | p50 | p95 | max | show/wall |
|---|---|---|---|---|---|---|---|
| 1.0 (after the 2→1 rung) | 116 | 3.76 | 265.6 | 216.7 | 549.9 | 716.6 | 0.973 |
| 0.75 | 73 | 8.93 | 112.0 | 116.7 | 216.6 | 283.3 | 1.000 |
| 0.6 | 1980 | 12.18 | 82.1 | 66.7 | 199.9 | 600.0 | **0.930** |
| whole run | 2169 | — | — | — | — | — | **0.9398** |

The mechanism is `MAX_FRAME_SECONDS = 0.5` (`controller.ts:626`): every frame donates at most
500 ms to the clock, so any rung with mass above 500 ms loses time, and the loss is exactly
`mean(min(dt, 0.5)) / mean(dt)`. That gives an **arithmetic ceiling on honesty** which is
independent of any machine: if a device ever sustains the **1.5 fps at full scale** that
`d3528c4` reports (mean frame 667 ms), the clock cannot exceed **0.75x** there — so
"0.96x to 1.00x in **every** cell" and "1.5–4.6 fps at full scale" cannot both describe the
same configuration. My machine sat at the fast end of that range (3.51 fps) and duly read
0.957; a slower one would read worse.

## 9. CONFIRMED — the prescribed instrument reads a phantom 0.70 render scale after every resize

The brief says "the render scale is `canvas.width / canvas.getBoundingClientRect().width`,
which is the reading to trust." It is not trustworthy for one frame after every resize.

`src/app/Stage.tsx:23` wires `resize()` through a `ResizeObserver`. Per spec, within one
frame: `requestAnimationFrame` callbacks run, **then** `ResizeObserver` callbacks run, then
paint. So the renderer draws one frame with the *previous* backing store into the *new* CSS
box, and only then is the canvas reallocated.

Measured, healthy Chromium, 8 viewport changes between 900 and 1280 px wide, with
`dprSteppedDown = 0` and `qualitySteppedDown = 0` throughout:

- **8 mismatched frames out of 124** — exactly one per resize
- apparent scales observed: **{0.703, 1.000, 1.422}** — i.e. 1280/900 and 900/1280
- every mismatch run is exactly **1 frame** long

Seen independently in a second run (`x/rev1/p3-healthy.json`, `scaleTrack`) where 30 rapid
viewport changes produced **60 apparent scale transitions**, all 1→1.422→1 or 1→0.703→1,
again with zero ladder steps.

**For a reviewer:** a probe that resizes and then reads the render scale will report a
step-down that never happened, and 0.703 is a plausible-looking rung. Take the reading at
least one frame after the last resize. **For a viewer:** SUSPECTED, from the spec ordering
rather than from pixels — `resize()` sets `canvas.width`, which clears the backing store, and
it runs after the frame's render but before paint, so a resize should paint one blank or stale
frame. I did not capture pixels of that frame (it is gone before an out-of-page read can
happen), so I am not claiming it as measured. During a continuous drag-resize it would be
every frame.

## 10. SUSPECTED — the warm-up gate is denominated in the scarcest unit on a slow device

`canvas.ts:689`: `if (this.framesSeen < 90 || this.slowShare < 0.7 || this.frameEma < 0.06 || this.sinceStep < 30) return;`

Every gate is a frame count, so each one's duration scales inversely with need. 90 frames is
1.5 s at 60 fps and **26 s at the 3.51 fps I measured**; 30 frames between rungs is 0.5 s
against 8.5 s. Measured, dpr 1 at 8x: the first scale change landed at **wall 21.1 s** and the
second at **29.4 s**; at dpr 2, 30.7 s and 38.9 s. So a device that needs the floor watches
**21–39 seconds at 3.5–3.8 fps** before it gets there. `d3528c4` criticised the old code for
leaving a throttled Chromium "at the 0.75 rung for another 45 seconds at 3 to 5 frames a
second"; the new code holds it at the *top* rung for ~21 s at 3.51 fps and at 0.75 for
another 8 s at 3.80 fps. Better, not solved, and the shape of the problem is unchanged. A
time-denominated gate would be immune — and, per finding 2, would also express the "of a
performance" intent that a frame count cannot.

Compounding it: `dprEarned` and `qualityEarned` live on the renderer instance and are never
persisted, while `boot()` unconditionally runs `updateSettings({ quality: chooseQuality() })`
(`controller.ts:2697`). So the descent is paid again on **every page load and every reload**,
not once per device. Within one session it does carry across catalog entries, since opening an
entry does not reload the page.

## 11. CONFIRMED — two structural holes in the mute fixture (latent; this app does not hit them)

The fixture works (see "checked and could not break"), but it is a *behavioural* guard, not a
structural one: it forces silence on `volume`/`muted` **assignment** and inside `play()`. An
element that receives neither stays loud. Measured in a belted Chromium with a real user
gesture and the real `music/ready-aim-fire.mp3`:

| route | native `volume` | native `muted` | `paused` | `readyState` | `currentTime` |
|---|---|---|---|---|---|
| `el.autoplay = true; el.src = …` | **1** | **false** | **false** | 4 | **2.789** |
| `<audio autoplay loop src="…">` via `innerHTML` | **1** | **false** | **false** | 4 | **2.659** |
| `new Audio()`, never assigned, never played | 1 | false | true | 0 | 0 |

That is **real playback at full volume, past the fixture** — on the one engine that has a
launch switch to save it, and WebKit has none. `grep -rn "autoplay" src/` finds no HTML media
`autoplay` attribute, so the app does not do this today; the hole is latent. Given this
project's history with conventions that hold "until the day it matters", the structural form
would also force zero from the `src`/`srcObject`/`autoplay` setters and `load()`.

Second hole: `AudioContext` is present and unpatched on Chromium and Firefox
(`hasAudioContext: true`). `grep -rn "AudioContext\|createOscillator\|OfflineAudio" src/ worker/`
returns **nothing** and `src/audio/engine.ts` says so explicitly ("Web Audio bought nothing
here"), so again latent. Headless WebKit reports no `AudioContext` at all.

Third, minor: the fixture *does* change an app observable, contrary to "playback otherwise
unaffected". `AudioEngine.playing` is `!el.paused && el.volume > 0 && enabled`, so under the
fixture `window.__gittimeline.music.playing` is **always false** — measured false on all three
engines while the track was genuinely playing (`readyState: 4`, `currentTime` advancing). No
spec asserts it today (`grep -rn "music" tests/` finds only volume-control tests), so it is a
trap for a future test rather than a present failure.

## 12. Measured characterisation — "open N days" is refused on most long-lived branches

`threadLifetime` refuses when `thread.start < w.start || thread.end > w.end`. On the streamed
path the window is the union of only the **time** pages covering the playhead
(`catalog.worker.ts:80`; `perf.window.start/end` at `:109`), which is 30 s wide — measured on
mdBook: min 12.80, median 30.00, max 60.00 s. Geometry pages span a much wider band, so
`perf.threads` is far wider than the window that governs the lifetime.

Fraction of each entry's threads whose `[start, end]` fits inside **any** such window,
computed from the published page index plus the decoded plans:

| entry | duration | time pages | threads | ever quantifiable | median span |
|---|---|---|---|---|---|
| nodejs/node | 136 | 5 | 327 | 320 (**97.9%**) | 0.36 s |
| rust-lang/mdBook | 163 | 6 | 1,033 | 949 (**91.9%**) | 0.11 s |
| microsoft/vscode | 5,776 | 193 | 12,238 | 10,136 (82.8%) | 1.01 s |
| kubernetes | 16,381 | 547 | 57,738 | 34,221 (59.3%) | 7.36 s |
| **torvalds/linux** | 43,200 | 1,441 | 109,030 | 30,436 (**27.9%**) | 49.04 s |

On Linux **78,594 of 109,030 threads (72%) can never show a lifetime**, and they are precisely
the long-lived branches whose lifetime is the interesting number. Not a defect — the commit
says the refusal is deliberate, and I confirmed it never shows a wrong number — but it costs
more than the framing implies, and it costs most where the feature would say most. Widening
the loaded time-page set would recover it.

---

# Checked and could not break

**The ladder never false-fired.** Six legitimate provocations on a healthy unthrottled
Chromium at 1280×800, 1,733 recorded frames, `dprSteppedDown = 0` and `qualitySteppedDown = 0`
after every one, render scale 1.0 throughout (excluding the resize artifact of finding 9). I
replayed the real frame series through the real `watchFrameRate` arithmetic offline to measure
the *margin*, not just the outcome:

| provocation | frames | slow frames (≥100 ms) | max consecutive slow | peak `slowShare` (fires ≥0.7) | peak `frameEma` (fires ≥60 ms) | would fire? |
|---|---|---|---|---|---|---|
| 20 s ordinary playback | 472 | 0 | 0 | 0.000 | 48.1 ms | no |
| 60 seeks | 222 | 0 | 0 | 0.000 | 52.2 ms | no |
| 30 window resizes | 137 | 1 | 1 | 0.100 | 50.2 ms | no |
| 40 panel opens/closes | 154 | 2 | 1 | 0.100 | 59.5 ms | no |
| tab backgrounded 8 s (**see distrusted §2**) | 275 | 0 | 0 | 0.000 | 51.2 ms | no |
| heavy first paint (2,137-node fixture) | 327 | 3 | 1 | **0.198** | **66.3 ms** | no |
| performance swap | 145 | 0 | 0 | 0.000 | 50.6 ms | no |

`slowShare` needs 12 consecutive slow frames to reach 0.7 from zero (`1 − 0.9¹² = 0.7176`).
The worst provocation reached 0.198 — a **3.5× margin**. That is the guard working, and it is
the guard that matters: `frameEma` sat at **48.1 ms** at rest against its 60 ms trigger (a
1.25× margin) and **crossed it** during the heavy load, and `sinceStep ≥ 30` is free after the
first half-second. Of the three gates only `slowShare` is actually defending. On a machine
~25% slower than this one `frameEma` would sit above its gate permanently, and a 12-frame
burst would be enough. I could not produce a 12-frame burst from any legitimate action; the
closest was 1.

Clean healthy baseline, nothing read per frame but the clock: 453 frames, mean **44.4 ms**,
p50 50.0, p95 66.6, max 83.3 → **22.5 fps**, **0** frames ≥100 ms, settled `frameEma` 45.5 ms.
All frame times are exact multiples of 16.68 ms, so this is vsync-limited frame dropping on a
60 Hz output rather than jitter.

**The claimed fps and p95 pair reproduces — all four numbers in range.** Chromium, 8x CPU,
1280×720, quiet machine:

| | claimed by `d3528c4` | measured | |
|---|---|---|---|
| full scale fps | 1.5–4.6 | **3.51** | in range |
| full scale p95 | 450–1150 ms | **649.9 ms** | in range |
| scale 0.6 fps | 6.9–9.9 | **7.94** | in range |
| scale 0.6 p95 | 233–400 ms | **316.6 ms** | in range |

The improvement claim also holds: 3.51 → 7.94 fps is **2.26×** ("roughly double") and p95
649.9 → 316.6 ms is **2.05×** down ("about threefold" is generous but the right order). At
dpr 2 the gain is larger: 3.76 → 12.18 fps and p95 549.9 → 199.9 ms. **The rungs are worth
having.** My first attempt said otherwise and was wrong — distrusted §1.

**All five rungs exist and fire in order.** At `deviceScaleFactor: 2` under 8x CPU:
`dprSteppedDown: 3` + `qualitySteppedDown: 2` = five steps, ending at
`canvas.width/cssWidth = 0.6`. At dpr 1 the first rung is correctly skipped and four fire.

**The ladder is monotone and does not chain or oscillate.** `monotonicDown: true` over 1133
frames (dpr 1) and 2169 frames (dpr 2); every observed transition downwards; scale changes 32
and 73 frames apart, respecting `sinceStep >= 30`. By construction `dprEarned` and
`qualityEarned` only decrease and `resize()` takes `Math.min` of them, so recovery is
unreachable — confirmed by reading and not contradicted by 3,300 frames of measurement. Each
rung's first frame costs a canvas reallocation: **333.3 ms** and **116.7 ms** measured.

**Both new readouts survive every narrow layout, on all three engines.** rust-lang/mdBook
seeked to its peak (text "97 branches open" / "96 branches open"), at 320×568, 375×667,
640×400 (= 1280×800 at 200% zoom) and 1280×800:

- pairwise overlaps between `.caption-line`, `.open-threads` and `.clock`: **0**, every case
- elements escaping `.date-meta` or the viewport: **0**, every case
- `.date-meta` scroll overflow **0**; document scroll overflow **0**; no wrapping
- at the tightest case `.open-threads` is 91.0 px and `.clock` 85.8 px inside a 292 px
  `.date-meta` — 115 px of slack. A third digit adds ~8 px, and the largest possible count on
  the shelf is 425 (kubernetes), so it cannot overflow.
- `.thread-life` ("· open 3 days") with a commit actually selected: present, not clipped, not
  escaping its panel or the viewport, at all four widths on Chromium, Firefox and WebKit.

I used `getBoundingClientRect` comparisons rather than `scrollWidth`, because `styles.css`
records that `body` is `overflow: hidden` and `scrollWidth` reported no overflow during a
previous real overflow bug.

**The rail's click works, and the drag still works, on everything.** `#demo=1`, paused with 5
rail items, Inspector open:

| engine / input | click → seek | Inspector shows clicked sha | lifetime pill | drag top→left | drag also seeked? | 13.4 px wobble → click |
|---|---|---|---|---|---|---|
| Chromium | 6.283 → 4.360 ✓ | ✓ `f001e53` | "· open 3 days" | ✓ `rail dock-left` | **no** | ✓ 6.333 → 4.360 |
| Firefox | 6.155 → 4.360 ✓ | ✓ | "· open 3 days" | ✓ | **no** | ✓ 6.147 → 4.360 |
| WebKit | 6.005 → 4.360 ✓ | ✓ | "· open 3 days" | ✓ | **no** | ✓ 6.046 → 4.360 |
| Chromium + touch, 851×393, dpr 2.75 | 6.150 → 4.360 ✓ | ✓ | "· open 3 days" | ✓ | **no** | — |

Zero page errors on any engine. Two caveats, neither a regression:

- **The `onClick` drag guard is unreachable code.** `onUp` sets `drag.current = null` before
  the browser dispatches `click`, so `if (drag.current?.moved) return;` in `onClick` can never
  be true. The only thing stopping a drag from also seeking is the browser retargeting `click`
  to the nearest common ancestor once capture is on the `<aside>` — the *same mechanism* the
  commit identifies as the original bug. It happens to work on all three engines and with
  touch (`timeBefore === timeAfter` in all four cases), but the code's own defence is not what
  is defending it.
- **The touch device named in the brief has no rail.** `styles.css:1868`
  `@media (max-width: 720px) { .rail { display: none } }`. `devices['Pixel 5']` is 393×851, so
  measured: `railPresent: true` in the DOM, `getComputedStyle(...).display === 'none'`. I
  tested touch at 851×393 (the same device rotated), the narrowest real touch viewport that
  has a rail at all. The commit's "its commits could not be reached at all, by anyone" is now
  fixed for pointer users above 720 px and remains true on phones in portrait, where the
  Events panel is the only route.

**The mute fixture is genuinely silent.** Verified through accessors captured in an init
script added **before** the fixture and asserted native
(`Function.prototype.toString.call(get).includes('[native code]')` true for the `volume`,
`muted` and `paused` getters *and* the `volume`/`muted` setters, checked at the start **and
again at the end** of every run). The app's element is never in the document, so I recorded it
by wrapping the `Audio` constructor and `Document.prototype.createElement`.

The app's own element, mid-performance, after a real Playwright click for user activation
(`navigator.userActivation.isActive === true`), with the real mp3 loaded and playing
(`paused: false`, `readyState: 4`, `currentTime` advancing):

| engine | belt | t≈3 s | t≈9 s | after volume slider → max and mute toggled off/on | after a seek |
|---|---|---|---|---|---|
| Chromium | `--mute-audio` | vol **0**, muted **true** | 0 / true | 0 / true | 0 / true |
| Firefox | `media.volume_scale=0` | vol **0**, muted **true** | 0 / true | 0 / true | 0 / true |
| **WebKit** | **none** | vol **0**, muted **true** | 0 / true | 0 / true | 0 / true |

Escape attempts that **failed** (the fixture held):

- a child `<iframe>` — `addInitScript` reaches it, `volume` **0**, `muted` **true**, and its
  getters are native while its setter is the fake, so a fresh realm is neither an escape nor a
  valid place to read from
- a **Blob-URL** document — reached, `volume` **0**, getter native, setter not native
- **Workers** — `typeof Audio`, `typeof HTMLMediaElement`, `typeof AudioContext` all
  `undefined` on all three engines; there is no media element to un-mute
- copying a child frame's descriptor back over the fake — the child's setter is also the fake;
  after `play()` the element still read **0 / true**
- headless WebKit has no `AudioContext` at all

The user was not disturbed: WebKit, the engine with no launch switch, was first run with
`**/music/**` aborted to establish the property behaviour safely, and only then run with real
audio, once volume 0 and muted true were already proven.

---

# Method

- **Server.** My own `npx vite build --outDir x/rev1/dist-rev1`, served by
  `npx vite preview --outDir x/rev1/dist-rev1 --port 4192 --strictPort`. Not 4187 (occupied by
  another build — see provenance), not 4173. Every probe prints the served bundle filename.
- **One browser at a time**, always, and **nothing else on the machine** for the timing runs.
  The one time I let a delegated Node decoder run beside a frame-timing probe it cost me a
  false finding — distrusted §1.
- **Never** `page.screenshot` or `canvas.toDataURL` on the stage canvas. Pixels via
  `drawImage` into an `OffscreenCanvas` + `getImageData`, from a paused settled frame:
  `pause()` → wait `buffering === false` → 1100 ms → three `requestAnimationFrame`s. I also
  checked the two frames were comparable (camera x/w, viewport scale) before comparing them.
- **Frame timing entirely inside the page** — a `requestAnimationFrame` loop appending
  `[performance.now(), dt, canvas.width, …]` to an array, read out once at the end. Nothing
  round-trips per frame. Where one probe read `getBoundingClientRect()` per frame I re-measured
  without it and report the clean figure.
- **Replayed, not just observed.** For the false-positive question I fed the real recorded
  `dt` series back through the real `watchFrameRate` arithmetic offline, so I could report the
  margin (`peak slowShare` 0.198 against 0.7) rather than only "it did not fire".
- **Independent ground truth for area 2.** Rather than compare the readout with itself I
  decoded all thirteen shipped `.gtperf.gz` plans with the app's own `readCompiledPerformance`
  under plain Node (bundled via `node_modules/rolldown`, `@`→`src`, nothing under `src/`
  modified) and computed `open(t)` at 801 playheads per entry. I then asserted the browser's
  `planHash` equalled the decoded plan's (`20fddabc6c11…`) before believing any comparison.
- **Provenance beside every measurement:** `__gittimeline.source`, `.mode`, `.phase`,
  `.duration`, `.planHash`, `.stats`, `devicePixelRatio`, canvas backing store and CSS size,
  `render.counts`, and the served bundle.
- **Mute.** `tests/e2e/muted.ts` replicated byte-for-byte as init script #2, with my own probe
  as init script #1 so it captures the real descriptors, and native-ness asserted before and
  after every run. `x/rev1/lib.mjs`.
- **Files.** Everything written is under `x/rev1/`. No `git commit`/`add`/`checkout`/`stash`/
  `restore`. `npx playwright test` never run. Nothing under `src/`, `tests/`, `worker/`,
  `docs/` or any config modified by me.

---

# Measurements I took and then distrusted

1. **I measured the ladder next to my own Node decoder and produced a false finding, which I
   have withdrawn.** My first 8x/dpr-1 run (`x/rev1/p2-8x-dpr1.json`) read **1.45 fps, p95
   1600 ms, max 2266 ms, clock ratio 0.609 at full scale** and 0.807 over the run — and I had
   written it up as "the claimed fps/p95 figures do not reproduce" and "0 frames over one
   second is refuted", noting with some satisfaction that the claimed 233 ms p95 equalled my
   measured 233.3 ms p50. What actually happened is that the run overlapped the heaviest phase
   of the delegated Node decoding I had started (rolldown bundling plus 39 binary pages of
   Node, Chromium and LLVM). The re-run on an idle machine (`p2b`) reads **3.51 fps, p95 649.9
   ms, max 866.5 ms, ratio 0.957** — every claimed number in range. The tell was the dpr-2 run
   reporting **3× better fps at an identical 768×432 backing store**, which is impossible from
   anything but machine load. **Withdrawn: the "figures do not reproduce" finding and the
   "frames over one second" half of the status.md refutation.** Quiet maxima were 866.5 / 783.4
   / 700 ms at dpr 1 and 716.6 / 283.3 / 600 ms at dpr 2 — all under a second. This is
   precisely the failure `status.md:352` warns about ("Never measure timing next to another
   browser. Five separate false failures in this project were another process on the machine"),
   and I walked into it in the same session in which I quoted it.
2. **The hidden-tab test never hid the tab.** `other.bringToFront()` did not make the first
   page hidden in headless Chromium: `document.visibilityState` never became `'hidden'`
   (`sawHidden: false`), no `visibilitychange` fired, and the maximum frame gap was 100 ms
   rather than the ~8 s a genuinely backgrounded tab produces. So that row proves nothing and
   **the tab-return false-positive case is untested.** From the code, `visibilitychange` resets
   `lastFrame` and `dt` is clamped to 0.5 s, so one returning frame can add at most 0.1 to
   `slowShare` — an argument, not a measurement.
3. **The attempt to isolate render scale from the quality drop failed, and I nearly reported it
   as a result.** The 0.6 read is also at `minimal`, so finding 1 conflates two changes. I
   pinned `quality: 'minimal'` via a pre-seeded `localStorage['gittimeline.settings.v1']` and
   got numbers **byte-identical** to the un-pinned run — which would have licensed the pleasing
   conclusion "the bloom makes no difference, so the modulation loss is purely the render
   scale". I checked instead: after load, stored `quality` read `'full'`, because `boot()`
   unconditionally runs `updateSettings({ quality: chooseQuality() })`
   (`controller.ts:2685-2697`) and render quality is deliberately device-chosen with no viewer
   setting (`Panels.tsx:305`). So the identical numbers mean both "1.0" reads were at `full`,
   not that quality is irrelevant. **Finding 1 is therefore as-shipped and does not attribute
   the lane-separation loss to the render scale alone.** Isolating it needs a renderer-level
   hook the test surface does not expose.
4. **`p3` and `p3b` have uncertain build provenance.** They ran either side of another
   process's 04:11:55 rebuild of the shared `dist/`, before I had added bundle-id capture. The
   ladder region of `canvas.ts` is byte-identical between the two trees (`md5 afa03a07…`) and
   the diff touches nothing the ladder reads, so I kept their results — but the false-positive
   table and the clean baseline should be re-run on a pinned build before being quoted anywhere
   load-bearing. The resize artifact of finding 9 was observed independently in both runs and
   does not depend on this.
5. **The first area-2 run measured the landing backdrop and labelled it mdBook.**
   `waitForReady` was already satisfied by the demo playing behind the shelf, so my click plus
   1.5 s produced `source = {provider:'synthetic', slug:'gittimeline/an example history'}`,
   `duration: 199.98`, and 81 samples of nothing. Discarded. Caught only by printing `source`
   beside the numbers. Fixed by waiting on `mode === 'player' && /mdBook/.test(source.slug)` —
   and by discovering that a shelf card opens a **scope dialog** (`catalog-cta` →
   `catalog-<slug>` → `scope-chooser` → `scope-full`), so the original click had loaded nothing
   at all.
6. **`nodesDrawn` differs between my two pixel reads (532 vs 5,433) and I did not use it.**
   `renderProfile.counts` appears to accumulate across frames from when `enabled` was set
   rather than describing one pass, so the two figures are not comparable and say nothing about
   the frame I measured. Every pixel claim rests on `getImageData`.
