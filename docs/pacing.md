# Where the runtime goes, and the one aggregate that eats Node.js

Measured 2026-09-07 from the published manifests and geometry pages in
`.catalog-release/`. No browser, no network.

**This document was wrong on 2026-09-07 and was rewritten the same day.** An
adversarial review recomputed every figure and refuted three of them, took the
measurement the first version said was missing, and found that the fix it
recommended already exists. What follows is the corrected account; §5 keeps the
errors, because how they happened is the useful part.

Pacing changes mean a `choreographyVersion` bump and a full republish, so the
argument has to be settled before anything is rebuilt.

---

## 1. The measurement

Runtime per calendar year, as a share of the show. `manifest.years` ends with a
**sentinel** entry labelled `lastYear + 1` and clamped to the last node's
impact — `scripts/catalog-release.mjs:63` already drops it with
`slice(0, -1)` — so the last real year's share must be taken against
`duration − CLOCK_TAIL`, not `duration`. The first version of this document did
not, which is where its headline number came from.

| entry | duration | 2016 onward | 2018–2026 | years under 0.05 s | fattest : thinnest |
|---|---|---|---|---|---|
| **python/cpython** | 3,178.9 s | 619.6 s — 19.5% | **9.71 s — 0.305%** | **22** | **213,610 : 1** |
| **nodejs/node** | 135.9 s | **0.073 s — 0.054%** | 0.06 s — 0.044% | **11** | 8,231 : 1 |
| **facebook/react** | 550.7 s | 162.1 s — 29.4% | 72.7 s — 13.2% | 1 | 6,086 : 1 |
| public-apis | 316.6 s | 312.4 s — 98.7% | 217.5 s — 68.7% | 3 | 5,887 : 1 |
| chromium | 165.0 s | 114.3 s — 69.3% | 100.6 s — 61.0% | 3 | 1,124 : 1 |
| llvm-llvm-project | 154.6 s | 100.4 s — 65.0% | 84.2 s — 54.5% | 0 | 107 : 1 |
| rust, tensorflow, vscode, mdBook, kubernetes, linux | — | 63.6–99.3% | 52.2–86.0% | **0** | 5–504 : 1 |

**Node.js gives 0.054% of its show to 2016 onward** — 73 milliseconds of a
136-second performance — and eleven of its years get under 0.05 s each.

**CPython is worse, at both ends.** Its sixteen years 1990–2005 get 0.0026 to
0.0066 s each, 1.10 s in total, which is 0.03% of a fifty-three minute show;
and its whole 2018-onward decade is 9.71 s, or 0.305%. React gives 2015 alone
36.7% and its last seven years 3.42 s — 0.62% — so its 2016-onward share is
worse than Chromium's or LLVM's, the two entries the first version of this
document held up as healthy.

Six of the twelve entries have no thin year at all.

## 2. The mechanism: one runaway aggregate, not a diffuse property

Runtime is allocated per **visible arrival** — whatever survives aggregation —
and `src/choreography/compile.ts:300` makes that explicit:
`duration = max(targetSeconds, HEAD + TAIL + visible.length * perNode)`.
Seconds per visible node is flat inside an entry, measured at 0.126–0.143 across
Node's 2009–2015.

So a stretch of history is paid for how well it collapses. Node's later years
do not collapse *well*; they collapse into **one span**:

| year | runtime | % | visible nodes | aggregate members behind them |
|---|---|---|---|---|
| 2011 | 26.563 s | 20.2 | 186 | 2,127 |
| 2012 | 37.963 s | 28.8 | 299 | 2,066 |
| 2013 | 37.187 s | 28.2 | 296 | 1,658 |
| 2014 | 15.054 s | 11.4 | 119 | 939 |
| 2015 | 1.324 s | 1.0 | 10 | **37,698** |
| **2016–2025** | 0.0068 s each | 0.005 | **0 each** | 0 |
| 2026 | 0.0046 s | 0.004 | 1 | 0 |

**Those eleven years hold exactly zero visible nodes, and the 0.0068 s they
appear to receive is not runtime at all.** It is a linear-interpolation
artifact. The second-to-last visible node is dated 2015-05-02 at impact
132.6126 and carries `agg-0-462`: **36,848 members spanning 2015-05-02 to
2026-09-04 — 11.35 years, zero merges**. The last visible node sits at
132.690, which is `duration − CLOCK_TAIL`. So 2015-05 to 2026-09 is **one
0.0774-second interval between two consecutive nodes**, and the year marks for
2016 to 2026 are `mapMonotone` subdividing that single gap pro-rata by wall
clock. It checks out to the digit:
`132.6126 + (244/4143) × 0.0774 = 132.61716`, which is the manifest's 2016 mark
exactly.

