# Review: *Proposal: make the main line the timeline*

**Recommendation: keep the clock — and throw away the argument the proposal
keeps it with.** The named hybrid is **"main is already the axis; state its
lead"**: do not touch x, do not draw main as a rule (measured — it already *is*
one), reject candidate A on measurement, adopt B, and spend the effort instead
on the two things that measurably cause the reported misreading — the closing
tableau's **6.10 px** lane spacing and the fact that nothing on screen ever
says main is behind.

Everything below was measured at `HEAD = 751b7de`, working tree clean, against
my own build served on **port 4194**. Nothing in `src/`, `tests/`, `worker/`,
`docs/` or any config was modified; `x/` is gitignored and all scripts and raw
output are beside this file.

### Provenance of every measurement

| | |
|---|---|
| repo HEAD | `751b7dedb817f961cf46c832f101a5f57683f9e9` |
| build | `npx vite build --outDir x/rev2/dist` (`x/rev2/build.log`) |
| served on | `npx vite preview --outDir x/rev2/dist --port 4194 --strictPort` |
| **served bundle** | `assets/index-C_yuURFC.js` → sha256 `e3eb1eb3e9ad2957724421a9c9484ca78ee6e244da4bb59c0166a6e284b969eb` |
| | `index.html` `9bbb3534e7df79ab…`, `index-IzVPFCHP.css` `42ab2155582bdc42…`, `compile.worker-BqFdytoN.js` `c97d050b0d0ab85d…`, `catalog.worker-BdL7txNh.js` `6fca68d89856bef3…`, `compile-DNe1Rzz5.js` `210b32c8b3ca2be5…` |
| plans measured | `public/catalog/*.gtperf.gz`; their `planHash` **matches `.catalog-release/*/manifest.json` on all 12 entries**, so the offline numbers describe the published shelf |
| browser runs | one at a time, never two, never beside a timing measurement |
| `source` / `mode` | printed beside every sample (`x/rev2/p-*.json`), and the load wait is on `source.slug === <the entry>`, not on `stats !== null` — see *distrusted*, below |

**Audio.** Every browser run installs the `tests/e2e/muted.ts` shape below the
app on `HTMLMediaElement.prototype` (native getters kept, native setters
driven, both forced inside `play()`), then *refuses to continue* unless the
accessor it reads through is native code — `getOwnPropertyDescriptor(...).get`
must both stringify to `[native code]` and be identity-equal to the descriptor
captured in the init script — and unless a fresh `new Audio()` assigned
`volume = 0.9; muted = false` reads back `0` and `true`. The first run failed
that guard and exited 2 (the fake was not yet installed and the honest reading
was `0.9`), which is the guard working. Every recorded run carries
`{"nativeGetter":true,"nativeMutedGetter":true,"volumeAfterSet":0,"mutedAfterSet":true}`.
`--mute-audio` as belt and braces. Nothing was audible.

---

## Reasoning, in short

The proposal is right about the conclusion and wrong about why, and the "why"
matters because it is the sentence the author will reuse next time.

**The argument against a topological x is that it "would require drawing
commits at times they did not happen". The app already does that, deliberately,
to 734,221 of Linux's 1,481,850 commits — 49.5% — by more than a day each.**
x is not the clock. x is `presentation` time, which is author time *rewritten
until it respects ancestry*, and `tests/unit/shared.ts:54` asserts
`child.x > parent.x` for every parent relation on every fixture. The shipped
layout is already a hybrid in which **ancestry wins and the clock is the
tie-breaker**. So the choice is not clock-versus-topology; it is "time,
monotonised by ancestry" versus "count, with the time thrown away". The second
is worth refusing — but for the reason in the proposal's *second* paragraph
(the tempoMap, the two clocks, the era bands and the audio all derive from x
being a duration), not the first.

Then the three faults the proposal blames for the confusion turn out to be one
stale number, one real number quoted as a median, and one fault that has moved
somewhere the proposal does not look. And the counter-proposal's geometric
half — "anchor main to a straight horizontal line so it reads as an axis" — is
already shipped: main's world y is a constant **0**, and its **screen** y moved
by **one pixel across a whole 4½-hour Kubernetes performance**.

Which leaves the review with a different answer to "what removes the
confusion?" than any of A, B or C.

---

## 1. The argument against the topological layout — **the harm is real but the app already commits it**

### 1a. x is ancestry-first, and the app says so in its own tests · **CONFIRMED**

