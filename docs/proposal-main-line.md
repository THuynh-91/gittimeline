# Proposal: make the main line legible

Status: **open — decision wanted.** Written 2026-09-07.

Two things in this document are settled and shipped, two are recommended and
unbuilt, three are rejected with the measurements that rejected them, and the
last section is deliberately empty of answers. Every number here was measured;
where a figure was later refuted, both it and the refutation are kept, because
several of the wrong ones were wrong in an instructive way.

Evidence lives in `docs/reviews/`.

Follow-up, 2026-09-07: the [controlled clock investigation](reviews/main-line-clock-investigation.md)
found that removing the aggregate weight ceiling alone leaves Node's eleven-year
transition at approximately 77 milliseconds. A quiet-gap rule overwrites the
aggregate weight. The [resolution plan](main-line-resolution-plan.md) recommends
correcting activity classification and temporal aggregation, alongside closing-shot
legibility. These are investigated recommendations, not shipped changes; the
original proposal below is retained as the record that prompted the experiment.

---

## 1. The problem, as reported

Three separate reports, over several days, from someone using the app:

> "MASTER is being surpassed."

> "It doesn't quite make much sense to be in February and there are threads
> into the next year."

> "The date at the bottom shows September 2023 for example. Is that the date of
> the master or the branches?"

All three are the same underlying complaint: **the viewer cannot tell what the
picture is claiming.** They are not reports of a crash or a wrong pixel. They
are reports that the thing is unreadable, which for a visualisation is the more
serious category.

## 2. Evidence

### 2a. What the date actually describes

`DateBar` reads `player.historicalAt(t)` — the **playhead**, the moment the
show has reached. The node pass refuses anything ahead of the clock
(`canvas.ts:1830`, `if (nd.impact > t + 0.001) continue`), so the playhead is
the rightmost ink in the frame. The date is therefore the date of the *frontier*:
neither master's nor the branches', and everything visible landed on or before
it.

Nothing on screen said so. **Fixed** — the hero now carries "the show has
reached".

### 2b. Main is behind far more often, and by far more, than the record claimed

This project's own note said main runs 0–2 commits behind and used that to kill
a proposed readout. Sound method, three sample points, two entries. Measured
exhaustively over all twelve published plans:

| entry | worst case ahead of main's head | p90 |
|---|---|---|
| microsoft/vscode | **3,275 nodes / 441 s** | — |
| torvalds/linux | 637 | 45 |
| facebook/react | 399 | — |
| rust-lang/rust | — | 18 |

And **something is drawn to the right of main's head for 53–88% of every show**
on ten of the twelve entries. So the viewer was describing the common case.

### 2c. x is not the author's clock, and "it would be dishonest" is not available as an argument

x is **presentation time**: author dates rewritten until they respect ancestry,
so a child is always drawn right of its parent. `tests/unit/shared.ts` asserts
`child.x > parent.x` on every edge of every fixture.

| | commits whose stamp moves > 1 day |
|---|---|
| torvalds/linux | **734,221 of 1,481,850 — 49.5%** |
| nodejs/node | 22,392 of 48,272 — 46.4% |

The picture already draws commits at times they did not happen, by design, with
a test guarding it — because a rebased or cherry-picked commit carries a date
that would otherwise place it before its own parent. This is the right choice.
It cannot be used to refuse a layout change.

### 2d. Main is already a ruled horizontal line

| | |
|---|---|
| world y of the spine | **exactly 0** — all 57,344 Kubernetes spine nodes, all 2,393,812 points of its spine edges |
| screen y over a 4½-hour performance | **493–494 px** (403–404 at 1440×900, 263–264 at 1855×620, 403 exactly on CPython) |

"Draw main as an axis" is already what happens. The only thing an explicit rule
would add is extent *past main's head*, which is the falsehood `48ca9d7`
removed.

### 2e. Lane fusion — the measured cause of "surpassed", and it moved

`MIN_LANE_PX = 26` now floors the zoom during playback: a flat 26.00 px at
1855×620 for a whole performance. **The closing tableau is deliberately exempt**
(`canvas.ts:1422`), and that is the frame a viewer looks at longest:

| entry / window | px between lanes, settled at the end |
|---|---|
| kubernetes @ 1920×1080 | 12.89 |
| kubernetes @ 1440×900 | 10.23 |
| **kubernetes @ 1855×620** | **6.10** |
| cpython @ 1600×900 | 13.28 |
| mdBook @ 1600×900 | 17.09 |

6.10 px is 2.7× tighter than the 16.4 px previously called the worst case. At
that spacing, plus each line's glow, two lanes do not read as two — which is
what "a line running past main" has twice turned out to be.

### 2f. The axis is runtime, not calendar, and this is where the date jumps come from

Every visible arrival gets the same beat; a quiet span over three weeks becomes
a whoosh of at most 0.9 s. So equal distances are not equal time. Measured
per-year spread within one history: **213,610 : 1** on CPython.

What that does to a viewer, on Node.js:

