# How long a show runs, and why density decides it

Moved out of `README.md`, which had grown to twenty thousand characters and
buried "what is this and where can I see it" under five tables of
measurements. The measurements are worth keeping; they were not worth being
the first thing a visitor read.

## Length is derived, not fixed

Each visible commit is given **0.13 seconds** of stage time, enough for its
arrival to read as its own beat, and the history is collapsed into counted
ribbons until what remains fits. The automatic length is therefore the size of
what survives aggregation.

Past **three minutes** the app asks before fetching, because a long show should
be a choice. Past **thirty-five** it stops stretching, because the alternative
was measured and it is not a viewing option: Rust's 248,298 surviving nodes at
a readable moment each came to 32,278 seconds — a nine-hour performance — and
645,561 camera keyframes to plan and carry.

Below the ceiling nothing is compressed. Above it, arrivals do get closer
together, and that is the honest cost of the ceiling existing. Choosing an
explicit length in Settings overrides the pace exactly.

## Density, not size, decides whether a history can be shown whole

A routine pull request — a branch that left the main line, carried a commit or
two and was merged back — collapses into one counted ribbon much as a linear
run does, provided the ribbon can hide the branch point along with the branch.

What cannot collapse is a branch with a story of its own, a stale branch merged
long after it left, or two long-lived lines that integrate into each other.
Those are branch points, and hiding one hides what happened.

Measured on the real histories in the shipped catalog, before and after:

| History | commits | merges | visible before | visible now | before | now |
|---|---:|---:|---:|---:|---:|---:|
| ripgrep | 2,299 | 3% | 335 | 335 | 97 s | 97 s |
| Svelte 2023 | 860 | 3% | 235 | 235 | 86 s | 86 s |
| public-apis 2021 | 1,796 | 44% | 1,587 | 1,171 | 6.9 min | 5.1 min |
| mdBook | 3,293 | 32% | 2,581 | 1,207 | 11.3 min | 5.3 min |

And on the corpus, where the shape is the clean one:

| Fixture | commits | merges | visible before | visible now | before | now |
|---|---:|---:|---:|---:|---:|---:|
| `21-pull-request-treadmill` | 561 | 43% | 561 | 164 | 150 s | 82 s |
| `22-merge-dense-decade` | 2,401 | 50% | 2,401 | 303 | 10.5 min | 97 s |
| `23-back-merge-decade` | 1,921 | 50% | 1,921 | 1,921 | 8.4 min | 8.4 min |

ripgrep and Svelte are collapsed to the budget either way — a nearly linear
history was never the problem — and were not re-measured.

The other two land well short of the corpus because a third of their pull
requests left the main line long before they were merged back. public-apis'
median is sixteen commits and its worst is 888, and that branch point cannot be
hidden unless the ribbon reaches back to cover it.

Both are under three minutes now, but the size probe still treats them as dense
and **offers a shorter span before anything is fetched**, with the length on the
button as an upper bound. Sampling the merge ratio of the most recent hundred
commits costs one request and separates "large" from "long", but it cannot tell
a bubble from a real branch, so it stays pessimistic. Whatever you then pick
plays at the legible pace however long it takes, because you picked it.

Before any of this, mdBook was silently truncated to four minutes and played at
0.10 s a commit.

## The test that holds it

`tests/unit/pacing.test.ts`, with no exceptions: for every history in the
corpus the typical arrival holds the stage for at least an eighth of a second,
the fastest tenth stays above the flicker threshold at 0.06 s, and arrivals
stay under nine a second. Any show that runs past three minutes must have been
predicted dense, so nobody arrives at a long one unasked.

Fixture `23-back-merge-decade` is the history that cannot be collapsed: 960
merges, none of them a bubble, 254 seconds at 0.131 s a commit. Without one
that dense the suite only ever tests the comfortable path, which is how the old
cap degraded real repositories unnoticed.

## Ingestion cost

Measured by driving the real interface (`scripts/usertest.mjs`) with a token:

| Repository | Commits | Requests | Load |
|---|---:|---:|---:|
| ripgrep | 2,299 | 34 | 9 s |
| vite | 9,670 | 108 | 47 s |
| React | 22,345 | 244 | ~2 min |

React's entire history loads with a token, at exact coverage.

Three things keep a very dense project legible rather than a smear: lanes are
capped so thousands of short-lived pull-request branches share outer lanes
instead of pushing the graph tens of thousands of units tall; the camera will
not pull back past a fixed bound and instead stays with the front of the work;
and thread names are budgeted so a named branch is labelled while thousands of
anonymous ones are not.

## Rate limits

GitHub allows roughly **60 anonymous requests an hour per network** — its
limit, not this project's, and not something any browser app can bypass. That
is a few thousand commits.

What stretches it: 100 commits per request, ETag revalidation (an unchanged
page returns 304 and **does not count** against the limit), an IndexedDB cache
across visits, and a budget that stops before exhaustion and plays a truthful
partial performance.

A free fine-grained token with read-only public access raises the ceiling to
about **5,000 requests an hour** and allows 600 pages instead of 40.

When a repository turns out to be large, the app says how large **before
spending anything** — the size probe costs two requests — and offers a single
year, a recent span, or the whole thing. Anything already fetched is reused on
the next visit with no requests at all, and Settings has a "fetch latest
commits" action for fresh data.
