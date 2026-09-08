# Proposal: stem the branch overview off MASTER — and why it is not one fan

Status: **open, measured before drafting.** 2026-09-08.

> "When showing all the branches... why isn't it stemming from the main?"
> "I'm confused... why wouldn't it be stemming from the main.. like the others..?"

---

## 1. Why it does not, today

The overview downloads a summary that records four things per branch:

    { id, label, start, end }          src/model/branchOverview.ts:9

*When* a branch was working. Nothing about where it came from. So a curve
leaving the spine would be asserting a branch point the view cannot see, and a
curve landing on the spine would be asserting a merge — which for a thread that
never merged is simply false. The implementer refused it on exactly those
grounds (`proposal-overview-visual-language.md`, treatment T2, rejected on
invariant 2) and drew each filament along its own interval instead, claiming
only what the payload proves.

That reasoning is right. Its premise is fixable.

## 2. The data exists, and is complete

Every thread in the compiled plan carries both endpoints, set at
`src/choreography/compile.ts:393-394`:

    mergeNodeIdx   the commit it merged into, or null
    baseNodeIdx    the commit it branched from, or null

The main graph draws its peel-offs and merge landings from precisely these,
which is why *it* stems from MASTER. They were never copied into the summary.

Measured on the published whole plans, not inferred:

| | kubernetes | torvalds/linux |
|---|---|---|
| side threads with visible nodes | 56,101 | 108,751 |
| know their base commit | **100.0%** | **100.0%** |
| know their merge commit | **100.0%** | **100.0%** |
| thread endings | all `merged` | all `merged` |

So the fields are populated, not merely declared, on both — including the
entry with 601 concurrent threads.

## 3. But a single fan into MASTER would be a lie on Linux

This is the finding that changes the shape of the proposal, and it is the
reason to measure before promising:

| where the endpoints actually are | kubernetes | torvalds/linux |
|---|---|---|
| base commit is on MASTER | **99.0%** | **59.7%** |
| merge commit is on MASTER | **99.8%** | **39.9%** |

On Kubernetes almost every branch does leave MASTER and rejoin it, so a
convergent fan is the truth. On Linux **40% of branches do not branch from
MASTER and 60% do not merge into it** — they branch off and merge into *other
branches*. That is the subsystem-maintainer model drawn honestly: maintainers
branch from maintainers, and Linus pulls the tree, not the leaves.

Drawing all 600 Linux filaments stemming from MASTER would therefore
misrepresent the majority of them. It would look like the answer the viewer
asked for and be false on the flagship entry.

**Correction to something said earlier in this conversation:** I described this
as "one line in `branchOverview.ts`" and said dormant threads would "trail
off". Both were wrong. There are no dormant threads in either plan — every
side thread ends `merged` — and the structure is a hierarchy, not a fan.

## 4. Options

**A. Stem only what really stems.** Attach a filament to MASTER when its base
is on MASTER, and leave the rest as they are drawn now. Honest with no new
geometry. Kubernetes becomes the fan the viewer expects; Linux becomes a fan of
60% with 40% still floating, which is truthful and probably reads as
inconsistent.

**B. Attach to the parent branch.** Stem each filament from its base wherever
that base is — which for 40% of Linux is another filament's lane. This is the
honest picture, and it is a *tree layout*: lanes can no longer be assigned by
interleaving, because a child must sit near its parent, and the depth of the
hierarchy has to be measured before anyone can say whether it fits on a stage
900 px tall. Much the most work and much the most interesting result.

**C. Two levels, then stop.** Direct children of MASTER stem from it; anything
deeper stems from its own parent *only if that parent is on screen*, otherwise
it floats as today. Bounded work, and it degrades in a way that is explainable
in one sentence.

**D. Say it instead of drawing it.** Keep the parallel filaments, and let
selecting one reveal its lineage — "branched from `net-next`, merged into
`net-next`" — with the base and merge marked on the MASTER line when they are
on it. Cheapest, and it answers the *question* without redrawing anything.

## 5. Recommendation

**A now, B investigated, D alongside.**

A is small, is honest on both entries, and gives the viewer what they asked for
on the entry where it is true. Ship it with the count and the caption saying
which filaments are attached, so the floating 40% on Linux reads as a fact
about Linux rather than as an unfinished drawing.

B is the right long answer and cannot be costed yet: nobody has measured how
deep the hierarchy goes. That measurement is the next step and it is cheap —
walk `baseNodeIdx` to a fixed point and take the depth distribution. If Linux
is three deep, B is a layout change. If it is thirty, B is a different app.

D is worth doing whatever happens to A and B, because a lineage a viewer can
ask about is more use than a curve they have to interpret.

## 6. Costs and risks

- **Payload.** Two more numbers per row: ~877 KB raw for Kubernetes and
  ~1,699 KB for Linux before gzip, roughly doubling an index that is currently
  850 KB / 1,655 KB compressed. Both are fetched only when the view is opened.
  Worth storing as impact *times* rather than node indices, since the overview
  has no node array to index into.
- **A republish**, which the overview already needs to appear on the hosted
  shelf at all.
- **Performance.** The current filaments are polylines over a shared sheet, and
  the implementer measured that a gradient stroke over hundreds of subpaths
  costs 61 ms against 7 ms flat. Curves that converge are more path per
  filament, and the 600 case already sits at 7.4 ms. Measure at 600 before
  committing to a curve shape.
- **Legibility.** 600 filaments converging on one line concentrates all of them
  into the same few hundred pixels near MASTER. The current parallel design is
  legible *because* it does not converge. This may trade a readable field for a
  pretty knot, and the only way to know is to draw it.

## 7. How to test it

1. **Every stem lands on a commit that exists**, and on MASTER only where
   `baseNodeIdx` is on the spine. Assert against the plan, not the picture.
2. **The count still equals the drawn line count** — the invariant the view
   exists for. Attaching lines must not drop or duplicate one.
3. **Nothing is drawn past the playhead**, including a stem whose base is in
   the past and whose head is at the frontier.
4. **Frame timing at 600**, against the 7.4 ms baseline, before and after.
5. **The floating fraction is reported, not hidden** — a test that Linux shows
   fewer attached filaments than Kubernetes and says so.

## 8. Open questions

1. How deep is the base hierarchy on Linux? Unmeasured, and it decides B.
2. Do the 0.003% of Linux threads with no base (3 of 108,751) come from a page
   boundary or a root? They are noise, but they need a defined drawing.
3. Should a merge landing be drawn at all, or only the branch point? A stem
   asserts less than an arc: leaving is one fact, rejoining is a second, and
   the second is where the 60% on Linux goes wrong.