`src/dag/time.ts:correctTimestamps` walks `g.topo` and rewrites any commit
whose stamp precedes its parents to `parentMax + 1s`. `src/choreography/compile.ts:320`
feeds the result (via `buildClock` → `naturalTime`) to `layoutGraph`, and
`tests/unit/shared.ts:53-54` asserts for every edge on every fixture:

```
expect(child.impact).toBeGreaterThan(parent.impact);
expect(child.x).toBeGreaterThan(parent.x);
```

**x is already strictly monotone in ancestry, as a tested invariant.** I
verified it independently on all twelve published plans: `xMonotoneBreaks = 0`
everywhere, and x is affine in `impact` to within 0.05–0.16 world units
(`x/rev2/plan-scan.mjs`).

### 1b. How much of the picture is already "a time that did not happen" · **CONFIRMED**

Straight from the published manifests (`coverage.warnings`, no browser):

| entry | commits | stamps moved **> 1 day** to respect ancestry | share |
|---|---:|---:|---:|
| **torvalds/linux** | 1,481,850 | **734,221** | **49.5%** |
| **nodejs/node** | 48,272 | **22,392** | **46.4%** |
| rust-lang/rust | 339,084 | 67,263 | 19.8% |
| kubernetes/kubernetes | 140,858 | 25,263 | 17.9% |
| rust-lang/mdBook | 3,293 | 213 | 6.5% |
| llvm/llvm-project | 595,778 | 36,161 | 6.1% |
| facebook/react | 21,678 | 1,176 | 5.4% |
| tensorflow/tensorflow | 198,583 | 5,483 | 2.8% |
| microsoft/vscode | 164,682 | 2,684 | 1.6% |
| public-apis | 5,272 | 18 | 0.3% |
| python/cpython | 133,027 | 263 | 0.2% |
| chromium/chromium | 1,817,062 | 1,311 | 0.07% |

Half of the largest history on the shelf is drawn at a time it did not happen,
by over a day each — which is what an email-patch workflow does to author
dates, and it is exactly the "rebases, cherry-picks, amended commits, wrong
clocks" case. The plan carries no raw date at all (`NodeGeom` has `impact` and
nothing else — `src/model/types.ts:278`), so **the stage cannot show the raw
date even if it wanted to.** The correction is reported in a data-quality
warning list and nowhere on the stage.

### 1c. `10-clock-skew` · **CONFIRMED**

`src/fixtures/corpus.ts:158` builds a commit dated **four days before its
parent** ("Committed from a machine with a wrong clock"), plus one with no
stamp at all. `tests/unit/compile.test.ts:153` is titled *"clock skew is
corrected causally with a warning"* and asserts the correction happened. The
current layout handles date-versus-ancestry conflict by **discarding the date**
and drawing the commit immediately after its parent — i.e. topologically. There
is a unit test guarding that behaviour.

**So: is the topological layout more honest?** For those commits, it is exactly
as honest, because the current layout is already topological there. What the
current layout keeps that a full topological x throws away is the *interval*
between commits wherever the clock is trustworthy, and that is the whole
product. **Refuse the topological x — but stop calling the clock an invariant
the picture never breaks.** It breaks it 734,221 times on one entry, correctly,
and a proposal defended with a false absolute will lose the next argument.

---

## 2. Does the differentiator claim survive? — **yes, but two of its three legs are broken**

Concretely, what is on screen that gitk cannot state, measured in the browser
on the published shelf:

| on screen | gitk? | legible? | correct? |
|---|---|---|---|
| the advancing calendar date, 30 px `.date-hero` | no | yes | yes |
| `"Quiet span of 41 days passes"` (`QUIET_GAP`) | no | yes (900 ms caption floor, `751b7de`) | yes |
| era labels — `formation`, `merge-heavy period`, `rapid expansion` | no | yes | yes |
| **`"N branches open"`** (`[data-testid="open-threads"]`) | no | yes | **no on any whole plan** |
| **`"· open 34 days"`** on the thread pill (`Panels.tsx:231`) | no | on demand | **cannot say "months" on 5 of 12 entries** |
| `"51 commits converge"` on a merge | **yes** — pure topology | yes | yes |

### 2a. The one number the source calls the differentiator is wrong by up to 1,636 · **CONFIRMED**

`DateBar.tsx` counts `th.start <= t && (th.ending !== 'merged' || th.end > t)`.
`compile.ts:371` gives a thread whose every commit was collapsed into a ribbon
`start: 0, end: 0` — and if it has no branch ref its `ending` is `dormant`, so
it satisfies that predicate **from the first frame to the last**.

