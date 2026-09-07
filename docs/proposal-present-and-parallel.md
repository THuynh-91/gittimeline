# Proposal: mark the present, and stop main looking overtaken

Status: **open — assessment requested.** Written 2026-09-07, from a viewer's
question that reframed the problem.

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

### 1a. Nothing is drawn in the future. This is structural.

`canvas.ts:1830`: `if (nd.impact > t + 0.001) continue`. No node whose moment
has not arrived is drawn, and `x = impact * xScale`, so **nothing is drawn to
the right of the playhead**. The rightmost ink in any frame *is* the present.

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

**What those lines actually are is not established** — see §6.1. Candidates:
unmerged branch tips; aggregate ribbons whose exit node is later than main's
head; or an artefact of which pages happen to be resident in a streamed
window. Kubernetes has 57,738 threads and 57,863 merges, so nearly every
thread does eventually merge, which makes a large permanent set of open tips
unlikely and makes the other two explanations more probable. This matters: two
of those three would be *representational* rather than factual, and would
change what the fix should be.

## 2. Why the literal request is refused

"Nothing ahead of main" means a branch commit dated after main's newest commit
must be drawn at or left of main's head. Two costs:

**It would place commits before commits that preceded them.** Not a general
objection — x is already presentation time, with author dates rewritten to
respect ancestry, and 49.5% of Linux's commits have their stamp moved more than
a day (`docs/proposal-main-line.md` §2c). The objection is specific: this would
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

## 5. Recommendation

**A first, then reassess.** It is the only candidate that answers the question
that was asked, it needs no republish, and it makes B's benefit measurable
rather than assumed — if a labelled present already resolves the confusion, B
is decoration with a bad precedent attached.

Do not build B without a first-time viewer looking at A, because the case for B
rests entirely on whether "main has not caught up" reads correctly once the
present is marked.

## 6. What this document does not know

1. **What the lines right of MASTER's plate are.** Unmerged tips, aggregate
   ribbons, or a resident-window artefact (§1c). Establishing it needs the
   nodes right of main's head in a settled closing frame classified by thread
   `ending` and by whether they carry an `aggregateIdx`. If they are mostly an
   artefact of the window, the fix is different and cheaper.
2. **Whether a full-height rule survives dense playback.** It has never been
   drawn. Kubernetes has 125,973 visible nodes; a vertical line through a dense
   frame may read as a seam or a tear.
3. **Whether "main has not caught up" is what a viewer reads** once the present
   is marked, or whether it reads as "main is broken".
4. **Whether B can be drawn unmistakably.** A dashed continuation is a
   convention; whether it survives the bloom pass, reduced motion, high
   contrast and a render scale of 0.6 is unmeasured.
5. **What this costs per frame.** A is one line and a text draw. B is a stroke
   whose length varies. Neither is measured.
6. **Whether marking the present makes the pacing defect worse.** On Node the
   playhead crosses eleven years in 0.077 s (`docs/pacing.md`). A labelled
   present that jumps twelve years in one frame may be more alarming than an
   unlabelled one, not less.
