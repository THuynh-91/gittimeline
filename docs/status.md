# Where GitTimeline stands, and what needs work

Last revised 2026-09-08. Everything here is either measured or read in the
source at the commit named beside it. Where something is inherited from an
earlier note and has not been re-checked, it says so — a stale list is worse
than a short one, because it spends attention on things already fixed.

This supersedes `x/ROADBLOCKS.md`, about a third of which had been fixed by the
time anyone read it again.

---

## 0e. FIXED: the caption disagreed with the date above it, and it was one flag — 2026-09-08

`opts.seek` does not mean "this is a seek". It means **"move the playhead when
this window lands"**, and `prepareCatalogWindow` was reading it as the first:

```
const seeking = opts.seek !== false && !player.playing;
if (seeking) captionPtr = 0;
else captionPtr = perf.events.findIndex(e => e.performanceImpact > t);
```

`player.beforeSeek` — the one code path that is unambiguously a seek — passes
`{ seek: false, jumped: true }`, and it passes it **because** the clock has
already been moved and must not be moved twice. So `seeking` read `false` for
every scrub of a streamed history, the walk was planted at the first event
*past* the playhead, and from there it could only ever describe moments after
`t`. It never described the moment being asked for, on any frame, ever.

Fixed by asking the state instead of the caller: the walk restarts from the
beginning whenever the sentence on screen is not already inside
`CAPTION_RECENCY` of the clock, and keeps its position when it is. That gets
the ordinary refetch right for the same reason it always did — no
re-announcing history the viewer has been told about — without depending on a
flag that answers a different question. The `want === held` test also compares
`id` now, because a window swap replaces every event object and reference
equality alone announced a re-derived caption a second time.

Measured on this build before the change, Kubernetes paused at 45% with the
covering window resident: `captionPtr` 452 of 727 events — exactly
`findIndex(impact > t)` — 209 eligible events at or before the clock, and the
walk consuming **none** of them. 79 calls to `updateCaption` over 3.3 s, all
returning at `want === held`. Running the clock for 700 ms moved `t` past
event 452 and the caption corrected itself in one frame, which is why this
looked like a race for two days and why polling could not see it.

After: ten of ten scrubs of Kubernetes land in the same calendar **month** as
the hero (2015-03, 2015-12, 2016-09, 2017-06, 2018-04, 2019-04, 2020-05,
2021-11, 2023-10, 2025-10), and three of three on Linux. Guarded by
`tests/e2e/streamed-caption.spec.ts`, which fails at **nine of nine** samples
against the old decision, 9 to 24 months apart. It compares months rather than
years deliberately: three of the ten pre-fix samples were inside a year of the
hero on the calendar, so a year-granularity assertion would have passed on
three of the ten samples it was written for.

Only reachable on a streamed history, which is why the suite was green:
`beforeSeek` returns early without fetching when the target is inside the
loaded window, so a whole plan — the demo, a fixture, a pasted URL — never
took the branch that planted the pointer.

**The era label is not stale, and that lead was wrong.** §0c named it as the
strongest remaining thread, on the grounds that Kubernetes reads `formation`
from 5% to 85% and only changes at 95%. Read out of the published manifest,
Kubernetes has exactly **two** eras: `formation` from 0.0% to 94.6% of the run
(2014-06-06 to 2025-09-20) and `merge-heavy period` from 94.6% to 100%. The
readout was reporting the plan correctly at every one of those points. There
was no common cause upstream, because there was no second symptom. What is
true is that `detectEras` finds one regime across eleven years of Kubernetes
and calls it "formation", which is a poor label for 2014-2025 — an
`analysis/activity.ts` question about era detection, not a staleness bug, and
not fixed here.

Also corrected: `x/caption-lag.mjs` and `x/cap-diag.mjs` waited on
`buffering === false`, which `store.buffering` recomputes in the frame loop —
so the first ask after a seek returns the value from *before* it and the wait
falls straight through onto the previous scrub's plan. Three of ten reads were
looking at a stale window for that reason and not because of this defect. The
settle condition is "the plan in hand covers the clock".

## 0f. FIXED: "3 branches open" was a count of a different moment — 2026-09-08

`proposal-picture-and-claim.md` §7 recorded "**3 branches open** at 90% of
Linux, down from 355 at 75% with 2,317 nodes still resident. Not plausible."
It is reproducible to the digit, and the count was never the problem.

`DateBar` counts `perf.threads` at `t`. Across a streamed seek those two
belong to different moments: `store.perf` holds the window for where the
viewer *was* until the new one lands, so every thread in it that merged
between the old time and the new one reads as closed. The number does not go
stale, it collapses. Polled every 150 ms from the seek rather than after it:

```
Linux        75%    1 for 2.7 s, then 355      (1 hides the readout entirely)
             90%    3 for 2.7 s, then 426
             95%    2 for 2.7 s, then 119
Kubernetes   75%    1 for ~1 s,  then 113
             90%    4 for ~1 s,  then 107
             95%   15 for ~1 s,  then  72
```

Every settled value is plausible; only the interval was wrong, which is why
this read as a bad count rather than a bad moment. Fixed by gating the readout
on `store.buffering` — already derived once a frame as "the stage cannot draw
the moment the clock is on", which is exactly the condition under which this
arithmetic is meaningless. Untouched on a plan held whole, where `buffering`
is false throughout, and rare during playback, where a page is pre-swapped
before the clock reaches it.