Measured in the browser on my build (mdBook, whole plan, `planHash 20fddabc6c`,
1600×900) and computed offline for the shelf (`x/rev2/openbug.mjs`):

| entry | threads | with **no** nodes | **shown** at t=0 / 25% | **true** at t=0 / 25% |
|---|---:|---:|---:|---:|
| kubernetes | 57,738 | 1,636 | **1,636 / 1,583** | 0 / 93 |
| microsoft/vscode | 12,238 | 2,305 | 2,305 / 2,337 | 0 / 60 |
| facebook/react | 2,576 | 1,007 | 1,007 / 981 | 0 / 13 |
| rust-lang/mdBook | 1,033 | 607 | **607 / 595** — browser-confirmed: `"607 branches open"` beside a hero reading **July 2015** | 0 / 2 |
| tensorflow | 11,939 | 672 | 672 / 682 | 0 / 88 |
| python/cpython | 12,022 | 163 | 163 / 163 | 0 / 3 |
| nodejs/node | 327 | 33 | 33 / 35 | 0 / 2 |
| llvm, chromium | 6 / 64 | 0 | 0 / 1, 0 / 4 | same |

**The published shelf escapes it**, because a windowed plan holds only the
threads near the playhead: the same mdBook, via its published `.pages`, reads
`2–8 branches open`, and Kubernetes reads **93** at the quarter mark — which is
exactly the true value. But the app's front door is "paste a public GitHub
repository URL", and that path compiles the whole plan. Anything over
`aggregateAbove: 900` commits with collapsed branches shows this number.
mdBook — 3,293 commits — shows **607** where the answer is **0**.

*(SUSPECTED, read from source not from screen: the tooltip pairs the resident
`open` with the global `perf.stats.threads`, so on Kubernetes it would say
"93 of this history's 57738 branches" — two scopes in one sentence, which is
the flaw the `maxConcurrentThreads` comment in the same file says was already
fixed once.)*

### 2b. "This branch was open five months" is unsayable on the entries that have five-month branches · **CONFIRMED**

`Panels.tsx:threadLifetime` refuses unless **both** ends fall inside the
resident window. Measured window span, in the browser, on the published pages:
**30 performance seconds** (Kubernetes `start 3270 → end 3300`; CPython
`630 → 660`). Converted through each plan's own `timeMap`, 30 s reaches:

| entry | calendar days inside the resident window (25 / 50 / 75%) |
|---|---|
| torvalds/linux | 5.2 / 4.5 / 4.3 |
| rust-lang/rust | 5.7 / 4.0 / 3.2 |
| kubernetes | 5.0 / 6.8 / 10.3 |
| python/cpython | 20.1 / 23.4 / 21.1 |
| microsoft/vscode | 20.2 / 21.8 / 30.4 |
| facebook/react | 85.5 / 54.2 / 161.8 |
| rust-lang/mdBook | 635 / 799 / 886 |

`threadLifetime` prints "N days" below 45 days, "N months" below 22 months,
else years. **On Linux, Rust and Kubernetes the "months" and "years" branches
are unreachable** — the longest lifetime the app can report is about five to
ten days. Availability at all: 59% of Kubernetes threads, 97–99% on mdBook and
CPython (`x/rev2/threadspans.mjs`); and the ~10% it refuses on Kubernetes are
the ones with span > 68 s, i.e. **the long-lived branches are precisely the
ones it cannot describe.**

**Verdict on area 2:** the differentiator is not theoretical — the timelapse
date, the quiet-span sentence and the era labels are all on screen, all
correct, and all impossible in gitk. But the two readouts the project itself
nominates as the differentiator are one wrong number and one that cannot say
its own headline sentence. The argument survives; the implementation does not
yet earn it.

---

## 3. The hybrid the author may not be seeing — **it is already shipped**

### 3a. Main's y does not wander. At all. · **CONFIRMED**

Offline, from the published plans (`x/rev2/spiney.mjs`): `threads[0]` is
`main-line`, `role: primary`, `lane 0`, `side 0`, and

| entry | spine nodes | node y min…max | points on spine edges | edge y min…max |
|---|---:|---|---:|---|
| kubernetes | 57,344 | **0 … 0** | 2,393,812 | **0 … 0** |
| python/cpython | 10,370 | **0 … 0** | 442,916 | **0 … 0** |
| public-apis | 1,102 | **0 … 0** | 42,436 | **0 … 0** |
| rust-lang/mdBook | 598 | **0 … 0** | 23,605 | **0 … 0** |

