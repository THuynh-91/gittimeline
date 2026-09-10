# Proposal: mark the present, and stop main looking overtaken

Status: **A and B built; §1a of this document was wrong and building A is what
proved it.** Written 2026-09-07, from a viewer's question that reframed the
problem, and corrected the same day.

> **Correction, before anything below is read.** §1a claimed nothing is drawn
> right of the playhead, "structurally". That is true of *nodes* and false of
> the *frame*: merge strokes were revealed by an easing curve that ran ahead of
> linear progress, and on streamed Kubernetes they reached the frame's right
> edge at all six points sampled across the show — the worst stroke 7,600 px
> past the playhead. The viewer's "strings go in the future" was a literal and
> accurate description of the renderer. Found, fixed, measured and tested in
> `reviews/strokes-in-the-future.md`; §5 of that document lists which claims
> here it falsifies. The overhang measurements in §1c–1d stand, but they answer
> a different question from the one the screenshot asked.

> "It's confusing seeing strings go in the future so it's hard to understand
> what the present is. Why can't they just go in parallel at the same speed and
> nothing ahead of main?"

Everything below is measured or read in the source at `5b4f5ff`. Where a claim
is not established, it says so and says what would establish it — §6 is a list
of things this document does not know.

---

## 1. The problem, restated

Three earlier reports were treated as one complaint about *legibility* — lines
too close together to tell apart. That was half of it. This question is a
different complaint and a sharper one:

**A viewer cannot find the present.** And having no marker for it, they take
the one labelled landmark near the right of the frame — MASTER's nameplate —
to *be* the present. Everything drawn to its right then reads as the future,
which would indeed be nonsense.

### 1a. ~~Nothing is drawn in the future. This is structural.~~ Wrong — nodes only

`canvas.ts`: `if (nd.impact > t + 0.001) continue`. No node whose moment has
not arrived is drawn, and `x = impact * xScale`, so no *node* is drawn right of
the playhead.

**But nodes are not the only ink, and the conclusion drawn from this was
false.** Edges are strokes along a path, bounded by a reveal fraction rather
than by that guard, and the reveal for merges ran ahead of the clock. The
rightmost ink in a frame was *not* the present: on streamed Kubernetes it was
the right edge of the frame, at every point sampled. See
`reviews/strokes-in-the-future.md`. Now true, after the fix recorded there —
and true because of a clip that enforces it, rather than as a property inferred
from one pass.

### 1b. But the present is not marked, anywhere

The stage has exactly one thing at a moving horizontal position, `sweepX`
(`canvas.ts:1764`), and it is decoration: `p.bounds.minX + ((t * 260) % span)`,
a light travelling repeatedly over already-drawn history. It is not the
playhead and does not track it.

The date is in the chrome, below the stage. The scrubber's handle is in the
chrome. **On the stage itself there is no representation of "now".** A viewer
asked to find the present has nothing to find.

### 1c. So what *is* to the right of MASTER's plate?

Work that happened after the newest commit main has received. Measured over the
whole plans:

| | fraction of runtime with something right of main's head | worst consecutive run | worst separation |
|---|---|---|---|
| kubernetes | **54.3%** | 35 nodes | 4.01 s |
| torvalds/linux | **86.3%** | 637 nodes | 95.39 s |

Ten of the twelve published entries are between 53% and 88%. This is the
common case, not an edge.

### 1d. Settled: the overhang is real, and it is work waiting on a merge

§6.1 asked what those lines are, offering three candidates — unmerged tips,
aggregate ribbons, or a resident-window artefact. **Measured: none of them.**

Whole plans compiled locally, `planHash` matching the published sidecar as a
control, overhang counted as nodes with `mainHead(t).impact < impact <= t`:

| | at t=100% | max over the show | every overhang node's thread `ending` |
|---|---|---|---|
| microsoft/vscode | **0** | 3,137 at 38.5%, worst 422.6 s | **100% `merged`** |
| facebook/react | **0** | 383 at 97%, worst 47.5 s | **100% `merged`** |