| playhead | reads |
|---|---|
| 90% through | **May 2014** |
| 100% | **Sep 2026** |

Twelve years in the last tenth of the show, most of it in one frame. Cause:
`agg-0-462`, a single aggregate of **36,848 commits spanning 11.35 years**,
worth at most 3.2 beats because `compile.ts:263` clamps
`log2(memberCount) × 0.55` there. The eleven "years" in between hold *zero*
visible nodes; the runtime they appear to get is `mapMonotone` subdividing one
0.077-second gap. Full account in `docs/pacing.md`.

The app has always had the sentence that explains this — `QUIET_GAP`, "Quiet
span of 11.4 years passes" — and it was never seen: 0.077 s of dwell, and the
caption walk kept only the last event crossed in a frame. **Fixed** — captions
have a 900 ms floor and a discontinuity notice outranks salience.

## 3. Shipped

- **The date says what it is a date of.** "The show has reached."
- **The gap sentence is visible.** 900 ms caption floor; `QUIET_GAP` and
  `UNKNOWN_SPAN` outrank salience, because they are the only captions that
  explain a *discontinuity* — everything else describes something the stage
  still shows if the caption is missed.

## 4. Recommended, unbuilt — decision wanted

### Solution 1 — state main's lead

The viewer's own instinct: make main the thing you read everything against. In
the form the measurements support, that is a readout, not a layout: *"3 ahead
of MAIN"* beside the date, or on the nameplate.

- It is the only candidate that speaks to the sentence the viewer actually
  said.
- Priced at **0.0–0.1 ms** — two binary searches over the impact order plus a
  walk of the gap.
- **Caveat:** affording it per frame needs the count done renderer-side, where
  the impact-ordered index already exists. Doing it in the component would scan
  every node each frame — 125,973 on Kubernetes.

### Solution 2 — stop the closing tableau fusing the lanes

The tableau's exemption from `MIN_LANE_PX` is what produces 6.10 px. Options:
a floor for the tableau too, at some cost to how much of the history it can
show; or widening the *visual* separation without widening the layout — the
glow radius and the line weight are both scale-dependent already.

Worth pairing with the note in `docs/status.md` that the render-scale floor of
0.6 collapses lane modulation 87% at five-pixel spacing; these are the same
problem at two zooms.

## 5. Rejected, with the measurement that rejected each

**A topological layout** — main as the trunk, unpassable by construction. The
honesty objection is not available (§2c). The real cost is that `impact`, the
tempo map, the time map, the date readout, the scrubber's two clocks, the era
bands, the open-branch count, branch lifetimes and the audio's timing all
derive from x being time; a topological x makes every one of them wrong or
meaningless. It also arrives years behind gitk, `git log --graph`, GitKraken
and GitHub's network graph, all of which do it well.

**Main's own date on its nameplate.** It would be *seen* — the plate grows
43.4 → 105.7 px, +144% — and it would be **redundant**: sampling 4,000
positions per entry, it renders the identical "Month YYYY" string as the hero
for **99.65% of Kubernetes** and 80.3–99.6% shelf-wide. Where it differs it is
*older*, by up to **2,678 days — 7.3 years** on Node. Two dates disagreeing by
seven years is the silhouette of a defect this app has already had once: the
date readout was 14.00 years out on Node.js because it silently described the
camera instead of the clock.

**A background calendar axis.** Built to specification and measured before
rejection. Per-year width varies by up to 213,610 : 1 within one history, so
"the largest unit whose spacing is at least 120 px" has no well-defined input;
it became a third disagreeing time scale (at Node's final frame the scrubber's
last label read 2015, the prototype's only tick 2020, the hero September 2026);
and differenced column by column it changed **never more than two pixel
columns** on a 1600 px stage, at 1–8 levels of luminance out of 255. On CPython
the ladder found no qualifying interval and drew nothing at all. See
`docs/reviews/time-ticks.md`.

## 6. Open — better ideas wanted

Nothing here is settled and the two recommendations above are not obviously the
best available. Specifically unanswered:

1. **Is a readout the right instrument at all?** Every fix in §3 and §4 adds
   words to the chrome. A picture that needs a caption to be read may want a
   different picture.
2. **Could main's lead be shown rather than stated?** A tint, a shadow, a
   ruled extent behind the branches that are ahead of it — something that makes
   "these three are past main" visible without a number.
3. **Should the tableau show less?** Its whole purpose is the wide shot, and
   the wide shot is what fuses the lanes. Perhaps the closing frame should
   frame *fewer* lanes rather than all of them.
4. **Is "runtime, not calendar" sayable in a way anyone reads?** §2f is the
   root cause of the confusion and the only fix that needs no republish, and
   the obvious answer to it has already been built and rejected.
5. **Is the pacing fix the real answer to all of this?** If Node's twelve-year
   jump did not exist, would any of the rest matter? That is one constant —
   the `3.2` clamp — testable locally without publishing anything.
6. **Does anything here look different to somebody who has not read the
   source?** Every measurement in this document was taken by people who know
   what it is supposed to do. None of it is user testing.