`spineY()` returns a constant 0 (`layout.ts:52`) and the compiler emits it
verbatim (`compile.ts:332`). In the browser, the **screen** height of the main
line (`__gittimeline.spineLabel.y`, which is `worldToScreen(spineTip).y`
clamped only at the canvas edge, cross-checked against thread-0 body y):

| run | non-tableau spine screen y | camera `cy` |
|---|---|---|
| kubernetes 1920×1080, 20 depths over 16,381 s | **493 … 494** | 0 at every sample |
| kubernetes 1440×900, 12 depths | **403 … 404** | 0 |
| kubernetes 1855×620, 12 depths | **263 … 264** | 0 |
| cpython 1600×900, 13 depths | **403 exactly, all 13** | 0 |
| mdBook 1600×900, 8 depths | **403 … 403** | 0 |

**Main is already a ruled horizontal line at a fixed screen height.** Question 2's
"anchor main to a straight horizontal line so it visually reads as an axis" is
not a change; it is a description of HEAD.

### 3b. So what would actually break · **CONFIRMED for (i), measured for (ii)**

Since the geometry is already an axis, drawing main "as a ruled line" can only
change two things:

1. **Its extent.** Main's ink is laid down per spine edge and revealed to
   `travelU` (`canvas.ts:2245`, `keepSpine`), so it stops at the drawn tip. A
   *rule* spans the frame — which paints main's own path to the right of where
   main has got to. That is precisely the falsehood `48ca9d7` removed, and it
   is the one the viewer reported. **This is a hard blocker and it is the whole
   content of the idea.**
2. **Its screen straightness under camera roll.** `camera.ts:238` sets
   `roll = 0.012 · salience · sin(...)` on merge impacts. Measured peak
   |rotation| in my runs: **0.00387 rad** (kubernetes), 0.00170 (cpython) —
   about 6 px of tilt across a 1600 px stage. A rule pinned to *screen* axes
   would visibly cross the commits during a merge hit. Small, but it makes
   "a screen-space rule" wrong and "the world-space line" right — and the
   world-space line is what is already drawn.

**Answer to question 2: there is no hybrid hiding here.** The honest reading is
that the counter-proposal's geometric half has already been built, shipped, and
did not remove the confusion — which is evidence about the confusion's cause,
not about the geometry.

---

## 4. Which of A, B or C removes the confusion — **none of them; A should be rejected outright**

### A — main's date on its nameplate: **visible, and redundant 80–99.7% of the time** · **CONFIRMED**

Not invisible, unlike the ticks. Measured with the plate's own font
(`600 9.5px ui-sans-serif…`, `track 1.4`, `padX 7`) in the browser: the pill
goes from **43.4 px** (`MAIN`) / **57.4 px** (`MASTER`) to **105.7 / 119.7 px**
(`MAIN · SEP 2023`) — **+62.3 px, +144%**. A viewer would see the ivory pill at
the end of the main line roughly two and a half times longer, with a date in
it. So the ticks failure does not repeat.

The problem is what it would say. Both dates would be produced the same way —
`mapMonotone(timeMap, t, true)` — and the hero renders **"Month YYYY"** on any
history spanning over 400 days, which is all twelve. I sampled 4,000 playhead
positions per entry and compared the two rendered strings
(`x/rev2/twodates.mjs`):

| entry | share of the show where the plate would read the **identical string** to the hero | max amount the plate would be **older** |
|---|---:|---:|
| **kubernetes** | **99.65%** | 4.3 days |
| rust-lang/rust | 99.55% | 15.4 days |
| tensorflow | 99.48% | 11.0 days |
| python/cpython | 98.67% | **932 days (2.6 y)** |
| torvalds/linux | 98.38% | 57.9 days |
| facebook/react | 94.14% | 285 days |
| public-apis | 90.75% | **1,156 days (3.2 y)** |
| rust-lang/mdBook | 86.02% | 134 days |
| llvm | 86.01% | 113 days |
| **nodejs/node** | 84.94% | **2,678 days (7.3 y)** |
| chromium | 82.83% | 65.8 days |
| microsoft/vscode | 80.30% | 298 days |

**On Kubernetes — the entry the confusion was reported on — A puts the same
words on screen twice for 99.65% of a four-and-a-half-hour show**, then
disagrees by at most four days. Elsewhere it is redundant 80–94% of the time
and, in the remainder, older by up to seven years. A is not information; it is
a duplicate that occasionally becomes an alarm. **Reject A.**

