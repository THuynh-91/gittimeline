# Proposal: the picture and the claim disagree — two ways to fix it, both measured

Status: **open, with an experiment run.** Drafted 2026-09-08. Supersedes
`proposal-abstract-not-analytical.md`, which had one side of this bolted onto
the other after the fact.

> "I felt mislead and misguided from this."
> "Why not the flip side, and draw 366 branches... wouldn't that be cool"

---

## 1. The problem, in one line

**The app prints exact numbers about the whole history over a picture that
shows a small fraction of it.**

Measured on the live build, `torvalds/linux`:

| | |
|---|---|
| the history | **1,481,850** commits · **109,030** threads · **601** open at once at the peak |
| drawn, after aggregation | **332,279** nodes — 77.6% collapsed |
| resident in the streamed window | **~2,300** |
| the readout at 55% | **"366 branches open"** |
| lines a viewer could count | about two dozen |

Nothing there is false. `366 of this history's 109030 branches have started by
this point and have not been merged` is exactly right, and the tooltip says so
in full. But a viewer reads a precise claim, looks at a picture that cannot
possibly support it, and concludes the picture is lying.

**It is a defect of register, not of accuracy** — and the honest response is
either to make the claim smaller or the picture bigger. Those are the two
sides.

Worth recording that the first instinct was wrong: when the viewer said it
looked off, this author reached for *more* precision — a labelled playhead,
exact convergence counts, an overhang audit. For a thing meant to be cool and
abstract that is the wrong direction, and it is what turned a rough picture
into a rough picture making checkable claims.

## 2. Why the picture was small — two constants, stacked

Neither aggregation nor streaming is what capped the drawing. Two layout and
camera constants were:

    src/layout/layout.ts      MAX_LANES    = 12    // 24 tracks, ever
    src/renderer/canvas.ts    MIN_LANE_PX  = 26    // a zoom floor

`MAX_LANES` folded hundreds of concurrent threads into twenty-four slots.
`MIN_LANE_PX` is a floor on how close two lanes may sit on screen, which is a
floor on how far the camera may zoom out, which is a cap on how many lanes can
be in frame at all: 900 px of stage ÷ 26 px ≈ **34 lanes, maximum**.

They stack, and that matters: raising `MAX_LANES` to 240 **on its own changed
almost nothing** — measured, about twenty lines in frame on Kubernetes, because
the camera still would not zoom out. Either constant alone is a dead end.

## 3. Side A — make the claim match the picture

Leave the drawing alone; stop printing numbers it cannot support.

**A1. Count what is drawn.** "24 branches on stage" rather than "366 branches
open". Checkable by counting, and useless as a fact about Linux — which is the
point, it stops pretending to be one.

**A2. Say it qualitatively.** "many branches open", or a dial that fills. Keeps
the sense of scale, makes no checkable claim, matches the register of a
performance.

**A3. Both.** "24 on stage · hundreds in flight."

### Evaluation

| | |
|---|---|
| **Cost** | Hours. Copy and one computed value. |
| **Republish** | None. |
| **Risk** | Almost none; it cannot fail to work. |
| **What it wins** | The app stops making a claim a viewer can catch it failing. Honest by construction. |
| **What it loses** | The single most striking fact the data holds — that 601 things were in flight at once — becomes a footnote. It also concedes that the picture will stay small, and treats a presentation problem as a copywriting problem. |

## 4. Side B — make the picture match the claim

Raise both constants and let density carry the information.

**Run, not theorised.** `MAX_LANES` 12 → 240, `MIN_LANE_PX` 26 → 4, plus a
depth falloff (`laneFade`) taking lanes beyond about five out from the spine
down to 17% alpha so the far field reads as atmosphere rather than as competing
lines. A selected thread or focused contributor is exempt from the falloff.

Kubernetes' **full** history recompiled locally with those constants —
140,858 commits, 57,738 threads, 284 concurrent at the peak:

| t | branches open | rows of 900 carrying ink | lines legible in frame |
|---|---|---|---|
| 30% | 69 | 383 | — |
| 55% | **134** | 362 | **about 40–50** |
| 80% | 85 | 347 | — |

