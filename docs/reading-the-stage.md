# What the date means, and why branches appear to pass MASTER

Two questions that keep coming back, answered from the code rather than from
impressions. Both have the same root: **x is the clock**, and almost nothing
else in this field works that way.

---

## 1. The date at the bottom is the playhead's date

Not master's, and not the branches'.

`DateBar` reads `player.historicalAt(t)`, where `t` is the performance clock —
the moment the show has reached — and `historicalAt` maps that through the
plan's `timeMap` to a calendar date. So "September 2023" means **the show has
reached September 2023**. It is a property of the playhead alone.

That is a stronger statement than it looks, because of two facts that hold
together:

- `x = impact * xScale` (`src/layout/layout.ts`). Horizontal position *is* time.
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

How far ahead does it actually get? Measured after the routing fix below,
counting landed commits later than main's newest:

| | commits ahead of main |
|---|---|
| kubernetes @25% / @50% / @75% | 2 / 0 / 0 |
| cpython @25% / @50% / @75% | 1 / 0 / 1 |

Nearly always zero or one. These projects merge constantly, and **every merge
is a commit on main**, so main is never far behind in commit count. That result
killed a proposed "N commits ahead of main" readout: it would have shown `0`
almost always. See `PROPOSAL-mainline.md`.

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

Add each line's glow to a 16-pixel gap and neighbouring lanes stop reading as
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