### B — say what the big date describes: **cheap, true, adopt it**

It costs a few words in the existing `.date-meta` line under a 30 px hero, and
it is unambiguously true: `DateBar` reads `player.historicalAt(t)`, and the
node pass at `canvas.ts:1830` (`if (nd.impact > t + 0.001) continue`) makes the
playhead the rightmost ink in the frame. What a viewer would see: the hero
gains a small label — "the show has reached" or "playhead" — on the line that
already carries the era and the caption. It does not address "a line is past
main", but it is the one candidate that is both cheap and never wrong.

### C — say x is runtime, not calendar: **already the documented open item, and it needs the pacing decision first**

`docs/notes/status.md` §2.2 already carries this, half fixed: `751b7de` gave captions
a 900 ms floor so `QUIET_GAP` is actually seen. I saw the unstated half live:
on CPython at 1600×900 the hero reads **October 2016 at 93% of the show and
September 2026 at 100%** — ten calendar years in the last 7%. That is real and
worth saying. It is also the thing `x/ticks-review/VERDICT.md` R2 says cannot
be designed until the shelf's pacing is settled, and it is the open item
recorded as "shelf pacing is uneven". C is right and is not ready.

### What *would* remove the reported confusion — measured

The complaint is "MASTER is being surpassed", said as though it were
impossible. Two things cause it, and neither is A, B or C.

1. **The closing tableau fuses the lanes worse than the number the proposal
   quotes.** Settled at t = duration, held for 3 s and 6 s, identical both
   times: Kubernetes at 1855×620 → **6.10 px between lanes** (`scale 0.11304`,
   `worldW 15,985`). That is 2.7× tighter than the 16.4 px the proposal calls
   the worst case, and it is **the last frame of every performance** — the one
   a viewer looks at longest. The zoom floor deliberately exempts the tableau
   (`canvas.ts:1422`, `cue.state === 'tableau' ? 0 : MIN_LANE_PX / LANE_GAP`).
   Full set: kubernetes 12.89 px @1920×1080, 10.23 @1440×900, 6.10 @1855×620;
   cpython 13.28 @1600×900; mdBook 17.09 @1600×900.
2. **Nothing ever says main is behind** — and it is behind far more often, and
   by far more, than the record claims. See §6a. A readout of main's lead is
   the only candidate that speaks to the sentence the viewer actually said; the
   author already priced it at **0.0–0.1 ms** and killed it on a measurement
   this review refutes.

---

## 5. Question 4, hard: does a second, older date read as information or as a bug?

**As a bug, and the project has already shipped the experiment.** · **CONFIRMED**

`Panels.tsx:182` prints `Authored` from `commit.authoredAtRaw` — the **raw**
author stamp, uncorrected. The stage places that same commit at its
**corrected** presentation time. So on Linux, for 49.5% of commits, the
inspector already shows a date that disagrees with where the commit sits and
with what the hero says, by more than a day; and the panel offers no word about
the correction. Nobody has reported it, which is weak evidence either way —
except that the panel is opened deliberately by someone inspecting one commit,
whereas A would put the disagreement in the ambient furniture of every frame.

Against that, the shape of the defect this project has already had: a date
readout fourteen years out on Node.js *because it silently answered a different
question* (`docs/notes/status.md` §2.1 — it described the camera, not the clock). A
second date, in a different typeface, at the other end of the stage, disagreeing
by up to 2,678 days, produced by the same `historicalAt` inversion, is that
defect's silhouette. And on Kubernetes it agrees 99.65% of the time, which is
worse rather than better: a readout that is a duplicate almost always and an
alarm occasionally trains the viewer to ignore it exactly when it matters.

**Answer: it reads as a bug.** If main's relationship to the frontier is worth
stating, state it as **one** quantity — a lead, in commits or in days — not as a
second absolute date the viewer has to subtract.

---

## 6. The factual claims

### 6a. "Main runs 0–2 commits behind" — **REFUTED**, and this changes the shape of the first fix

The figure comes from `docs/notes/proposal-main-line.md` and `docs/reading-the-stage.md`:
three sample points on two entries (kubernetes and cpython @25/50/75%). I
reproduced it *at its own points* with its own definition — landed nodes whose
impact is later than the newest landed spine node — and got **1/0/0** on
Kubernetes and **1/1/2** on CPython (`x/rev2/atpoints.mjs`). The method is
sound. The sample was three points out of a 4½-hour and a 53-minute show.