and `public-apis` (138 concurrent from only 5,272 commits, so it recompiles in
seconds) reached **850 of 900 rows** carrying ink at 80%.

Screenshots: `x/swarm/k8s-dense-*.png`, `x/swarm/k8s-240-*.png` (240 lanes but
the old zoom floor, for the comparison), `x/swarm/swarm-*.png`.

**It looks like the thing the app is for.** A converging fan of branch lines
above and below, main burning ivory straight through the middle, still
perfectly readable. Not spaghetti — the depth falloff is what does that.

### Evaluation

| | |
|---|---|
| **Cost** | Two constants and one falloff, already written. Plus a **catalog republish of all twelve entries**, because lane assignment is baked into the published plans. `MIN_LANE_PX` and `laneFade` are render-only and would take effect immediately. |
| **Republish** | Required for `MAX_LANES`. Batches with the shelf-pacing republish already outstanding. |
| **Risk** | Real and named below. |
| **What it wins** | The number becomes true by showing it. The app gets more impressive rather than less. Density stops being something a caption asserts and becomes the medium. |
| **What it loses** | Individual traceability. `MIN_LANE_PX = 26` existed so any line could be followed by eye; at 4 px that is gone, and `Pick` on click becomes the only way to isolate a thread. |

### What side B does not fix

**It closes most of the gap, not all of it.** 134 branches open, about 40–50
legible. The remaining shortfall is no longer lanes or zoom — it is that the
director composes around the phrase being played rather than framing the whole
vertical spread. Closing it fully means changing what the camera is *for*,
which is a larger decision than a constant and should not be smuggled in with
one.

**The top of the range is untested.** Kubernetes peaks at 284 and the frame
measured held 134. Linux's **601** at 4 px spacing is where it may still turn
to wash, and Linux's whole-plan compile has never finished in this repo, so
answering it needs the republish pipeline rather than a local run.

**The row counts are not a straight win.** At 240 lanes with the old zoom floor
Kubernetes lit 572 of 900 rows at 55%; with the floor opened it lit **362**.
Zooming out compresses the spread, so lines cluster into fewer rows even though
more of them are present. "Rows with ink" measures spread, not count, and
should not be quoted as if it measured count.

## 5. Recommendation: both, and they are not alternatives

**Side B for the picture. A1's residue for the counter.**

B is the better answer to what this app is trying to be, and the experiment
says it works. But even with B the readout would say 134 while about 45 are
legible — so B alone does not make the counter honest, it makes it *less
dishonest*. The counter should still describe the stage.

So: raise the constants, keep the falloff, and let the readout say what is on
stage with the history's figure available where a viewer asks for detail. That
is A3 in practice, arrived at from the other end — and the reason to prefer it
over A3-as-first-resort is that the number it reports is now worth reporting.

## 6. Decisions this needs, which are not measurements

1. **Is 4 px right?** It is the value the screenshots were taken at. 6 or 8
   would be denser than 26 and calmer than 4.
2. **Is losing individual traceability acceptable?** This is the real cost of
   B and it is a taste call about what the app is for.
3. **Does the camera get rethought** to frame the full spread, or does the
   40–50 shortfall stand?
4. **Is the republish worth it now**, or does this wait and batch with shelf
   pacing?

## 7. Still open, found while testing this

- **"3 branches open" at 90% of Linux**, down from 355 at 75% with 2,317 nodes
  still resident. Not plausible, and it is the same readout this proposal
  rewrites.
- **Two conflicting definitions of "main's head"** in the renderer: the camera
  composes around `spineTip` (the drawn end of the stroke) while the audit
  reports `spineHeadNode` (the newest landed commit). One run put the head at
  −4030 px on a 1600 px frame, which would mean MASTER off the left edge
  entirely. Until these agree, "nothing past MASTER" cannot be demonstrated
  even where it is true by construction.
- **The frontier clip** — `min(playhead, main's newest commit)` — is
  implemented and airtight by construction, but unverified observationally for
  the reason above.