Not one overhang node on either entry belongs to a thread ending as `tip` or
`dormant`. So it is not stale branches and not unmerged forks: it is committed
work on a branch that has not been merged yet, and main catches up when the
merge lands. An open pull request, drawn — which is the one thing this app can
show that a topological tool cannot.

**And at the closing frame there is no overhang at all**, including on the
streamed window, which is the case the screenshot came from. Assembling the
pages the app holds at the end of Kubernetes exactly as `assembleWindow` does
— 2 time pages, 29 geometry pages, 1,239 resident nodes:

    main's resident head:  impact 16377.490   x 14028321
    newest landed node:    impact 16377.490   x 14028321
    overhang: 0 nodes      worst separation: 0.000 s

Main's head *is* the newest node, to the digit. The resident-window artefact
hypothesis is refuted, and the closing frame was the only place it could have
applied.

### 1e. So why does MASTER's plate sit at about 65% of the frame?

By design, during playback. `canvas.ts:1452`: *"The head of the main line is
kept between three fifths and seven tenths of the way across."* The band exists
because the director composes around the phrase being played, and without it
the travelling work sits off the frame — measured on a seek into CPython, every
travelling body was about five thousand pixels off the left edge.

So during playback the geometry is: main's head at 60-70%, the playhead at
100%, and **the 30-40% between them is exactly the in-flight work**. It is
real, it is often thousands of commits, and nothing marks either end of the
gap. The plate is the only label in it, so the gap reads as "the future" when
what it means is "not merged yet".

That also resolves a lead left by an interrupted assessment — "zero overhang at
the closing frame on the whole kubernetes plan". It is true, and it explains
nothing, because zero at the end is the normal case and the confusion happens
mid-show.

*One inference, flagged as such:* that the reported screenshot is mid-playback
rather than the closing frame. It follows from the plate sitting exactly at the
head band and from overhang being zero at the end. The viewer can confirm it in
a moment.

## 2. Why the literal request is refused

"Nothing ahead of main" means a branch commit dated after main's newest commit
must be drawn at or left of main's head. Two costs:

**It would place commits before commits that preceded them.** Not a general
objection — x is already presentation time, with author dates rewritten to
respect ancestry, and 49.5% of Linux's commits have their stamp moved more than
a day (`docs/notes/proposal-main-line.md` §2c). The objection is specific: this would
move a commit backwards *past unrelated work on another line*, which is a claim
about concurrency, not about ancestry.

**And it would hide the thing the picture is for.** Work that is committed and
not yet merged is the most interesting state a branch can be in — it is the
open pull request, the in-flight review. Drawing it level with main makes it
look absorbed. Every topological tool has to do this; it is the reason this one
is different.

## 3. What the request is actually right about

**Main stopping short is the problem, not the branches continuing.**

Main's line ends at main's newest commit. A branch line ends at *its* newest
commit. When a branch has newer work, its line ends further right — so main
appears to have been overtaken, when what has happened is that main has not yet
received that work.

Main did not stop existing at its last commit. The ref exists continuously; it
simply has no commit at the present moment.

## 4. Candidate solutions

### A — A rule at the present, labelled · no republish

A faint full-height vertical line at the playhead, with the date on it.

- Answers the question directly and in the picture rather than in a caption.
- **Nothing can be right of it, by construction** (§1a). So "are these in the
  future?" is answered by the geometry.
- MASTER's head sitting to its left then reads as *main has not caught up*,
  which is the truth, instead of *the branches are in the future*, which is
  not.
- Risk: a fourth vertical reference on a stage that already has era bands, and
  during dense playback a full-height rule may read as a seam. It is also
  motion — one more thing moving — on a stage that has a reduced-motion mode to
  respect.

### B — Carry main's line to the present, distinctly · no republish

Continue main's stroke from its newest commit to the playhead, drawn so it
cannot be mistaken for commits — dashed, or dimmed, or hairline.