Widened to 399 evenly spaced points on the same two entries:

| | zero ahead | p50 | p90 | p99 | max |
|---|---:|---:|---:|---:|---:|
| kubernetes | 158 / 399 (40%) | 1 | 5 | 13 | 23 |
| cpython | 149 / 399 (37%) | 1 | 3 | 74 | **181** |

Exhaustively, across the whole shelf — the worst case is the longest run of
consecutive non-spine nodes in impact order, which is exactly the set drawn to
the right of main's head, because the node pass refuses anything past the
playhead and x is increasing in impact (`x/rev2/plan-scan.mjs`):

| entry | p50 | p90 | p99 | **max ahead** | furthest ahead (perf. s) | share of show with ≥1 ahead |
|---|---:|---:|---:|---:|---:|---:|
| **microsoft/vscode** | 1 | 3 | 8 | **3,275** | **441.1 s** | 63.7% |
| **torvalds/linux** | 5 | 45 | 127 | **637** | 95.4 s | 86.3% |
| facebook/react | 1 | 4 | 6 | 399 | 49.7 s | 54.4% |
| python/cpython | 1 | 2 | 8 | 234 | 30.7 s | 61.4% |
| rust-lang/rust | 5 | 18 | 39 | 166 | 20.4 s | **88.4%** |
| tensorflow | 1 | 4 | 9 | 107 | 10.4 s | 53.5% |
| chromium | 1 | 1 | 105 | 105 | 7.3 s | 15.1% |
| public-apis | 2 | 6 | 26 | 71 | 8.8 s | 53.7% |
| **kubernetes** | 2 | 6 | 13 | **35** | 4.0 s | 54.3% |
| rust-lang/mdBook | 1 | 3 | 8 | 20 | 2.3 s | 52.7% |
| nodejs/node | 2 | 6 | 11 | 18 | 1.7 s | 74.6% |
| llvm | 1 | 3 | 8 | 8 | 0.6 s | 2.0% |

These are *nodes*; a node may be an aggregate of many commits, so in commits it
is larger. Consequences:

- **"0–2" is a median, not a bound.** It is the median on 10 of 12 entries and
  the maximum on none. It is out by a factor of ~1,600 on VS Code.
- **The thing the viewer reported is real and common, not a rendering
  artefact.** On 53–88% of every show on ten of twelve entries, something is
  drawn to the right of main's head, and on Linux 77.4% of the show has three
  or more.
- **The first fix in the proposal changes shape.** "A topological layout removes
  (1) by definition" is now removing something that happens for most of every
  show and reaches 441 seconds of runtime — that is not "small but real", it is
  a defining feature of the picture, and removing it removes the product.
- **A killed feature should be revived.** `docs/notes/proposal-main-line.md` killed the
  "N commits ahead of main" readout because "it would show 0 almost always".
  Measured properly it is non-zero for 60% of the show on the two entries the
  claim came from, and its median is 5 on Linux and on Rust.

### 6b. Lane spacing 34.6 / 27.4 / **16.4** px on Kubernetes — **two thirds confirmed, the worst case refuted at HEAD**

Measured with no pixel reads at all: lane separation is exactly
`LANE_GAP × viewport.scale = 54 × scale`. Kubernetes via its published pages
(`planHash e1c36c48bb`, `source` printed on every sample):

| window | non-tableau lane px (12–20 depths) | median | proposal | closing tableau |
|---|---|---:|---:|---:|
| 1920×1080 | 33.55 – 43.98 | **34.9** | 34.6 ✓ | 12.89 |
| 1440×900 | **26.00** – 32.70 | **27.66** | 27.4 ✓ | 10.23 |
| 1855×620 | **26.00 flat** (42.45 in the opening intimate shot only) | **26.00** | 16.4 ✗ | **6.10** |

The 34.6 and 27.4 figures are reproduced almost exactly. **16.4 px is stale:**
`MIN_LANE_PX = 26` (`canvas.ts:149`) now floors the zoom, and at 1855×620 the
floor binds for the entire performance — the measured value is a flat **26.00**,
a 59% improvement on the number the proposal quotes as a live defect. The
proposal is citing its own fix's docstring as evidence of the bug the fix
closed. What survives is the exemption: **the tableau reaches 6.10 px**, worse
than 16.4, and it is the frame every show ends on.

### 6c. 213,610 : 1 per-year spread on CPython — **CONFIRMED exactly**