The same shape as §0e: a fresh clock read against a stale plan. Two symptoms,
one habit — and the reason both went unnoticed is that every instrument in
`x/` waited on `buffering === false`, which returns the pre-seek value on the
first ask.

## 0d. The frontier clip was not airtight, and MASTER never leaves the frame — 2026-09-08

Two things `proposal-picture-and-claim.md` §7 left open, both settled by
measurement.

**Two definitions of "main's head" — resolved, and the frontier is the right
one.** The camera's head band composed around `spineTip`, the drawn end of
main's stroke; `presentAudit` reported `spineHeadNode`, the newest landed
commit; and `render` had a third copy of the same search inline. Before the
frontier clip both were right about different things. After it only one is:
`drawPolyline` clips every stroke at `min(playhead, main's newest commit)`, so
the stroke from the head towards the commit after it **is not drawn at all**,
and the eased tip was describing ink that had been clipped away — the camera
composed around a point with nothing at it and the nameplate stood 50 px right
of *that*. There is one search now (`spineHead`), one frontier (`frontierX`),
and `spineTip` is clamped to it, so the two numbers are equal by construction
while `MAIN_FRONTIER` is on. On the demo they differed by 60 to 147 world
units before the clamp; `present.spec.ts` now asserts the identity and fails
three ways without it.

**MASTER does not leave the frame.** The −4030 px reading in §7 is not
reproducible: over 3 points on streamed Kubernetes, 3 on the demo and 16 on
four fixtures, `mainHeadScreenX` is **1376 px of a 1600 px frame at every
single sample** — 86.0% of the width, which is the low edge of the head band
(`width * 0.86`). The camera holds it there and nothing observed moves it.
`present.spec.ts` now asserts main's head is on the frame at every sample,
so the claim is checked rather than assumed.

**The clip was not airtight. Four passes went round it.** `MAIN_FRONTIER`'s own
comment called it impossible for anything to be drawn past MASTER, and
`presentAudit().overhang` could never have contradicted it: overhang counts
nodes *eligible* to be drawn, so it reads **0** on a frame with a spark, a
merge ring and an energy trail all lit past main's head. Reading the canvas
back is what found it:

- **bodies** — the travelling spark. Bounded by the playhead through
  `travelU` and by nothing else. **15 performers drawn right of main's head on
  streamed Kubernetes at 25% of its show**, 7 at 50%, 1 at 75%, the furthest
  49 px past MASTER.
- **impact effects** — the merge ring, wave and spokes, anchored on a commit
  that might itself be past the frontier.
- **live tip beacons** — the pulsing ring on an unmerged branch, which is
  precisely the object most likely to sit past main's head.
- **`drawPartial`** — the contributor energy trail, whose comment said it did
  "the same clipping `drawPolyline` does" and which clipped against the view
  window only. Drawn under `lighter` compositing, so it was the brightest of
  the four: bright ink 164 px past the frontier on `03-two-parallel-threads`
  at 20%, with `overhang` at 0.

All four now drop anything anchored past the frontier, the same way the node
pass drops a commit. Measured at 1600×900 with labels off, as pixels past
`frontierScreenX` at a channel maximum above 80, over four fixtures at four
points each:

```
before   223 223 223 169 114  89  87  81  76  73  40  15  14  12   5   2
after     15  13  12  11  10   9   9   9   7   6   6   6   6   5   4   2
```

**The residual is not zero and cannot be.** The commit *at* main's head is
drawn, and it is a disc with a radius and a halo, so its right half is
legitimately past the line its centre sits on. 2 to 15 px is a glyph radius.
`present.spec.ts` bounds it at 28 px, which every sample clears after the fix
and ten of sixteen fail before it.

Labels are turned off at the setting for that measurement rather than excluded
from the scan. MASTER's nameplate stands `PLATE_GAP` — 50 px, now a named
constant that `presentAudit` reports — right of the head it names, and merge
captions 12 px right of their node; those are labels, not history, and a scan
that has to guess which rows to skip is exactly the trap `present.spec.ts`
declined to walk into the first time. With labels on, Kubernetes lights
pixels 156 px past main's head and every one of them is the text of a merge
caption.

**One instrument to distrust:** `window.__gittimeline.bodies()` places each
body linearly in time, while the renderer places it through `travelU`, which
eases. It over-reports how far a spark has travelled and it still reports
bodies past the frontier after the fix, because it describes eligibility and
not drawing. Use the pixels.

---

## 0c. The caption disagreed with the date above it — 2026-09-07

**Cause found and fixed on 2026-09-08; see §0e above for the mechanism, which
is not any of the six guessed at here.** Kept as written because the
eliminations below are sound and were what made the sixth findable — and
because the "era label is stuck too" lead in the last paragraph is false, and
a note that only says so somewhere else is a note that will be followed again.

Found by a review of the live build.

Reproduce with `x/caption-lag.mjs kubernetes/kubernetes --live` (reads the
caption **once** per seek; reading twice is what hid this). Live at 35% of
Kubernetes: hero `JUNE 2017`, caption dated `2014-06-28`. At 75%: hero
`NOVEMBER 2021`, caption `2017-06-21`. Linux at t=42336: hero `MAY 2026` over a
caption dated `2005-05-08` — twenty-one years apart, in the two lines a viewer
reads together. Ten consecutive scrubs, every one carrying the date of the
scrub before.

What is ruled out, with the measurement:

- **Not a race.** `x/caption-when.mjs` polls at 0, 100, 300, 700, 1200 and
  2500 ms after the seek: the caption is identical at every one. The hero on
  the same line corrects within 300 ms.