- Then nothing is visually ahead of main, which is the request, without moving
  a single commit.
- Defensible as *more* honest than stopping: main exists at the present and has
  no commit there, and stopping the line implies the branch ended.
- Risk: this is the treatment `48ca9d7` removed for a reason. That commit fixed
  merges being drawn as S-curves that painted main's path ahead of where main
  had got to — a solid line implying commits that did not exist. B must not
  reintroduce it, which puts the whole weight on the drawing being
  unmistakably not-a-commit-line.

### C — Both

A and B answer different halves: A says where the present is, B stops main
looking overtaken. They are not alternatives and neither subsumes the other.

**And on the measurements in 1d-1e, B is the viewer's request satisfied
honestly.** "Nothing ahead of main" cannot be had by moving commits: that would
place a commit before unrelated work that preceded it, and would make in-flight
work look merged. Main's *line* reaching the present costs none of that. No
commit moves, main gains no commits it does not have, and the in-flight work
then sits beside main rather than beyond it — so the gap stops being
unexplained space and becomes the visible distance between what has landed and
now.

### D — Already prototyped, and it does not address this

Codex's closing-camera change holds the lane floor in the tableau, which takes
spacing from 2.71–14.36 px to a flat 26 px across six viewports
(`docs/reviews/large-repo-main-line.md`). That is a legibility fix. By making
the lines individually distinguishable it makes the overhang *more* visible,
which the viewer confirmed from a screenshot. It should ship or not on its own
merits; it is not a candidate here.

One detail worth carrying into any anchor work: the prototype's anchor is
`shot.maxX` — the rightmost resident *node* — under a variable named `headX`.
Because branches run past main, that node is usually a branch commit, so MASTER
landed at about 65% of the frame rather than the intended 90%, with the
overhang filling the right third.

## 5. Recommendation — revised on the 1d-1e measurements

**A and B together, A first.** The original recommendation was A alone, with B
held back as decoration carrying a bad precedent. The measurements changed
that: the gap between main's head and the present is not an artefact to be
explained away, it is a third of the frame holding real in-flight work, and B
is the honest form of what the viewer asked for.

A first only because it is one line and a text draw, and because it makes B's
benefit measurable rather than assumed.

Still do not build B without looking at A, and still do not let B draw anything
that could be mistaken for a commit — that is the trap `48ca9d7` climbed out
of.

## 6. What this document does not know

1. ~~What the lines right of MASTER's plate are.~~ **Settled — see 1d.** Real
   commits, on branches that all eventually merge; zero at the closing frame,
   thousands mid-show. Two entries measured on whole plans plus the streamed
   closing window. Kubernetes and Linux whole-plan sweeps are still worth
   taking for completeness.
2. ~~Whether a full-height rule survives dense playback.~~ **Drawn, and it
   earned its place immediately** — it made a violated invariant visible in one
   screenshot after two documents of offline measurement had missed it
   (`reviews/strokes-in-the-future.md`). Legibility in a dense frame is still
   unjudged by a viewer, but it is no longer unmeasured: right of the rule, only
   the word `NOW` and MASTER's plate remain lit.
3. **Whether "main has not caught up" is what a viewer reads** once the present
   is marked, or whether it reads as "main is broken".
4. **Whether B can be drawn unmistakably.** A dashed continuation is a
   convention; whether it survives the bloom pass, reduced motion, high
   contrast and a render scale of 0.6 is unmeasured. Harder to judge than
   expected, because with the future no longer drawn there is barely a gap for
   B to carry: main's head sits at 1113 and the playhead at 1114-1175 in every
   frame sampled on Kubernetes, VS Code and React.
5. **What this costs per frame.** A is one line and a text draw. B is a stroke
   whose length varies. Neither is measured.
6. **Whether marking the present makes the pacing defect worse.** On Node the
   playhead crosses eleven years in 0.077 s (`docs/notes/pacing.md`). A labelled
   present that jumps twelve years in one frame may be more alarming than an
   unlabelled one, not less.
