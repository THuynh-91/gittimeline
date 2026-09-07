# What the date means, and why branches appear to pass MASTER

Two questions that keep coming back, answered from the code rather than from
impressions. Both have the same root: **x is a clock**, and almost nothing else
in this field works that way.

One correction to make up front, because it undercuts an argument this project
has leaned on. x is not the *author's* clock. It is **presentation time**:
author dates rewritten until they respect ancestry, so that a child is always
drawn to the right of its parent — `tests/unit/shared.ts` asserts
`child.x > parent.x` on every edge of every fixture. Measured on the published
plans, **734,221 of Linux's 1,481,850 commits (49.5%)** and 46.4% of Node's
have their stamp moved by more than a day to make that hold.

So "the picture never draws a commit at a time it did not happen" is false, and
was false before anyone proposed changing the layout. It is a deliberate
choice, guarded by a test, and it is the right one — a rebased or cherry-picked
commit carries a date that would otherwise place it before its own parent. But
it cannot be used as an argument against anything.

---

## 1. The date at the bottom is the playhead's date

Not master's, and not the branches'.

`DateBar` reads `player.historicalAt(t)`, where `t` is the performance clock —
the moment the show has reached — and `historicalAt` maps that through the
plan's `timeMap` to a calendar date. So "September 2023" means **the show has
reached September 2023**. It is a property of the playhead alone.

That is a stronger statement than it looks, because of two facts that hold
together:

- `x = impact * xScale` (`src/layout/layout.ts`) — affine in presentation time,
  not proportional to it: `impact` is `(authored − HEAD) / clock.scale`.
- The node pass refuses to draw anything ahead of the clock:
  `if (nd.impact > t + 0.001) continue` (`src/renderer/canvas.ts`). This is the
  project's hardest invariant — nothing is drawn before it happens.

Put together: **nothing on the stage is to the right of the playhead.** The
rightmost ink in the picture is the moment the date names. Every dot you can
see, on the main line or on any branch, landed on or before that date.

So the date is not ambiguous between master and the branches. It is the date of
the *frontier* — and both master and the branches are behind it, or on it.

### The one case where the date stops meaning that

If you take the camera yourself — drag, zoom, or use the travel slider — the
date switches to describing **where you are looking**, not where the clock is,
and the caption says "Travelling the finished history" while it does.

That switch used to fire on its own. On the closing frame of a streamed entry
the camera pulled back far enough that the app decided you had gone travelling
when you had not, and the date then reported wherever the camera had come to
rest — the middle of the history. Measured: 14.00 years out on Node.js, 12.67
on CPython, 0.00 on the built-in demo, which is the only plan held whole and
therefore the only one exempt. Fixed in `27ee1a8`; the date now follows the
playhead until somebody actually goes travelling. See `docs/status.md` §2.1.

---

## 2. Branches to the right of master's newest dot

There are three different things that look like this, and only the first is
real.

### (a) It is usually true, and it is the point

A branch commit dated later than master's most recent commit sits to the right
of master's newest dot. On a topological axis that is impossible — main is the
trunk by construction and *cannot* be passed. Here it is just what a clock
does: work continued on a branch after the last commit that reached main.

This is the differentiator. gitk, `git log --graph`, GitKraken and GitHub's
network graph all place commits by ancestry, so "this branch has been open for
five months and main has moved on twice since" is not a picture they can draw.

How far ahead does it actually get? **Much further than this document used to
say, and the old figure was measured at three points.** Exhaustively over all
twelve published plans:

| | ahead of main's head |
|---|---|
| microsoft/vscode | **3,275 nodes / 441 s** at its worst |
| torvalds/linux | 637 at worst, p90 45 |
| facebook/react | 399 at worst |
| rust-lang/rust | p90 18 |

And **something is drawn to the right of main's head for 53–88% of every show**
on ten of the twelve entries. The earlier claim — "nearly always zero or one",
from three sample points on two entries — was sound method on a sample far too
small, and it killed a proposed "N commits ahead of main" readout on the
grounds that it would show `0` almost always. It would not. That readout is
back under consideration; see `docs/status.md`.

These projects do merge constantly, and every merge *is* a commit on main, so
main is never far behind in a way that matters for ancestry. It is frequently
far behind in *time*, which is what this axis draws.

### (b) A routing bug that painted main's own path ahead of itself — fixed

Merges were drawn as a symmetric S-curve, which reached the spine's height
about 45% of the way across and then travelled *along* it to the merge commit.
That paints main's own line ahead of where main had actually got to. Fixed in
`48ca9d7`.

### (c) Neighbouring lanes fusing into one bright band — the usual culprit

This is what "MASTER is being surpassed" has twice turned out to be.

Branches sit `LANE_GAP` apart in world units, and the camera fits the box the
work occupies — so the more branches are open, the further it pulls back and
the fewer screen pixels that gap becomes. Measured on Kubernetes at one moment:

| window | pixels between lanes |
|---|---|
| 1920x1080 | 34.6 px |
| 1440x900 | 27.4 px |
| 1855x620 | **16.4 px** |

Those three were re-measured and the first two hold; the third does not, and
what replaced it is worse. `MIN_LANE_PX = 26` now floors the zoom during
playback — at 1855x620 the spacing is a flat 26.00 px for a whole performance —
**but the closing tableau is deliberately exempt from that floor**, and settled
at the end of the show Kubernetes at 1855x620 measures **6.10 px between
lanes**. That is 2.7 times tighter than the worst case quoted above, and it is
the last frame of every performance: the one a viewer looks at longest.

Add each line's glow to a six-pixel gap and neighbouring lanes stop reading as
two lines. **Nothing is drawn at the spine's height beyond its tip** — the
draw guard in §1 makes that structural — so a line that appears to continue
past main's head is its neighbour, too close to tell apart. There is now a
floor on the zoom (`MIN_LANE_PX`) to stop the camera pulling back past the
point where lanes fuse, and the closing tableau is exempt because that shot
exists to show the whole shape at once.

Widening `LANE_GAP` cannot fix this, and it is worth knowing why: a wider gap
makes a proportionally taller box, `fit` shrinks by the same factor, and the
picture comes out pixel-for-pixel identical. The only lever is the zoom.

---

## 3. What the axis does not claim

x is proportional to **runtime**, and only *ordered* by date. It is not
proportional to the calendar, and nothing on screen says so.

`docs/choreography.md` is explicit: every visible arrival gets the same beat,
and a quiet span longer than three weeks is replaced by a whoosh of at most
0.9 s. So two dots the same distance apart can be a day apart or a decade
apart. Measured spread within one history: **213,610 : 1** on CPython.

This is the honest gap in the picture, and it is the reason a reader can look
at a stage spanning about 1.1 calendar years and a readout naming one month of
it and conclude something is broken when nothing is. A background calendar axis
was proposed to close it and rejected on measurement — it would have been a
third disagreeing time scale, and on the most warped history the ladder found
no interval to draw at all. See `x/ticks-review/VERDICT.md`, and
`docs/pacing.md` §3C for what is left to try.