- **Not the plan.** `x/caption-which.mjs` at 35%: the last eligible event is
  `DIVERGENCE @5733.2`, dated 2017-06-14, matching the hero, and **twelve**
  eligible events sit within two performance-seconds of the clock. The right
  answer is present and available.
- **Not the rendering.** `DateBar.tsx:28` is `ev = store.caption.value`, a
  plain signal read, and the hero beside it updates from the same render.

So `store.caption` is holding an old value while `t` is correct, which means
`updateCaption` is either not running on this path or returning early on a
branch not yet identified. A sixth mechanism, after the five below.

Three fixes were made along the way. Each addresses a defect confirmed by
reading the code or the data, each is covered by the suites, and **none of them
resolves the above** — they are committed on their own merits, not as a fix for
this:

1. `MIN_CAPTION_MS` was not reset on a seek, so a scrub within 900 ms of the
   last caption could be suppressed and leave the previous sentence up.
2. The salience contest was unbounded in time. `captionPtr` rewinds to 0 on a
   backward seek, so the walk offered *the entire history up to t* as one batch
   and the loudest event anywhere in it took the line. Now bounded by
   `CAPTION_RECENCY` (2 performance-seconds) with the newest crossed event as
   the fallback.
3. The streamed window swap set `captionPtr` to the first event **past** `t`,
   which is right for a refetch and wrong for a seek: the walk is also the only
   thing that chooses a caption, so starting it past the playhead meant nothing
   was ever chosen for the moment requested.

Related and probably the same root: **the era label is stuck too.** Kubernetes
reads `formation` at 5, 15, 25, 35, 45, 55, 65, 75 and 85% of its run — through
October 2023 — switching only at 95%. `era` is computed from `t` directly
(`DateBar.tsx:27`), *not* from `store.caption`, so if both halves of that line
are stale the cause may be in `perf.eras`' boundaries rather than in the
caption walk at all. That is the thread to pull next.

## 0b. The closing sentence was never reaching the screen — 2026-09-07

