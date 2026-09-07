# Where the runtime goes, and why Node.js is broken

Measured 2026-09-07 from the published manifests in `.catalog-release/`, which
carry each entry's `duration` and its `years` array — `[calendar year,
performance second at which that year starts]`. No browser, no network: this is
arithmetic on what shipped.

Written because pacing changes mean a `choreographyVersion` bump and a full
republish, so the argument has to be settled before anything is rebuilt.

---

## 1. The measurement

Runtime given to each calendar year, as a share of the whole show.

| entry | duration | 2016 onward | the four fattest years | the thinnest years |
|---|---|---|---|---|
| **nodejs/node** | 135.9 s | **3.27 s — 2.4%** | 2012 (38.0 s), 2013 (37.2 s), 2011 (26.6 s), 2014 (15.1 s) | 2017–2026, **0.007 s each** |
| chromium/chromium | 165.0 s | 117.5 s — 71% | 2013, 2025, 2024, 2023 (13–17 s) | 2001–2006, 0.015–0.12 s |
| llvm/llvm-project | 154.6 s | 103.6 s — 67% | 2025, 2022, 2023, 2024 (9.9–10.8 s) | 2001–2006, 0.10–0.47 s |
| kubernetes | 16,380.7 s | 13,866 s — 85% | 2016, 2017, 2015, 2019 | 2027 (3.2 s), 2014 |

**This is not a general pacing fault.** Three of the four weight the recent
decade heavily — 67%, 71%, 85% — which is what anyone would want, and their
thin years are genuinely thin ones: Chromium's and LLVM's 2001–2006 predate the
projects and are imported prehistory.

**Node.js is the outlier, and it is the wrong way round.** Its busiest decade
gets 2.4% of the show, and each year from 2017 to 2026 gets seven
thousandths of a second — 0.4 of a frame at 60 fps. Eighty-six per cent of the
runtime goes to 2011–2014. A viewer watching Node.js sees four years of its
history for two minutes and then the following decade in a third of a second,
which is exactly the "abrupt date jump" that was reported.

## 2. The mechanism

Runtime is allocated per **visible arrival**, not per commit.
`docs/choreography.md` is explicit about it: every visible arrival gets the same
beat, and a quiet span longer than three weeks is replaced by a whoosh of at
most 0.9 s. A visible arrival is whatever survives aggregation — a routine run
of commits on one thread collapses to a single aggregate node drawn once with
its count.

So the runtime a stretch of history receives is a function of **how badly it
aggregates**, and has almost nothing to do with how much work it contains.

The three entries' shapes, from the same manifests:

| entry | commits | aggregated away | left visible | merges | threads |
|---|---|---|---|---|---|
| nodejs/node | 48,272 | 47,259 (97.9%) | ~1,013 | **349** | 327 |
| chromium/chromium | 1,817,062 | 1,816,139 (99.9%) | ~923 | **64** | 64 |
| llvm/llvm-project | 595,778 | 594,884 (99.8%) | ~894 | **5** | 6 |

All three end up with about a thousand visible nodes, which is the ceiling
doing its job. The difference is *where* those thousand fall, and that is
decided by where the aggregator finds boundaries. Node has 327 threads against
Chromium's 64 and LLVM's 6 — and Node's threads are concentrated in the io.js
fork era, 2011–2015. Many threads means many aggregate boundaries means many
visible arrivals means most of the runtime. After Node moved to
squash-and-rebase landing on a single line, its later years are one long
collapsible run and the aggregator leaves almost nothing behind.

**Confirmed by the manifests; not yet confirmed at node level.** The
distribution of *visible* nodes per year would settle it beyond doubt, and it
lives only in the binary `.gtperf.bin` pages, which need the app's decoder to
read. That is the one measurement this document is missing and the first thing
to take before rebuilding anything.

## 3. What to change

Three options, in increasing order of how much they alter the project's own
claims.

### A — Give a year a floor, in the compiler · smallest, needs a republish

Reserve a minimum share of runtime for any calendar year that contains commits
at all: say `0.4 / yearsWithCommits` of the duration, taken proportionally from
the fattest years. On Node that would move 2017–2026 from 0.007 s each to about
five seconds each, at the cost of taking 2011–2014 down from 86% to roughly
half.

Cheap, and it does not touch the topology or any claim the app makes. It is
also arbitrary: the number 0.4 has no justification beyond looking right, and
this project has been bitten twice by constants chosen that way.

### B — Allocate beats by commits as well as by arrivals · medium, needs a republish

Give each aggregate a beat *length* that grows with the count it represents,
sub-linearly — `sqrt(count)` or `log(count)` — instead of one beat per visible
node regardless. A run of nine thousand commits collapsed into one aggregate
would then be worth more time than a run of nine, which is the thing the
current rule denies.

This is the honest fix, because it makes runtime track *work* rather than
*collapsibility*, and it needs no magic minimum. It changes every entry's
pacing, which is the risk: Chromium and LLVM are currently well-paced and would
move too.

### C — Stop claiming the axis is uniform, and say what it is · no republish

The axis is proportional to runtime and only *ordered* by date. Nothing on
screen says so, and the date readout invites the opposite reading. This is what
the rejected time-ticks proposal was trying to fix and got wrong by making it a
fourth disagreeing scale (see `x/ticks-review/VERDICT.md`).

Worth doing regardless of A or B, and it is the only one of the three that
costs nothing to try.

## 4. Recommendation

**B, after taking the node-level measurement in §2.** A is a patch over a rule
that is wrong rather than merely mis-tuned, and its constant would need
defending forever. B is one change to how a beat is sized, it removes the
coupling between runtime and collapsibility that produced this, and it can be
validated before publishing by compiling all twelve entries locally and
printing this same table.

Do not republish on the strength of this document alone. The table above is
enough to prove Node is broken and enough to rule out a general pacing fault;
it is not enough to predict what B does to the other eleven.
