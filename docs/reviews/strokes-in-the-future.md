# The strings really were in the future

Status: **found, fixed, measured, tested.** 2026-09-07.

> "It's confusing seeing strings go in the future so it's hard to understand
> what the present is."

That report was correct, literally, and about the renderer rather than about
the layout. This document records what was drawn, why, how it was found, and
which of my own earlier claims it falsifies.

---

## 1. The claim that was wrong

`proposal-present-and-parallel.md` §1a:

> `canvas.ts`: `if (nd.impact > t + 0.001) continue`. No node whose moment has
> not arrived is drawn, and `x = impact * xScale`, so **nothing is drawn to the
> right of the playhead**. The rightmost ink in any frame *is* the present.

The guard is real and it holds. The conclusion does not, because **nodes are
not the only ink**. Edges are strokes along a path, and a stroke is bounded by
a reveal fraction, not by the node guard. §1a proved a property of dots and
asserted it of the whole frame.

Candidate A — a labelled rule at the playhead — was proposed to *communicate*
that property. Drawing it is what disproved it. The rule went in, and the ink
carried on past it.

## 2. What was measured

Both builds streamed from the published packages (`.catalog-release/*.pages`),
same viewport, same seek, playback paused. `rightmost-bright` is the rightmost
column holding a pixel above a value of 80 out of 255, in CSS px, on a frame
1855 px wide.

### kubernetes/kubernetes, six points across the show

| t | rule | main's head | rightmost bright — before | after |
|---|---|---|---|---|
| 10% | 1135 | 1113 | **1854 (100%)** | 1213 (65%) |
| 25% | 1138 | 1113 | **1854 (100%)** | 1213 (65%) |
| 40% | 1122 | 1113 | **1854 (100%)** | 1213 (65%) |
| 60% | 1124 | 1113 | **1854 (100%)** | 1213 (65%) |
| 80% | 1125 | 1113 | **1854 (100%)** | 1213 (65%) |
| 95% | 1175 | 1113 | **1854 (100%)** | 1213 (65%) |

At every one of six points, ink reached the frame's right edge — 730 px past
the playhead, and past MASTER's plate at 1163. Not an edge case: the whole
show.

### microsoft/vscode and facebook/react

| | before | after |
|---|---|---|
| vscode 39% (its overhang peak) | **1854 (100%)** | 1168 (63%) |
| vscode 60% | 1361 (73%) | 1225 (66%) |
| react 40% | 1289 (69%) | 1199 (65%) |
| react 15% | 1199 (65%) | 1199 (65%) |

The defect scales with the x span of a merge, so it is worst on exactly the
histories where it was reported and nearly invisible on React. That matches
`large-repo-main-line.md` being the document this thread started from.

### The frame at 40%, either side of the fix

`x/present-shots/baseline.png` and `present.png`. Before: green branch strokes
run past MASTER, off the right of the frame, with commit dots strung along
them. After: every stroke stops at the rule.

Right of the rule, at the bright threshold, in a 24-bucket column profile:

    before   1125:1404  1156:1176  1187:1105  …  1838:204     (all 24 buckets lit)
    after    1125:231   1156:223   1187:207   1218:0  …  0    (three buckets, then nothing)

The three that remain are the word `NOW` and MASTER's nameplate. Both are
labels. No history is drawn past the present in any frame sampled.

## 3. The cause

`travelU`, the reveal fraction, for merges:

    f * f * (3 - 2 * f) * 0.6 + 0.4 * f^1.7        // "accelerate into the
                                                   //  landing so arrivals
                                                   //  read as hits"

That curve sits **above the diagonal for the whole of `[0,1]`**, exceeding
linear progress by up to 0.0180 of the path at f = 0.881. A reveal above the
diagonal draws path the body has not travelled — which is the future, drawn.

1.8% is nothing until you multiply it by a merge's reach. On streamed
Kubernetes at 40%, twenty-nine drawn merge strokes had their revealed prefix
past the playhead, the worst reaching a screen x of **8,723** — 7,600 px past
the rule, clipped by the frame at 1855, which is why it read as lines running
off into the future rather than as a small overshoot.

**This is the second half of `48ca9d7`.** That commit found merges stroked
along their entire route with no bound at all — "you could see where a branch
was going to go before it went there" — and bounded them with `u`. The bound
was right. The clock feeding it was not, and the fix has carried a leading
easing ever since.

Worth recording: `reducedMotion` returned raw `f` and was therefore the only
mode drawing the truth. The defect was in the flourish, not in the geometry.

## 4. The fix

Two parts, in `src/renderer/canvas.ts`.

**The easing, now a pure exported function.** `travelEase(kind, f, reduced)`
returns `f^1.25` for merges and `f^1.6` otherwise. Both are at or below the
diagonal everywhere, both still accelerate throughout (the derivative of `f^k`
rises with `f` for `k > 1`, so arrivals still read as hits), both reach exactly
1 at f = 1 so a body lands on its merge commit on the frame that commit
appears, and merges keep the snappier exponent so a convergence still arrives
with more emphasis than an ordinary commit. Exported and pure so the property
can be asserted without a canvas — which is the whole point.

