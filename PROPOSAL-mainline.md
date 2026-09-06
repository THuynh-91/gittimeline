# Reading the main line — a mini proposal

Written 2026-09-06, after chasing "MASTER is being surpassed" to its cause.
Two ideas, one measurement that killed a third, and the decisions they need.

---

## What we now know

**The lines that appeared to run past MASTER were a routing bug, not data.**
Merges were drawn as a symmetric S-curve, which reached the spine's height
about 45% of the way across and then travelled along it to the merge commit —
painting main's own path ahead of where main had got to. Fixed in `48ca9d7`.

**Main is barely behind at all.** Measured after the fix, commits that have
landed but sit later than main's newest commit:

| | commits ahead of main | on branches |
| --- | ---: | ---: |
| kubernetes @25% | 2 | 2 |
| kubernetes @50% | 0 | 0 |
| kubernetes @75% | 0 | 0 |
| cpython @25% | 1 | 1 |
| cpython @50% | 0 | 0 |
| cpython @75% | 1 | 1 |

Obvious in hindsight: every merge *is* a commit on main, and these projects
merge constantly, so main is never far behind in commit count. **This kills the
"N commits ahead of main" readout** that looked like the headline feature. It
would show `0` almost always.

Cost of the query, for the record: two binary searches over the impact order
plus a walk of the gap, **0.0–0.1 ms**. Cheap. Just not interesting.

---

## Proposal A — emphasis, not position · small, no rebuild

Main is already semantically distinct: ivory, where branches are
contributor-coloured. It fails only at density, when everything glows and it
becomes one bright line among fifty.

- Main's stroke a little heavier, and its glow held while neighbours' is
  attenuated by distance from it.
- Nothing moves. No lane changes, no camera changes, no compiler changes.

**Deliberately modest.** Developers do not stare at main — they read the fan of
parallel work. Over-emphasising the trunk fights what they are actually looking
at, and this is an audience that can find a branch line unaided.

**Risk:** changes what every repository looks like. Reversible, but it is a
judgement call about the picture rather than a defect fix, so it wants a yes.

---

## Proposal B — say what the time axis uniquely knows · medium, no rebuild

The axis here is the clock, which no other Git tool does — gitk,
`git log --graph`, GitKraken and GitHub's network graph are all topological,
where main is the trunk by construction and *cannot* be passed. That is the
whole differentiator, and the app currently draws its consequences without ever
naming them.

Since "ahead of main" turned out to be nothing, the questions worth answering
are the ones about **concurrency and latency**, which are genuinely unanswerable
in a topological view:

1. **How many branches are open right now.** `maxConcurrentThreads` already
   exists (kubernetes: 284) but only as a compile-time stat, never on screen.
2. **How long a branch lived before it landed.** Every thread has `xStart` and
   `xEnd`; the distance between them *is* its lifetime, and it is already drawn
   — just never quantified. "This branch was open 34 days" on selection.
3. **Merge cadence.** Whether a project lands work steadily or in Friday
   bursts. Visible in the picture; not stated anywhere.

The minimal version is (1) and (2): a live count in the transport, and a
lifetime on the thread you click. Both derive from geometry already in the plan.

**Risk:** scope creep into a dashboard. This project is deliberately spare, so
the discipline is one number in the transport and one line on selection — not a
panel.

---

## What I would not do

**A topological layout mode.** It would make main unpassable by construction,
and it would make the app dishonest about its own axis: the date readout, the
scrubber, the year ticks and the whole performance clock all derive from x being
time. It is also a crowded field where this would arrive years behind.

---

## Decisions needed

1. **Proposal A** — heavier main and distance-attenuated branches, yes or no?
   It changes every repository's appearance.
2. **Proposal B** — is the open-branch count worth a slot in the transport, and
   is branch lifetime worth showing on selection?
3. If B is wanted, does the count belong in the transport or the date bar?
