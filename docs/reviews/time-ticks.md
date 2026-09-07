# Review: *Proposal: a time scale in the background of the stage*

Everything below was measured against the live site
(<https://thuynh-91.github.io/gittimeline/>) and the published shelf at
`https://gitdance-data.cruxpack.io/catalog/`, plus a patched local build of this
app that implements the proposal exactly as written. Scripts, screenshots and
raw numbers are beside this file in `x/ticks-review/`. Nothing in the app was
modified; the prototype lives in a scratch copy outside the repository.

---

## Verdict: **reject**

Not because a time reference is a bad idea, and not because the viewer's
complaint is imaginary. Because four of the document's load-bearing claims do
not survive measurement, and because the thing that is actually wrong is a
fourteen-year defect in the date readout that ticks would decorate rather than
fix.

The goal is worth keeping. This specification is not buildable as written, and
building it first would be building on top of a bug.

---

## 1. The premise check, with numbers

**Question asked:** does the date readout agree with the playhead's actual
position in the history?

**Answer: during playback, yes — exactly. At the final frame, no — by up to
fourteen years, and for a reason the proposal did not guess.**

### 1a. `historicalAt` is not wrong on a windowed plan. It is exact.

The proposal's risk 5, and the note in my brief, both suspected the
mixed-resolution `timeMap` that a streamed entry assembles (`assembleWindow`,
`src/export/catalogPackage.ts:83`: year marks from `manifest.summary` merged
with fine-grained slices from the loaded `time` pages). I reconstructed each
entry's **full-resolution** `timeMap` by downloading and decoding *every*
published `time` page, then rebuilt the map the browser actually holds at each
playhead position and inverted both (`x/ticks-review/truth.mjs`, 201 samples per
entry):

| entry | true map points | map the app holds | worst app-vs-truth error | worst error if *no* page were loaded |
|---|---|---|---|---|
| rust-lang/mdBook | 1,214 | 13 + loaded slice | **0.00 yr** | 0.36 yr |
| nodejs/node | 1,011 | 19 + loaded slice | **0.00 yr** | 0.58 yr |
| facebook/react | 4,185 | 15 + loaded slice | **0.00 yr** | 0.58 yr |
| public-apis/public-apis | 2,402 | 12 + loaded slice | **0.00 yr** | 0.86 yr |

The reason is structural: the `time` page covering the playhead is always
loaded, and it carries the map at full resolution for its own window. The coarse
year marks only ever govern parts of the map nobody is reading. **The
mixed-resolution hypothesis is false.**

In the app, on the live site, at 10 / 45 / 75 / 95 % of four entries
(`x/ticks-review/probe.mjs`), the date hero agreed with an independent ground
truth — the package manifest's own `years` array, computed at build time from
the full-resolution map — to within **0.41 years worst case**, and that residual
is the year-resolution of the ground truth itself, not the app.

### 1b. At the final frame the hero is wrong by up to fourteen years — and it is not arithmetic

Seek any catalog entry to its end and touch nothing (`x/ticks-review/probe2.mjs`,
live site, 1600x900):

| entry | date hero | timeline slider (`aria-valuetext`) | disagreement |
|---|---|---|---|
| nodejs/node | September 2012 | 02:15 of 02:15, **2026-09-04** | **14.00 yr** |
| python/cpython | January 2014 | 52:58 of 52:58, **2026-09-04** | **12.67 yr** |
| facebook/react | June 2015 | 09:10 of 09:10, **2026-09-04** | **11.25 yr** |
| chromium/chromium | April 2020 | 02:45 of 02:45, **2026-09-05** | 6.43 yr |
| rust-lang/mdBook | March 2021 | 02:42 of 02:42, **2026-09-03** | 5.50 yr |
| **built-in demo** (`#demo=1`, held whole) | February 2022 13 | 01:10 of 01:10, **2022-02-13** | **0.00 yr** |

Node.js is *exactly* the fourteen years the accessibility audit reported. The
demo — the only plan on that list held whole — is exempt. So the audit's
finding is real, reproducible, and specific to streamed entries.

**The mechanism** (`x/ticks-review/mechanism.mjs`). It is not `timeMap` and not
`historicalAt`:

1. `src/renderer/canvas.ts:995,1034` floors the camera's zoom at
   `safeW / 16000` whenever `perf.window` is set — that is, on every streamed
   entry — because only about 16,000 world units of geometry are resident. The
   comment there says so explicitly and calls it a deliberate trade.
2. The closing tableau therefore **never frames the whole picture** on a shelf
   entry. Measured on the live build, twice, consistently: the camera parks at
   exactly the mid-point of the history (mdBook `cx` = 68,813 of 137,706;
   CPython 1,335,183 of 2,670,445; Node 73,539 of 147,157 — 50.0 % in all three)
   with `worldW` = 16,000, which is 12 % of mdBook's picture and **0.6 %** of
   CPython's.
3. `ExploreBar` then sees `visible = worldW / span` about 0.12, well below the
   `>= 0.995` guard that was written to prevent this exact symptom, and sets
   `store.travelAt` with no user input at all. The caption confirms it:
   "Travelling the finished history".
4. `DateBar` switches from `player.historicalAt(t)` to `dateAtFraction(travel)`
   — and dutifully reports the date at wherever the camera happens to be sitting,
   which on the live build is the **middle** of the history.

The readout is not miscalculating. It has quietly stopped answering the question
it appears to answer. The loaded-geometry span is *not* the culprit: at the
tableau, 99.2–100 % of every picture's x-extent is resident.

The *size* of the disagreement is not stable — it is whatever the tableau
settles on. Running the same measurement against my patched dev build
(`x/ticks-review/endspan.mjs`), where the tableau came to rest somewhere else,
gave 11.7 yr on Node, 6.6 yr on React and **0.1 yr on mdBook** — the last
because `visible` happened to clear 0.995 there and the guard fired. The
mechanism is constant; the number it produces is a coin toss on where the camera
stops. That is worse than a fixed error, not better.

### 1c. This is almost certainly the viewer's complaint

> "It doesn't quite make much sense to be in February and there are threads into
> the next year."

At mdBook's untouched final frame the hero says **March 2021**, and the stage is
16,000 world units wide while mdBook's 2021 measures 14,605 units per year — so
the picture on screen spans about **1.1 calendar years** and the readout names
one month of it. Threads into the next year, with a date that says February.
That is the complaint, arithmetically, and it is a bug in the readout rather
than a missing axis. (The span is derived from the measured `worldW` and the
measured year width, not read off the screen directly; the direct reading came
from the dev build, where the tableau settles differently.)

### 1d. And the "109 px of ink ahead of the head" is the nameplate

The proposal's own measurement is offered as evidence that history is drawn to
the right of the playhead. Repeating it (`x/ticks-review/cost.mjs`, paused at
45 %): mdBook rightmost ink x = 1053 with the MAIN plate at x = 1010 — **4
columns of ink beyond the plate**; React 1058 / 1010 — **9 columns**. The ink
past the drawn head is the MAIN nameplate and its halo. Nothing meaningful is
drawn ahead of the playhead during playback, which matters a great deal for the
question the proposal asks itself in "The question this proposal cannot answer
by itself".

---

## 2. Why a background calendar axis is the wrong answer

### 2a. Horizontal position is *runtime*, not calendar

The proposal opens: "horizontal position is time: `x = impact * xScale` … This
one places them by *when they happened*." Half of that is true and the half that
is false is the half ticks depend on.

`src/choreography/compile.ts:305` — `naturalTime = (clock.impact - HEAD) /
clock.scale`, and `src/layout/layout.ts:63` — `x[i] = impact[i] * xScale`. So x
is affine in **performance time**, and `docs/choreography.md` says what
performance time is: every visible arrival gets the same beat, and "a quiet span
longer than three weeks is *replaced* by a whoosh of at most 0.9 s, whether it
covers a month or a decade". x is therefore *ordered* by date — which is the
real distinction from gitk and worth the boast — but it is not *proportional* to
date, and ticks are a claim about proportion.

Measured, per calendar year, in world units of stage width
(`x/ticks-review/spacing.mjs`, `px.mjs`, from the published `manifest.years` of
every shelf entry):

| entry | widest year | narrowest year | ratio | years occupying < 0.05 s of runtime |
|---|---|---|---|---|
| python/cpython | 467,767 u | **5.5 u** | **213,610 : 1** | **22 of 36** |
| nodejs/node | 42,399 u | 7.6 u | 8,231 : 1 | 11 of 17 |
| facebook/react | 181,192 u | 30 u | 6,086 : 1 | 1 |
| public-apis | 125,967 u | 21 u | 5,887 : 1 | 3 |
| chromium | 26,451 u | 24 u | 1,124 : 1 | 3 |
| rust | — | — | 504 : 1 | 0 |
| llvm | — | — | 107 : 1 | 0 |
| Linux, Kubernetes, VS Code, TensorFlow, mdBook | — | — | 5–31 : 1 | 0 |

CPython's 1990–2005 are **5.5 world units each**. At the zoom the app actually
plays at (`worldW` about 2,540 for a 1600 px viewport, measured), that is
**3.5 px per year — sixteen years inside 56 px**. Node's 2016–2026 are 7.6 units
each: eleven years inside 53 px at playback zoom, 8 px at the tableau.

So "pick the largest unit whose spacing is at least ~120 CSS px" has no
well-defined input. Spacing is not a number on this axis; it is a function that
varies by five orders of magnitude across one history, and by a factor of
thousands *within a single screen* near a compression boundary. A single global
interval is wrong at both edges of the same frame.

### 2b. Two time scales already disagree, and ticks would make it three

Risk 2 says the scrubber and the stage "cannot disagree about *position*"
because they share `mapMonotone`. True, and irrelevant: they disagree about
**labelling**, which is all a viewer sees. The scrubber lays `t/duration` on a
fixed strip and culls labels at 46 px; the stage lays the same warp under a
moving camera and would cull at 120 px. Measured at Node's final frame
(`x/ticks-review/proto/nodejs-node-099-ticks.png`):

- scrubber's rightmost year label: **2015** (6 labels drawn of 17 possible)
- the prototype's only stage tick: **2020**
- date hero: **September 2026**

Three readouts, three answers, all "correct". CPython's scrubber, for a history
the top bar labels "1990–2026 · ENTIRE REPO", paints exactly **two** year labels
— 2016 and 2021, both in the right-hand third
(`x/ticks-review/shots/strip-python-cpython.png`). Adding a fourth scale to that
is not adding a reference.

### 2c. Built, and looked at: it is invisible, and on the worst case it is absent

I patched a copy of this build to draw the proposal exactly — ladder
`decade -> 5 years -> year -> quarter -> month`, 120 px minimum, 1 px
full-height line, `0.055` base / `0.085` on year boundaries, `0.30` 10 px
labels, `energy` taper, future marks at 45 % — and ran it against the real shelf
under the real origin (`x/ticks-review/proto.mjs`; images in
`x/ticks-review/proto/`).

Differencing each ticks/bare pair column by column over the stage band
(`x/ticks-review/diff.mjs`):

| frame | columns changed | strongest added luminance (of 255) |
|---|---|---|
| nodejs/node 99 % | 2 | 8.0 |
| facebook/react 99 % | 2 | 7.9 |
| nodejs/node 25 % | 2 | 4.8 |
| rust-lang/mdBook 60 % | 2 | **1.0** |
| facebook/react 25 % | 2 | **1.0** |
| facebook/react 60 %, 90 % | **0** | — |
| **python/cpython, all four depths** | **0** | **nothing drawn at all** |

Never more than **two pixel columns** on a 1600 px stage. Peak added luminance
between **1 and 8 levels out of 255** on a near-black field with bloom over it —
at the low end, below what an 8-bit channel can reliably show. And on CPython,
the largest and most warped history I tested, the ladder finds no interval that
satisfies the 120 px rule and the feature simply does not appear
(`x/ticks-review/proto/python-cpython-060-ticks.png`: a stage with no marks on
it, under a scrubber carrying two labels for thirty-six years).

The weights are also mis-cited. "`rgba(230,225,214,0.055)` — about half the
weight of the existing dormancy band on the scrubber, which is `0.05`." 0.055 is
110 % of 0.05, not half of it. The calibration argument rests on a number that
is arithmetically backwards.

Cost, since the proposal asks for it to be measured (`x/ticks-review/cost.mjs`,
5 s of playback, render profile on): the pass adds **0.24 ms/frame** on mdBook
(`background` 0.155 -> 0.395) and **0.19 ms** on React, taking the total frame
from 1.8 -> 2.0 ms and 2.0 -> 2.5 ms. Small in absolute terms; it more than
doubles the background pass, for two visible columns. And that is with the
ladder search re-run every frame, which the specification neither forbids nor
caches — on Linux's tableau the month rung alone is 250 boundaries times five
rungs of binary search per frame.

---

## 3. Should ticks be drawn for dates the performance has not reached?

**No. Draw the axis only up to the playhead. This is not a close call on this
app.**

The proposal frames it as ruler-versus-ink and leans toward "it is an axis, not
history". The analogy fails here, and it fails for a reason specific to
GitTimeline rather than a matter of taste:

**On this stage, the position of a future tick is made of commits that have not
been revealed.** `mapMonotone(timeMap, Date.UTC(2020, 0, 1))` is not a geometric
constant. `timeMap` is built in `src/choreography/compile.ts:496` from the
presentation timestamps of the nodes themselves, and where January 2020 lands is
a function of how many commits arrive between now and then, how many merges, and
how much dormancy gets compressed into a 0.9-second whoosh. A ruler whose
graduations are evenly spaced by construction carries no information about the
thing it measures. This one's graduations *are* the thing it measures. Draw the
2020 mark in February 2016 and you have told the viewer, precisely and
quantitatively, how much history is left and how busy it is — the one thing a
timelapse exists to deliver in order. That is not an exception to "nothing is
drawn before it happens"; it is the invariant's central case wearing a different
hat.

Three supporting reasons:

1. **The future half of the axis has no job.** Its stated purpose is to let the
   viewer "see that the threads ahead are still inside February". Measured
   (section 1d), there are no threads ahead: ink beyond the drawn head is 4–9
   columns and it is the MAIN nameplate. The situation future ticks are for does
   not arise during playback. It arises at the tableau — where the picture is
   already finished and every tick is a past tick anyway.
2. **The "make it visibly fainter" mitigation cannot be rendered.** Measured,
   past ticks land at 1–8 luminance levels out of 255. Forty-five percent of
   that is 0–4. A distinction the panel cannot show is not a distinction shown;
   it is a distinction assumed, which is the thing the proposal says it wants to
   avoid.
3. **Ending the axis at the playhead is free information.** A ruler that stops
   where the history stops marks the head a second time, in a second visual
   language, at no cost — which is closer to what the complaining viewer was
   missing than a mark labelled 2027.

---

## 4. Changes required before this could be approved

**R1 — Fix the final-frame date: gate the travel readout on the viewer.**
In `src/app/ExploreBar.tsx`, `store.travelAt` is set from a
`requestAnimationFrame` loop as soon as `performanceEnded()` and
`visible < 0.995`. On every streamed entry that fires with no user input,
because the camera's zoom floor (`src/renderer/canvas.ts:995,1034`) prevents the
tableau from ever showing the whole picture. Set `travelAt` only once the viewer
has actually taken the camera (`renderer.manual != null`, already exposed as
`__gittimeline.manualCamera`) **or** moved the explore slider (`onInput`). Until
then the hero stays on `player.historicalAt(t)` and reads the last commit's
date, which is what the timeline slider already says.

*Test to add:* for every catalog entry, at `t = duration` with no interaction,
`[data-testid="date-hero"]` must name the same month as the date in the
timeline's `aria-valuetext`. Today that assertion fails by 14.00 / 12.67 / 11.25
/ 6.43 / 5.50 years on Node, CPython, React, Chromium and mdBook, and passes
only on `#demo=1`.

**R2 — Decide the pacing question first.** A calendar axis over a plan where 22
of CPython's 36 years occupy 0.05 s of runtime and 5.5 world units of stage is
an annotation of a defect. This is the open item already recorded as "shelf
pacing is uneven". Ticks cannot be evaluated until it is settled, because the
answer changes what the axis would look like on more than half the shelf.

**R3 — If a time reference is still wanted after R1 and R2, it needs a different
mechanism, and the proposal must say which:**

- Interval chosen **per screen region**, not globally. The proposal's own ladder,
  run on real frames, yields 0–2 marks and nothing at all on CPython.
- An explicit **compression mark** where the axis is near-vertical (the 0.9 s
  whoosh boundaries are already known to the compiler), because the honest
  message at Node's right-hand edge is "eleven years live in these eight pixels",
  and no density of tick marks says that.
- **One labelling policy** shared with `Timeline.tsx:yearTicks()`, so the strip
  and the stage cannot name different years — today: 2015 versus 2020 versus
  2026 on one frame.
- Weights re-derived from a measurement rather than from the mis-cited 0.05.
  Anything under about 8/255 of added luminance on this palette is not
  furniture, it is nothing.
- A cached ladder decision, not a per-frame search.

**R4 — Correct the record in the proposal.** The "109 px of ink beyond the drawn
head" is the MAIN nameplate (measured: 4–9 columns past the plate). Risk 5,
"`historicalAt` is wrong on a windowed plan", is disproved; the real defect is
elsewhere and R1 names it. Risk 4, "The tableau", is moot for the shelf: there
is no closing wide shot on a streamed entry, only a 16,000-unit window on the
middle of the history.

---

## 5. What is weak about this review

- **Coverage.** I reconstructed full-resolution maps for four entries (mdBook,
  Node, React, public-apis) and probed five in the browser. I did **not** decode
  Linux (1,440 time pages) or Kubernetes, and both are large enough that
  something could behave differently there. The spacing table for all twelve
  entries comes from `manifest.years`, which is exact but only at year
  resolution.
- **One machine, one viewport.** Everything is 1600x900, Chromium, one GPU, one
  network. The 120 px threshold and the luminance numbers are display-dependent;
  on a brighter panel or a different DPR the ticks might read better than they
  did here. My "invisible" claim is pixel values plus my own eyes on the
  screenshots, not a study.
- **My prototype is my reading of the spec.** Where the proposal is ambiguous —
  what "spacing" means on a nonlinear axis, whether the ladder is evaluated
  against visible boundaries or all of them, where exactly the label baseline
  sits — I chose, and my choices are part of why the result is thin. A different
  reading of the same three paragraphs would produce a different picture. That
  ambiguity is itself one of my findings, but it means "I built it and it did
  not work" is weaker evidence than "it cannot work".
- **I did not test the case that might vindicate the idea.** On Linux,
  Kubernetes, VS Code, TensorFlow and mdBook the year-width ratio is 5–31:1 and
  an axis would be close to uniform. A proposal scoped to *those* entries might
  survive; I judged the whole shelf and rejected on the half that breaks.
- **The final-frame number is not deterministic.** The live build gave the same
  five values on two independent runs, but the patched dev build gave three
  different ones (11.7 / 6.6 / 0.1 yr). So "fourteen years on Node" is a real
  observation on the shipped build, not a constant of the code. What is constant
  is that the hero stops describing the playhead; how far off it lands depends
  on where the tableau comes to rest.
- **One contaminated sample.** An mdBook seek in `probe.mjs` raced the loader and
  produced a "Superseded seek" dialog
  (`x/ticks-review/shots/rust-lang-mdBook-0950.png`); I discarded the -5.83 yr
  reading from it rather than rerunning that one cell.
- **I have not proved R1's fix works,** only located the mechanism precisely. I
  changed nothing in the app, so the gate I am asking for is a hypothesis about
  the cure, not a tested one.