**A clip at the present, in `drawPolyline`.** `u` bounds how far along the
*point list* the reveal has got, and that is the same as "how far along in
time" only when the points are evenly spaced in x. On a merge they are not: a
long lane run is sampled at a fixed spacing and capped at 200 points, then the
turn into the landing adds about twenty more over a few hundred units, so a
correct `u` can still index past the x the clock has reached. Every stroke on
the stage goes through `drawPolyline`, so the clip lives there rather than at
each caller, and no future change to any easing can reintroduce the fault.
`presentX` is set once a frame from `xAtTime(t)`.

`tests/unit/reveal.test.ts` asserts the property directly: no kind, at any of
2,001 sampled points, in either motion mode, may reveal more than `f`. It also
pins the three things the fix had to preserve — exact arrival, acceleration
throughout, and merges faster than ordinary edges. The old curve fails the
first test at f = 0.815 (0.828 against 0.815).

Full unit suite after: **14 files, 186 passed, 1 skipped.** `tsc` and `eslint`
clean.

## 5. What this falsifies in my own earlier work

**§1a of the proposal is wrong as written** and is the reason the rest went
astray. "Nothing is drawn to the right of the playhead. This is structural."
was true of nodes and false of the frame.

**§1c–1e answered a different question from the one the screenshot asked.**
Those sections measured *overhang* — nodes right of **main's head** — offline,
from compiled plans, and the measurements stand: 54.3% of Kubernetes' runtime
has something right of main's head, up to 3,137 nodes on VS Code, and every
overhang node on both entries measured belongs to a thread that eventually
merges. That is real work waiting on a merge and it is worth showing.

But the viewer was not reporting overhang. They were reporting strokes past the
present, and I never measured what the renderer *drew* — only what the compiler
*emitted*. Two different quantities, and I used the honest one to explain away
a picture produced by the other.

**§1e's explanation is wrong for these frames.** It said the head band keeps
main's head at 60–70% and "the 30-40% between them is exactly the in-flight
work". Measured: main's head sits at 1113 of 1855 — 60.0%, pinned at the band's
lower edge — and the playhead at 1122, nine pixels away. There is no 30–40%
of in-flight work between them. There was 30–40% of *the future*.

**The recommendation survives, for better reasons.** A was recommended to
communicate an invariant; it turned out to *enforce* one, by making the
violation visible in a single screenshot after two documents of offline
measurement had missed it. B is unaffected and still untested against a real
gap, because in the frames sampled there is barely a gap to carry.

## 5a. And then the rule was switched off

The viewer's verdict, once they had looked at it:

> "What does the NOW LINE serve.. other then a distraction... it's fine without
> it"

Right, and for the reason this document argues. The rule was built to say
"the rightmost ink is the present". With the strokes bounded that is now true
of the picture itself, so the rule states something already shown — and one
more mark in the same place for four and a half hours costs attention and
returns nothing. `showPresent` defaults to **false**. B goes with it, and had
little left to do anyway: main's head sits 1-9 px from the playhead in every
frame sampled on three entries.

It is kept behind the switch rather than deleted, because a labelled playhead
is how this class of defect gets caught — it turns "does anything run ahead of
the clock" from an argument into a screenshot. `presentMark` and `presentAudit`
on the renderer are the numeric form of the same check, and the clip in
`drawPolyline` is on regardless of the setting: the fix is not the rule.

The honest summary of A is that it was an instrument, not a feature, and it
paid for itself in the hour it existed.

## 6. What this opens

**35% of the frame is now empty.** Bright ink stops at 65% of the width at
every point sampled on Kubernetes, and the rightmost thing in it is a
nameplate. The head band reserves the right third of the stage for travelling
work; with the future no longer drawn there, much less of that space is used.
The band was calibrated against a picture that was drawing the future, so its
premise needs re-deriving — and that is the same camera question Codex's
closing-shot prototype is already open on (`large-repo-main-line.md`).

**MASTER's plate is the rightmost bright object in the frame**, at head + 50 px,
which puts a label past the present. It is a label and not history, but it is
also the exact thing a viewer reads as "where main has got to", 50 px past
where main has got to. Worth deciding rather than leaving.

**The captions repeat.** The 40% Kubernetes frame carries "51 commits
converge" ten times along main, every one the same number. Separate defect,
noted here because the screenshots make it obvious.

## 7. How to look

Streamed from the real packages, so this is production behaviour and not a
whole-plan fallback — the trap `large-repo-main-line.md` documents. Kubernetes,
VS Code and React are linked in both builds.

    baseline (live behaviour)   http://localhost:4182/
    with the fix, A and B       http://localhost:4183/

Open Selection, pick Kubernetes, choose the full span, and pause anywhere.
Settings ▸ "Mark the present" toggles A and B on 4183.

Scripts, all in the gitignored `x/`: `sweep-present.mjs` (the tables above),
`shot-present2.mjs` (frames plus ink measurement), `rightink.mjs` (the column
and row profiles and the crop), `audit.mjs` with `presentAudit` (the numbers
behind §3).