Found by the first full Chromium e2e run against today's work, which is the
verification debt this file recorded. One failure: `fallback.spec.ts` ▸
"ultrawide layout and the final tableau", at the line asking the closing shot
to be captioned "Present day". Bisected rather than assumed — passes at
`43213c8`, fails from `751b7de`, which is mine from earlier today ("Show the
sentence that explains the date jumping years in one frame").

That commit replaced "keep the last event crossed" with "keep the most
salient". `REPO_PRESENT` — "Present day · N live tips" — is the last event in
every plan and had been winning by position. On the demo it sits at impact
67.11 with a `MAJOR_MERGE` at 66.81 above it on salience, so the closing shot
was captioned with a merge three seconds earlier and **the closing sentence of
the whole show never appeared at all**, by seek or by playing into it.

Fixed by ranking instead of special cases: `captionRank` puts `REPO_PRESENT`
above the two discontinuity captions (`QUIET_GAP`, `UNKNOWN_SPAN`) above
everything else, and `outranks` decides the contest, ties still going to the
later event as they did before. That also retires the `holdsFloor` flag, which
stopped anything later in a walk taking the line back. Both the caption floor
and the pending-caption queue now use the same ranking.

`concurrency.spec.ts` gains two tests. "The closing sentence is not in
competition" is a real guard — it fails at `751b7de` and passes now, at both
ways of arriving at the end. "A gap notice does not outrank everything that
follows it" is a property, not a regression: it was checked against `751b7de`
and **passed there too**, so no version is known to have failed it, and the
test says so in its own comment rather than implying a bisection it does not
have. What `751b7de` was for still holds — "a gap notice survives the frame it
was created in" passes.

## 0a. Resumed, and the viewer was right — 2026-09-07

**Merge strokes were being drawn in the future.** Candidates A (a labelled rule
at the playhead) and B (main's line carried dotted to the present) were built
behind a `showPresent` setting, and drawing A immediately disproved the claim it
was meant to communicate: ink carried on past the rule. Measured on the
streamed packages, bright ink reached the frame's right edge at **all six**
points sampled across Kubernetes' show, and at VS Code's overhang peak. Cause:
`travelU`'s merge easing sat above the diagonal — up to 0.0180 of the path
ahead of linear progress — which on a merge spanning a million world units put
the revealed prefix 7,600 px past the playhead. The second half of `48ca9d7`,
which bounded the path but left the clock reading it able to overshoot.

Fixed two ways: `travelEase` is now a pure exported function at or below the
diagonal everywhere, and `drawPolyline` clips every stroke at the present so no
future easing change can reintroduce it. `tests/unit/reveal.test.ts` asserts
the property at 2,001 points per kind per motion mode. Suite: 14 files, 186
passed, 1 skipped; `tsc` and `eslint` clean.

**This falsifies §1a of `proposal-present-and-parallel.md`** and, with it, the
explanation in 1e quoted further down this section. The overhang measurements
themselves stand — they were just answering a different question from the one
the screenshot asked. Full account, evidence and the list of falsified claims:
`reviews/strokes-in-the-future.md`.

Two things it opens: **35% of the frame is now empty** (bright ink stops at 65%
of the width and the rightmost lit object is MASTER's nameplate), because the
head band was calibrated against a picture that was drawing the future — the
same camera question Codex's closing-shot prototype is open on; and the
Kubernetes 40% frame carries the caption "51 commits converge" **ten times**
along main, every one the same number.

Still undecided: whether to keep B, which is now hard to judge because there is
barely a gap left for it to carry.

## 0. Paused here — 2026-09-07

Work stopped mid-investigation, deliberately. This section says exactly what
was in flight so it can be picked up without re-deriving it.

### In flight and interrupted

An assessment of `proposal-present-and-parallel.md` was stopped after a few
minutes. It wrote its harness to `x/rev3/` (`plan-analysis.mjs`, `patch.mjs`,
`serve.mjs`, `build.config.mjs`) and had begun writing to `x/rev3/out`. **It
produced no report.** One line came back before it stopped:

> "Zero overhang at the closing frame on the whole kubernetes plan."

**Resolved after the pause: the line is true, and it explains nothing.** Zero
overhang at the closing frame is the normal case — measured on whole plans
(vscode 0, react 0) and on the streamed window the app assembles at the end of
Kubernetes, where main's resident head is the newest landed node to the digit
(impact 16377.490, x 14028321, separation 0.000 s). The resident-window
artefact hypothesis is refuted, and the closing frame was the only place it
could have applied.

**Superseded by 0a: this is not what the viewer was seeing.** The overhang
below is real and measured, but the picture that produced the screenshot was
merge strokes drawn past the playhead, and main's head turns out to sit nine
pixels from the present rather than a third of a frame from it. Kept as
written because the overhang finding is still true and still worth showing.

What the viewer is seeing happens **mid-playback**, where the overhang is real:
up to 3,137 nodes on VS Code at 38.5% of its show, 383 on React, and **every
one of them on a thread that eventually merges** — no `tip`, no `dormant`. It
is committed work waiting on a merge. The camera deliberately keeps main's head
between three fifths and seven tenths of the way across (`canvas.ts:1452`), so
the 30-40% of frame between main's plate and the playhead is exactly that
in-flight work, with nothing marking either end of the gap. See
`proposal-present-and-parallel.md` 1d-1e.

The consequence of it being real rather than an artefact: the proposal's
candidate B — carrying main's line to the present, drawn so it cannot be
mistaken for commits — moves from "decoration with a bad precedent" to **the
viewer's request satisfied honestly**. No commit moves, main gains no commits
it does not have, and the in-flight work sits beside main instead of beyond
it.

### Open questions

`proposal-present-and-parallel.md` §6 listed six. **Question 1 is settled**, as
above; five remain.

### Two proposals awaiting a decision, neither implemented

- `proposal-main-line.md` — main as a reference. Two items shipped, two
  recommended, three rejected on measurement, six questions left open.
- `proposal-present-and-parallel.md` — mark the present; stop main looking
  overtaken. Written from a viewer's question that reframed the problem: the
  complaint is not that lines are hard to tell apart, it is that **the present
  is not marked anywhere on the stage**, so the only labelled landmark near the
  right — MASTER's plate — gets read as "now".
- `main-line-resolution-plan.md` — Codex's four-step plan. Supersedes this
  document's earlier recommendation to raise the `3.2` weight clamp, which was
  tested and does not work: Node stays at ~77 ms for 11.35 years because a
  quiet-gap rule overwrites the weighted step.

### One prototype exists and is not in the codebase

Codex's closing-camera change — six lines, applied by a build transform, in
`x/large-repo-camera-build.mjs`. It takes closing-shot lane spacing from
2.71–14.36 px to a flat 26 px across six viewports, measured over 48 samples.
It shows about 23% as much history in the closing frame as the current build,
so it trades coverage for legibility — the opposite trade from the closing-shot
work earlier the same day. Before/after images in `x/large-repo-browser/` and
`x/large-repo-camera/`. Two servers were left up for comparison and have since
been stopped.

It does **not** address branches running past MASTER, and by making the lines
distinguishable it makes them more prominent. Its anchor is `shot.maxX` — the
rightmost resident *node*, under a variable named `headX` — which is usually a
branch commit, so MASTER lands at about 65% of the frame rather than the
intended 90%.

### Verification debt

No full three-engine suite run covers everything committed on 2026-09-07. The
last complete run was 127 passed / 4 skipped / 0 failed and predates the final
several commits; browser-free gates (tsc, eslint, 180 unit, 27 worker) are green
as of the pause. Attempts at a full run were killed twice for host memory.

---

## 1. Blocked on a person, not on work

| | what | cost |
|---|---|---|
| **Credentials to rotate** | A GitHub PAT, a Cloudflare token, a Render key and a Codex setup token all reached a chat transcript. Separately, a classic `ghp_` PAT was found inside `x/sec4/probe1.mjs`, redacted without being read, and verified absent from every git ref — but a token that appeared in a working tree should be treated as disclosed. None are in the repository. | ~10 minutes |
| **Shelf pacing** | Chromium is 1.8M commits in 2.8 minutes; Linux is twelve hours. Node counts track *merges*, not commits, because the visible budget is per-thread — so a merge-light history sprints and a merge-heavy one crawls. Rebalancing means a `choreographyVersion` bump and a full republish: hours of CI, and a judgement about what these shows should feel like. | a decision |
| **The weakest three entries** | Chromium, LLVM and Node are each about 900 dots and under three minutes. They are the least representative things on the shelf and the most likely to be clicked first, because the names are famous. Retiring or recompiling them is the same republish as above. | a decision |
| **Dependabot ×6** | All six bump TypeScript to 7.0.2, and `typescript-eslint@8.69.0` does not support it. `main` is on 6.0.3 and unaffected. Nothing to do but wait. | none |

Sign-in and the Worker were on this list and are not now: the callback URL is
set, and the narrowed origin allowlist is deployed and verified (a request from
`/tri-huynh-portfolio/` on the shared origin gets a 400).

---

## 2. Open defects

Ranked by who they hurt. Each says whether it was measured today or carried
over unverified.

### Honesty — where the app says something that is not so

1. **The date readout and the timeline disagreed at the end of a run — cause
   found, and it was not the one on this list.** Measured on the deployed build:
   Node.js 14.00 years apart, CPython 12.67, React 11.25, Chromium 6.43, mdBook
   5.50; the built-in demo, the only plan on that list held whole, exactly 0.00.

   This list said "suspected: the mixed-resolution `timeMap` in a streamed
   assembly". **That is false and should not be investigated again.** Every
   published `time` page was downloaded and decoded to rebuild each entry's
   full-resolution map, then compared against the map the browser actually holds
   at 201 playhead positions per entry: **worst error 0.00 years** on all four
   entries tested. The page covering the playhead is always loaded and carries
   its own window at full resolution, so the coarse year marks only ever govern
   parts of the map nobody reads.

   The real mechanism: the closing tableau's zoom floor left `worldW` at 16,000
   against a history of 137,706 or more, so `ExploreBar` saw `visible ≈ 0.12`,
   fell through the `>= 0.995` guard written to prevent exactly this, and set
   `store.travelAt` **with no user input at all** — the caption said
   "Travelling the finished history". `DateBar` then dutifully reported the date
   wherever the camera was sitting, which on that build was the midpoint of the
   history. The readout was not miscalculating; it had quietly stopped answering
   the question it appears to answer. And the size of the error was whatever the
   tableau happened to settle on: the same measurement against a differently
   framed build gave 11.7 years on Node and 0.1 on mdBook, because there the
   guard happened to fire. A constant mechanism producing a coin-toss number is
   worse than a fixed error, not better.

   **This is almost certainly the viewer's original complaint** — "it doesn't
   make much sense to be in February and there are threads into the next year".
   At mdBook's untouched final frame the hero read March 2021 while the stage
   spanned about 1.1 calendar years. Threads into the next year, with a date
   naming one month of it. A bug in the readout, not a missing axis.

   *Status: believed fixed, on two independent grounds rather than a fresh
   five-entry measurement.* `27ee1a8` made the guard
   `!taken || visible >= 0.995`, where `taken` requires that somebody actually
   travelled or took the camera — so the spurious travel is unreachable
   regardless of how narrow the closing frame is, which is what made the old
   error entry-dependent. And the closing shot no longer parks at the midpoint
   (`8d79ded`). `catalog.spec.ts` asserts the date still describes the playhead
   at the end, and it fails when the guard is reverted, which was checked.

   The reviewer's numbers came from a deploy predating the first of those.
   Re-running their five-entry probe against HEAD was started and abandoned:
   it seeks a 53-minute history to its end over the remote shelf and had not
   finished in ten minutes. Worth doing when there is time to spare, but the
   guard being entry-independent is the reason this is not being carried as an
   open defect.
2. **The axis is runtime and the app never says so — the confusion that
   follows was reported, not hypothetical.** x is proportional to *runtime* and
   only ordered by date, so the date can move much further than the picture
   does. On Node.js the playhead reads May 2014 at 90% of the show and Sep 2026
   at the end: twelve years in the last tenth, most of it in one frame.
   Somebody watching that sees a date lurch with no explanation.

   Half of it was a display bug and is fixed. The app has always had the
   sentence — `QUIET_GAP`, "Quiet span of 11.4 years passes" — and it was never
   seen, for two reasons: a caption's dwell was however much runtime the plan
   gave the thing it describes, and Node crosses eleven years in 0.077
   performance-seconds; and the caption walk consumed every event up to the
   clock in one pass and kept only the last, so the notice was created and
   discarded in the same tick. Captions now have a 900ms floor, and a
   discontinuity notice outranks salience — measured, `QUIET_GAP` carries 0.3
   and was losing the line to a `REPO_BIRTH` crossed in the same frame.

   The other half is not fixed: nothing on screen says the axis is runtime
   rather than calendar. `docs/pacing.md` §3C, and it is the only item there
   that costs no republish. The rejected time-ticks proposal was an attempt at
   it — see `x/ticks-review/VERDICT.md` for why that particular answer was
   wrong. `docs/reading-the-stage.md` is the written explanation in the
   meantime.
3. **A streamed entry's closing shot cannot show the whole history**, because
   only a window is resident, and nothing on screen says so. The shot is now
   honest about what it is (the resident span, ending at the newest commit)
   rather than pretending to be the whole picture — but "the whole shape at
   once" is still a thing the app cannot do for twelve of its histories. See
   the packaged-overview idea below.

### Accessibility — where people are excluded

Nothing left on this list that has been measured. The three items that were
here — the scope dialog at 320px, the coverage badge disappearing at 200% zoom,
and the contrast of the quiet furniture — are in section 3 below, along with
five more that a review found while checking them.

### Playback

4. **Node.js gives 0.054% of its show to the decade from 2016**, and eleven of
   its years get under 0.05 s each. **CPython is worse** — 0.305% for 2018
   onward, twenty-two years under 0.05 s, and a 213,610 : 1 spread between its
   fattest year and its thinnest — and React's 2016-onward share of 29.4% is
   worse than Chromium's 71.2% or LLVM's 67.0%. Six of the twelve entries have
   no thin year at all.

   The cause on Node is **one aggregate**: `agg-0-462`, 36,848 members spanning
   11.35 years, worth at most 3.2 beats because `compile.ts:263` clamps
   `log2(memberCount) * 0.55` there. Its eleven "thin years" hold *zero*
   visible nodes and are `mapMonotone` subdividing a single 0.077-second gap
   between two consecutive commits. Full account in `docs/pacing.md`, including
   how the first version of that document got three figures wrong. Needs a
   republish — but raising the clamp is testable locally without publishing.
5. **A weak device is choppy, though no longer slow, and the bottom rung may
   be too low.** Measured before the render-scale rungs existed: Chromium at
   20x CPU throttling and 2x device pixels, 2.43 fps; WebKit on an iPhone 12
   descriptor, 3.55 fps; WebKit at 1280x720 and dpr 2, 5.65 fps. The ladder has
   five rungs now and the last two draw below CSS resolution — 0.75 then 0.6 of
   the window's pixels — which roughly doubled the frame rate at 8x throttling
   and cut p95 frame time about threefold.

   What is left is a device that spends every rung and is still at three to
   five frames a second. **And 0.6 is probably too low.** Measured at the same
   moment and camera: the 1px spine survives intact (peak 181.8 either way,
   3px full width) but lane-pair modulation collapses from 0.455 to 0.060 —
   87% — where lanes are five pixels apart, a difference of 2.7 levels out of
   255. The floor was justified on the lane glow and only the spine was
   checked.

   Partly addressed and not closed. The stroke-width floor was expressed in CSS
   pixels — `1 / v.scale` — so at a render scale of 0.6 a floored line landed on
   0.6 of a device pixel, below what a rasteriser can put down; it is a device
   pixel now, which is a no-op at one or two device pixels per CSS pixel and
   widens the floor only where the picture is undersampled. Measured effect:
   mean vertical luminance gradient over the stage at scale 0.6 goes from 1.834
   to 1.982, **8% better**. That is not a recovery of an 87% loss, and the
   measurement is not the same one: this averages the whole frame, and the
   finding measured two lanes five pixels apart. **The lane-pair measurement is
   still owed**, and until it is taken the bottom rung is a deliberate trade —
   a device that has spent every other rung is choosing frames over fidelity,
   and three frames a second is the alternative.
6. **Following a contributor: diagnosed, improved, and the improvement is
   unverified.** Reported as "select a contributor isn't too accurate to
   follow". The Help panel offers a list under "select one to follow their work
   through the structure", and focusing one dims the stage to 28% and keeps
   that person's work bright — except that it only ever tested a node's own
   `contributorIdx`, and nearly all commits are inside aggregated runs. The
   arithmetic, from the published manifests:

   | entry | commits | individually drawn | contributors | drawn per contributor |
   |---|---|---|---|---|
   | chromium | 1,817,062 | 923 | 15,832 | **0.058** |
   | llvm-llvm-project | 595,778 | 894 | 9,746 | **0.092** |
   | nodejs/node | 48,272 | 1,013 | 4,727 | **0.214** |
   | kubernetes | 140,858 | 125,973 | 6,048 | 20.8 |
   | rust-lang/mdBook | 3,293 | 1,220 | 405 | 3.0 |

   So on the three biggest entries most contributors cannot have a single node
   of their own on the stage. `AggregateSpan.contributorIds` has always listed
   everyone inside a run and was never consulted for focus, so their work was
   in the picture and only missing from the attribution. Focus now keeps the
   runs holding their commits bright, which needs no rebuild — the data is in
   the published plans.

   **What is not established is that this is what the complaint was about.**
   Three attempts to measure the visual effect all passed with the fix
   reverted and so tested nothing: lit-pixel counts cannot work because focus
   dims rather than removes; bright-pixel counts at a downsampled resolution
   cannot work because averaging destroys one-pixel lines; and bright-pixel
   counts at native resolution on a real entry cannot work either, because the
   ivory main line is never dimmed by contributor focus and puts a large floor
   under the count. Closing it needs the ability to pick a contributor who
   appears in some aggregate's `contributorIds` and on no node's own
   `contributorIdx`, which is not on the test surface today. The other two
   candidates from the original report — the 14-pixel hit test on landed dots,
   and moving sparks not being selectable at all — remain untested.

---

## 3. Is it smooth on other devices?

Yes, in the sense that mattered: **the show runs at the speed it says it does
everywhere it was measured.** 38 cells, one continuous run of at least 60
seconds each, sampled across three engines, seven viewports, device pixel
ratios 1 and 2, CPU throttling at 4x/8x/20x, spoofed 2-core and 2GB hardware,
the Pixel 5 and iPhone 12 device descriptors with touch, and four different
histories including a five-minute continuous run into the middle of Linux.

| | |
|---|---|
| Clock rate against real time | **0.92x to 1.00x.** 0.96 was the floor across the 38 cells; two later quiet runs inside the same grid read 0.924 and 0.930 per rung |
| Worst cell | Chromium, 2x device pixels, 20x CPU throttling: 0.9601x at 2.43 fps |
| Frames over one second | **0, anywhere** |
| Console errors | **0, anywhere** |
| Five-minute continuous Linux run, mid-history | 0.9929x, 17.9 fps, one buffering period |
| kubernetes, all three engines | 1.00x, 22 to 26 fps |

For comparison, the same conditions before the frame-clamp fix read 0.41x on
WebKit and 0.49x on Firefox — a history whose card said 2 min 43 taking 6 min
37. That is gone.

What is *not* fixed is the frame rate itself on the weakest configurations,
which is item 5 above. Real time holding at 2.4 fps means the show is honest
and choppy rather than dishonest and smooth, which is the better of the two but
is not the same as good.

Two caveats, because this is a partial run: the matrix was stopped early to
save usage, so the 300%-zoom cells and the memory-growth series were never
collected, and no reduced-motion or camera-still cell was measured. The raw
data is `x/dev1/results/main.jsonl`; the harness is beside it.

---

## 4. Fixed today, with the measurement that proved it

- **A private history is no longer written to the device.** `RepoProbe.isPrivate`
  had been declared, documented and carried out of the probe for exactly this
  purpose and never once read — so a private history was cached like any other
  and its slug went into the recents list the landing page paints in plain
  sight. `tests/e2e/private.spec.ts` reads IndexedDB and localStorage back and
  looks for the owner, the name, and every commit message, author and sha. It
  fails on the previous build.
- **The probe caches from the moment privacy is known**, rather than never.
  Only the first of its three calls — the one that answers the question — is
  uncached.
- **Signing in leads somewhere.** `#your-repositories` is a page, not a section
  at the foot of a consent document 406 pixels down a 1,400 pixel page with the
  demo legible through the rows.
- **The show no longer runs in slow motion.** The frame loop capped one frame's
  elapsed time at a tenth of a second, which is also ten frames a second, so
  below that the clock fell behind the wall: 0.41x on headless WebKit, and a
  history whose card said 2 min 43 took 6 min 37. Measured 0.28x at 2.8 fps
  before, 1.0x after. The background-tab jump the cap really existed for is
  handled on `visibilitychange`.
- **A 1x display can adapt.** `watchFrameRate` returned immediately unless
  `dpr > 1`, so a slow device reporting one device pixel — most desktops —
  could not adapt at all however badly it was doing. It steps resolution, then
  the bloom, then the dust.
- **The closing shot frames the ending.** Third attempt; the first two were
  measured on one entry at one size and were both wrong. See `8330fbe`.
- **The Inspector no longer calls every packaged commit a root.** `parentShas`
  comes from the ingested dataset and a streamed entry has none, so the absence
  was read as "no parents" and merges rendered as `none (root) · merge` —
  twelve histories, every commit.
- **The Events panel exists.** The canvas's alternative text has told every
  screen-reader user to "use the Events panel (E)" since the stage was written,
  and there was no panel and no key.
- **The e2e suite builds its own bundle.** `vite preview` serves whatever is in
  `dist` and `reuseExistingServer` skipped the build, so a green suite could be
  green against a build made hours earlier from a different commit. It was: a
  test for an API added minutes before failed with "not a function" while tsc
  and eslint were clean.
- **Two limits stopped being conflated in a comment.** `controller.ts` said the
  fetch width clamped to `[6000, 16000]`; it has been 48,000 since the stutter
  work. `MAX_VIEW_WIDTH` is how wide a frame may be and `MAX_FETCH_WIDTH` is
  how much may be held around it, and reasoning about the closing shot as
  though only 16,000 units were resident sent that fix the wrong way twice.
- **The suite stopped making noise.** Chromium and Firefox have launch
  switches; WebKit has none and was covered by a helper each spec had to
  remember to call, which two of fifteen did. That held until a spec that plays
  something was added to the WebKit project. Measured on the element the app
  actually uses: the track plays at volume 0.354 on all three engines
  regardless, and only two of them decline to pass it to the speakers. It is a
  fixture now, on every page on every engine, verified silent.
- **The repositories list stopped describing its own failures as facts about
  the reader.** A non-array answer rendered as "you have no public ones"; a
  list holding one `null` put "Cannot read properties of null" on screen; a 401
  asked for a token there is no box for while the app went on claiming to be
  connected; a 403 blamed the anonymous per-network limit on a page about the
  viewer's own allowance. Each has a sentence and, where there is something to
  press, a button.
- **And it stopped hiding things.** 300 repositories became "200", of which 60
  were drawn, with no sentence admitting either bound. `size: 0` — disk usage
  in kilobytes, rounded down — was being read as "no commits", so a new
  repository with a README silently did not exist.
- **The privacy promise is legible.** `--text-faint` measured 2.62–3.24:1 and
  was carrying the one sentence the page exists to make.
- **A repository that becomes private comes off the device.** The guarantee was
  evaluated once, at fetch time, so one watched while public and then made
  private kept its dataset, its cached pages, its name on the landing page, and
  replayed with no token at all. A network failure is deliberately not an
  answer.
- **A private repository stopped transmitting its size**, labelled "a public
  repository". `analytics.ts` declares the branch that withholds it and
  documents why; nothing passed it.
- **The scope dialog at 320px, the coverage badge at 200% zoom, and the other
  scope dialog** — which had no `aria-modal`, no focus trap and no way out but
  one specific button, on the private-repository path.
- **The unit suite stopped failing for being busy.** Three tests compile whole
  histories and were losing to Vitest's five-second default whenever anything
  else was running. Three times today a green suite and a red suite differed
  only in what else was on the machine.

---

## 5. Ideas worth deciding on

**A packaged whole-history overview.** A streamed entry can never show its real
shape, because only a window is resident. A decimated skeleton of the whole
history — about 16KB, written at packaging time — would let the closing shot be
the shot it claims to be. Costs a republish, and raises a real question this
project has to answer rather than dodge: is a decimated shape still "honest
topology", or is it a picture of something that never existed?

**Background time ticks — proposed, reviewed, and rejected.** The idea was
faint calendar marks behind the stage, at a zoom-chosen interval, to supply the
time reference a chart with no axis is missing. A reviewer built it exactly as
specified, ran it against the real shelf, and rejected it on four measured
grounds. Full report: `x/ticks-review/VERDICT.md`.

- **x is proportional to runtime, not to the calendar**, and ticks are a claim
  about proportion. Per-year width across one history varies by up to
  **213,610 : 1** (CPython), and 22 of its 36 years occupy under 0.05 s of
  runtime. CPython's 1990–2005 are 5.5 world units each — sixteen years inside
  56 px at playback zoom. "The largest unit whose spacing is at least 120 px"
  has no well-defined input when spacing varies by thousands *within a single
  frame*.
- **It would be a third disagreeing time scale, not a reference.** At Node's
  final frame the scrubber's rightmost label read 2015, the prototype's only
  stage tick read 2020, and the date hero read September 2026 — three readouts,
  three answers, each correct by its own rule. CPython's scrubber paints two
  year labels for a history the top bar calls "1990–2026 · ENTIRE REPO".
- **Built and looked at, it is invisible.** Differencing tick/bare frame pairs
  column by column: never more than **two pixel columns** changed on a 1600 px
  stage, peak added luminance **1 to 8 levels out of 255** on a near-black field
  with bloom over it. On CPython, at all four depths tested, the ladder found no
  qualifying interval and **nothing was drawn at all**.
- **And the calibration argument was arithmetically backwards** — the proposal
  described `0.055` as "about half the weight" of an existing `0.05`.

The goal is still worth keeping; this specification is not buildable as written,
and building it first would have been building on top of the date bug above,
which is what the complaint that motivated it actually was.

**~~Speculative prefetch~~ — already built; this entry was stale.** It read
"the worker cancels its previous request on every message, so the next window
cannot be warmed while the current one plays". `catalog.worker.ts` has carried
`warmAbort` as its own controller since the stutter work, under a comment
titled "a speculative fetch, running beside the live one instead of replacing
it"; `CatalogSource.warm()` exists and `controller.ts` calls it. The other half
of the entry stands: a second worker was investigated and is not the answer — a
warmed page answers in 100ms and a cold one also in 100ms, because the cost is
plan assembly and structured clone rather than fetching, so a second worker
would duplicate the cache and help nothing.

**Precomputed demo artifacts**, so a visitor can watch a large repository
without a token at all.

**Two costs nobody is paying attention to.** The repositories list is
re-fetched on every visit — three visits, three calls, and the spinner replays
each time — with no memoisation. And a public repository's metadata is fetched
twice per visit: the probe's first call is deliberately uncached, for a reason
that is sound, while the ingest client writes the same URL into the cache and
then the probe ignores it next time. Neither is a defect; both are waste with a
known cause.

---

## 6. How to test this without lying to yourself

Written down because every wrong claim in this project's history came from one
of these, and most came from the first two.

- **One entry is not the shelf, and one viewport is not a screen.** The closing
  shot was called fixed twice from a single entry at a single size, and was
  wrong both times in a different way. Twelve entries, four shapes.
- **"Not blank" is not "correct".** The second wrong closing shot drew 151
  nodes a frame. It was a healthy-looking picture of the middle of the
  repository with the ending off screen.
- **A test that cannot fail proves nothing.** Revert the fix and watch the test
  go red before believing it. Two tests in this repository were passing against
  behaviour they did not exercise.
- **Read pixels from a frame that is paused and settled** — `pause()`, wait for
  `buffering` to clear, wait 700-1400ms, then three `requestAnimationFrame`s.
- **This repository asserts two contradictory things about *how* to read them,
  and one of them is misdirecting every future measurement.** This list said
  "never `page.screenshot` or `canvas.toDataURL`; both hang above about 40k
  nodes — use `drawImage` into an `OffscreenCanvas`", while
  `tests/e2e/stage.spec.ts` does the opposite and explains why: "`drawImage`
  never returned on Linux's 332,279 nodes … `toDataURL` does."
  `large.spec.ts` and `focus.spec.ts` side with the doctrine. They cannot all
  be right, and the contradiction survives because `stage.spec.ts` runs on the
  177-commit demo where either method works. Settling it needs both tried on
  Linux, which nobody has done. Until then, expect whichever you pick to hang
  and have the other ready.
- **Assert what you loaded.** `window.__gittimeline.source` beside every
  measurement. One probe measured the demo for an hour while labelling it
  Linux.
- **Never measure timing next to another browser.** Five separate false
  failures in this project were another process on the machine.
- **Do not read a number through the thing you are testing.** The mute fixture
  faked the `volume` getter to 0 and refused the setter, so the element played
  at 1.0 while answering 0 to the probe that was verifying it. A fresh realm is
  no escape either: `addInitScript` runs in child frames, so the fake follows
  you. Assert the accessor is native code before trusting what it says.
- **Headless WebKit dies under sustained main-thread blocking.** "Target
  crashed", reproduced four times, in any test that busy-waits inside
  `page.evaluate` for tens of seconds. Not an app fault, but it means that
  technique covers two engines and not three.
- **Six-second samples test densities, not accumulation.** Twenty of them at
  twenty depths says nothing about what twelve hours does to the heap or to the
  1,440 page boundaries a full run crosses.