Recomputed from `.catalog-release/*/manifest.json` `years`, dropping the
sentinel and charging the last real year against `duration − CLOCK_TAIL`:
CPython **213,610 : 1** (2016 = 556.12 s; 1990 = 0.002603 s), **22** years
under 0.05 s, 37 years. Every other figure in `docs/notes/pacing.md` §1 reproduces
too: node 8,231:1 with 11 thin years, react 6,086:1, public-apis 5,887:1,
chromium 1,124:1, llvm 107:1, and 0 thin years on rust / tensorflow / vscode /
mdBook / kubernetes / linux. The claim stands as written.

### 6d. `x = impact * xScale`, and the node pass refuses anything ahead of the playhead — **substantively confirmed, literally wrong**

- **The guard is exact.** `canvas.ts:1830`: `if (nd.impact > t + 0.001) continue;`
  in the node pass. **CONFIRMED.**
- **The formula is not.** `compile.ts:305,320`:
  `naturalTime = (impact − HEAD) / clock.scale`, then
  `x = naturalTime × X_PER_SECOND`. So x is **affine** in impact, not
  proportional — there is a `HEAD` offset and a duration-normalising divisor,
  which is deliberate ("geometry is identical for every target duration").
  Same ordering, same conclusions; but "x = impact * xScale" is quoted in the
  proposal *and* in `docs/reading-the-stage.md` §1 as if it were the code, and
  it is not. Measured affine residual across all 12 plans: ≤ 0.16 world units,
  which is rounding. **CONFIRMED as an order claim, REFUTED as a formula.**
- `canvas.ts:2968` really is `spine.label.toUpperCase()` and nothing else.
  **CONFIRMED.**

---

## Settling `docs/notes/status.md` §6 vs `tests/e2e/stage.spec.ts` — **both are wrong, and nobody needs to choose**

Neither method hangs at HEAD. Read from a paused, settled frame (`pause()`,
`buffering === false`, ~1.2 s, three `requestAnimationFrame`s), on the canvas
the app actually draws to, 1600×900, dpr 1:

| load | resident plan nodes | `toDataURL('image/jpeg',0.7)` | `drawImage` → `OffscreenCanvas` + `getImageData` |
|---|---:|---:|---:|
| **torvalds/linux**, published pages, 40% in (`4d7ba8596d`) | 2,337 (936 nodes drawn) | **12.7 ms**, 94,355 bytes | **1.2 ms**, lit 0.0777 |
| **microsoft/vscode**, whole plan (`d007e0a95f`) | **44,400** | **13.8 ms** | **0.9 ms** |
| **rust-lang/rust**, whole plan (`c3aad683be`) | **248,298** | **12.3 ms** | **0.8 ms** |

- **The "roughly forty thousand nodes" threshold is refuted directly**: 248,298
  resident nodes in one unwindowed plan, both methods back in ~1 ms and ~12 ms.
- **The "332,279 nodes on Linux" case does not exist on the published shelf.**
  Linux is streamed: 2,337 nodes resident, never more. The number in
  `stage.spec.ts` describes the whole plan, which the shelf never loads.
- **A pixel read costs the canvas, not the graph.** 1600×900 either way.
- **SUSPECTED mechanism for the historical hangs**, worth one line before
  anyone re-adds the doctrine: the readback has to wait for the frame in
  flight, and a frame on a whole 332k-node plan can take minutes — so the
  settle protocol in §6 is not a nicety, it is the thing that makes the read
  cheap. Independently, `large.spec.ts`'s own comment says the *tracer* hung,
  not the test. And a whole-plan load of that size may not survive at all: I
  watched a whole-plan Kubernetes renderer reach **4.3 GB** and die with
  "Target crashed" before any pixel read was attempted.

**Recommended edit (not made — `docs/` is out of scope for this review):**
replace both claims with "read pixels from a paused, settled frame; either
method returns in single-digit-to-teens milliseconds at any size on the shelf",
and delete the node-count threshold from both files.

---

## What I checked and could not fault

- **The playhead guard.** `canvas.ts:1830` is exactly as advertised, and
  combined with x monotone in impact it does make the playhead the rightmost
  ink. Nothing is drawn before it happens.
- **Ancestry monotonicity.** `xMonotoneBreaks = 0` on all twelve published
  plans, 332,279 nodes on the largest.
- **Main's flatness.** World y is 0 to the last decimal for every spine node
  and every point of every spine edge on the four entries I decoded, and its
  screen y varies by ≤ 1 px across a whole performance on five browser runs.