Eleven calendar years are eleven subdivisions of one gap.

**And that span is the outlier, not the rule.** Chromium's largest aggregate is
2,426 members over 1.20 years; LLVM's is 676 over 0.36 years; neither has a
span over 1.2 years. Node has exactly one span over 400 days and it holds
36,848 commits — 78% of the repository. CPython has 21 years with zero visible
nodes, public-apis three, React one.

## 3. What to change

The first version of this document recommended sizing a beat by
`log2(memberCount)`, sub-linearly, "instead of one beat per visible node
regardless". **That is already implemented.**
`src/choreography/compile.ts:263`:

```ts
weight = Math.max(1.5, Math.min(3.2, Math.log2(span.memberCount + 1) * 0.55));
```

Node's 36,848-member span computes `log2(36849) × 0.55 = 8.34` and is
**clamped to 3.2**. So the operative fact is not a missing mechanism but that
**ceiling**: a span holding 78% of a repository's commits is worth at most 3.2
beats, the same as a span holding 250.

### A — Raise or remove the 3.2 ceiling · one constant, needs a republish

Uncapped, Node's span would be worth 8.34 beats instead of 3.2 — still
sub-linear, and still nothing like 36,848 commits' worth, but it would give
that stretch a visible duration rather than 77 milliseconds. The clamp exists
to stop one span dominating a show; the question is whether 3.2 is the right
place for it, and 8.34 suggests not.

**Directly testable, and far cheaper than the first version of this document
assumed.** Recompile all twelve entries locally with the ceiling raised and
print the table in §1 again. No publish is needed to find out what it does.

### B — Stop one aggregate spanning eleven years · the deeper fix

A single run covering 11.35 years and 78% of a history is arguably an
aggregation fault in its own right, independent of what a beat is worth. A span
limit in *wall-clock* terms — no aggregate may cover more than, say, a year —
would break `agg-0-462` into eleven runs, each with its own boundary nodes, and
the years would get visible arrivals rather than an interpolated gap.

More invasive, and it raises the visible-node count, which has a ceiling for
reasons of its own. Worth measuring alongside A rather than instead of it.

### C — Say the axis is runtime, not calendar · no republish

The axis is proportional to runtime and only *ordered* by date. Nothing on
screen says so. This is what the rejected time-ticks proposal was trying to fix
and got wrong by making it a fourth disagreeing scale — see
`x/ticks-review/VERDICT.md`. Worth doing regardless of A or B, and the only one
of the three that costs nothing to try.

## 4. Recommendation

**Measure A, then decide.** It is one constant, the harness to evaluate it is
`re-run the compiler and print §1`, and it needs no publish to learn from.
Consider B in the same run. Do not treat Node as a special case: CPython is
worse, and any change has to be judged across all twelve — six of which are
currently well-paced and could be made worse.

## 5. How the first version got it wrong

Kept deliberately, because three of these are patterns rather than slips.

1. **It counted the sentinel year as a year.** `manifest.years` ends with
   `lastYear + 1` clamped to the last node's impact, and the release script
   already drops it. Including it added a flat 3.200 s — `CLOCK_TAIL` — to
   every entry's "2016 onward" figure. That is 2% for Chromium, 3% for LLVM,
   0.02% for Kubernetes and **44× for Node**, so it inflated the healthy
   entries slightly and the broken one enormously. The headline read 2.4% and
   the truth is 0.054%.
2. **It reported `CLOCK_TAIL` as Kubernetes' thinnest year.** "2027 (3.2 s)" is
   not a year of a history whose tip is 2026-09-04. Kubernetes' thinnest real
   year is 2014 at 451.4 s — seven and a half minutes. It has no thin year at
   all.
3. **It concluded "this is not a general pacing fault" from a four-entry sample
   that excluded the worst entry** — and the number that refutes it was already
   written down in this repository, in `docs/status.md` §5: "per-year width
   across one history varies by up to 213,610 : 1 (CPython), and 22 of its 36
   years occupy under 0.05 s". §3C of the first version *cited the document
   that figure came from*. The reassuring half of the diagnosis was the wrong
   half, and it was the half the recommendation leaned on.
4. **It recommended building something that exists.** `log2` beat sizing has
   been in the compiler all along; the document proposed it as new because it
   read the allocation rule and not the weight function.
5. **It called a measurement missing and then reasoned as though it were
   impossible.** The per-year distribution of visible nodes needed the app's
   page decoder, which runs perfectly well under Node once the module is
   bundled. Taking it turned "a diffuse property of how Node develops" into
   "one aggregate with a name", which is a different fix.