- **The 34.6 and 27.4 px lane figures**, reproduced to within 0.3 px.
- **The 213,610 : 1 spread and the whole of `docs/notes/pacing.md` §1**, reproduced
  independently including the sentinel handling.
- **The travel bug is fixed.** At `t = duration`, held 6 s, `manualCamera` is
  false and the hero reads September 2026 — the last commit's date — on
  Kubernetes at 1855×620. The 14-year defect did not reappear.
- **`threadLifetime`'s refusal is right**, even though it guts the feature: it
  declines to state a precise-looking number where `historicalAt` is coarse.
  The bug is the 30-second window, not the refusal.
- **`open > 1` gating.** Suppressing "1 branch open" is correct, and the
  windowed value (93 on Kubernetes at 25%) is exactly right.
- **`.catalog-release` and `public/catalog` are the same build.** All twelve
  `planHash` values match, so nothing in this review is measuring one and
  reporting the other.

## What I measured and later distrusted

- **My first Kubernetes run measured the demo and I nearly believed it.** I
  waited on `mode === 'player' && stats !== null`, which is already true while
  the built-in demo is on stage: `ident` came back
  `source: gittimeline/an example history`, `duration 199.98`,
  `planHash 39933b7a…`, so I sampled Kubernetes across the *demo's* 200 seconds
  — 1.2% of its 16,381 — while the per-sample `source` correctly said
  `kubernetes/kubernetes`. Only printing `source` beside every sample caught
  it. Discarded; the wait is now on `source.slug === <the entry>`, and every
  number in this document comes from a run that carries the right slug and the
  right `planHash`.
- **A whole-plan Kubernetes run at 1920×1080** reached 4.3 GB and returned
  "Target crashed". Discarded, and the entry re-measured through its published
  `.pages`. It appears above only as evidence about memory, not about geometry.
- **My first mdBook lane and open-branch numbers** came from the whole-plan
  path, because I had not yet copied that entry's published pages into the
  served build. The lane numbers are not comparable to the windowed shelf and
  are not quoted; the open-branch number *is* quoted, but explicitly as the
  whole-plan path, with the windowed re-run (2–8) beside it.
- **`canvas.ts:2982`'s claim** that reading the plate's height from `spineY`
  put it "a flat 374px off the line" is **SUSPECTED stale**: both `spineY(x)`
  and the emitted spine geometry are exactly 0 in every shipped plan, so the
  two cannot differ. It was presumably true when `spineY` was the "gently
  curving baseline" that `layout.ts:6` still describes — that header comment is
  stale too. Not load-bearing here, but the author cites this function and
  someone will read the comment.
- **CPython at t = 0** showed `caption` = `"fix/i18n-416 peels away from
  6e68dc8 · Yuki Tanaka · 2025-…"` beside a hero reading `August1990`. Yuki
  Tanaka is a synthetic-fixture contributor, so that looks like the demo's
  caption surviving the load. One observation, not chased. **SUSPECTED.**
- The 30-second resident window is measured on **two** entries (Kubernetes and
  CPython). The calendar table in §2b extrapolates it to the rest by arithmetic
  on each plan's own `timeMap`, not by measuring each entry's pages. If page
  duration varies by entry, that table moves.
- Everything is Chromium, dpr 1, one machine, and the browser numbers are
  12–20 depths per entry rather than a continuous watch. The offline numbers
  are exhaustive over the plans; the browser numbers are samples.

## Ranked, if only one thing is done

1. **Fix `"N branches open"` on the whole-plan path** (`compile.ts:371` gives a
   nodeless thread `start: 0`). It is wrong by 1,636 on Kubernetes, it is the
   readout the source itself calls the differentiator, and it is on screen for
   essentially 100% of every self-loaded history.
2. **Give the closing tableau lane separation.** 6.10 px at 1855×620 is the
   strongest remaining cause of "MASTER is being surpassed", and it is the last
   frame of every show.
3. **State main's lead** (one number — commits, or days) and correct
   `docs/reading-the-stage.md`'s "nearly always zero or one", which its own
   §2(a) heading already contradicts with "it is usually true, and it is the
   point".
4. **Adopt B.** Cheap, true, never wrong.
5. **Reject A** on §4's table, and **defer C** behind the pacing decision.
6. **Do not adopt a topological x** — but replace the reason. The picture
   already places 734,221 Linux commits at a time they did not happen. The
   reason to keep the clock is that the interval is the product, not that the
   clock is inviolable.
