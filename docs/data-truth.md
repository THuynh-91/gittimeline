# Data truth

GitTimeline may exaggerate energy, curvature, timing and impact. It may never change ancestry. This document is the contract.

## What Git proves and what it does not

- Commit identities and parent lists are exact for every fetched commit. Ancestry, divergence, merge structure and causal order follow from them.
- Commits do **not** record the branch they were made on. Branch names are refs that move and disappear. GitTimeline therefore works with **threads** (a path cover of the DAG) and attaches names only from current refs (`branch:`/`tag:` records). Threads without a surviving ref are labelled `thread NN` or left unlabelled — never guessed from commit messages.
- Rebased, squashed, force-pushed or garbage-collected history is gone. GitTimeline visualizes what survives and says so.

## Provenance classes

| Class | Where it appears | Treatment |
|---|---|---|
| `exact` | commits, parent edges, refs returned by GitHub | solid nodes and paths |
| `derived` | threads, timestamps corrected for causality, eras, spine fallbacks | solid geometry, labelled "derived" in the inspector/events |
| `aggregate` | `AggregateSpan` ribbons | thick ribbon with the member count; entry/exit commits stay exact |
| `estimated` | reserved for sampled measures (not used by the GitHub adapter today) | dashed/soft style |
| `unknown` | parents outside the fetched window, unloaded spans | dashed grey "history not loaded" edge, dashed node ring, warning badge |

The top-bar badge shows `exact`, `partial` or `synthetic`. The **What am I seeing?** panel lists the coverage sentence, warnings, structure counts, the pinned tip and the engine versions.

## Rules the code enforces (and tests assert)

1. Every drawn non-unknown edge corresponds to an input parent relation, drawn exactly once (`tests/unit/compile.test.ts → assertInvariants`).
2. A commit with an unloaded parent is a **boundary**, never a root. It gets one "history not loaded" edge per missing parent.
3. Octopus merges keep every parent; criss-cross merges keep every secondary edge.
4. Presentation time is corrected only enough that a child never precedes a parent; raw author/committer times are preserved and shown in the inspector. Corrections above one day are surfaced as warnings.
5. The primary spine is the first-parent chain of the default branch tip. Fallbacks (selected ref, largest current branch, highest-salience tip, derived presentation spine) are recorded in `coverage.warnings`.
6. Aggregation happens **after** ingestion and only over fully known, plain linear runs (one known parent, one child, no refs, not a junction or thread endpoint). How much is collapsed is decided by the target duration, and a single uniform run-length threshold is applied so similar runs are always treated alike. Boundary edges are kept; members are listed; expansion recovers the exact chain.
7. Sampling before ingestion never becomes topology: a truncated fetch yields boundaries and the sentence "N recent commits loaded; earlier topology is not yet available".
8. Contributor identity keys prefer the GitHub numeric id, then login, then a hash of normalized name+email. Raw e-mail addresses are never stored, rendered or exported.
9. Repository text is hostile: control/bidi characters are stripped, lengths are capped, everything renders as text, only `https://github.com/...` links are navigable, prototype-polluting keys are dropped at every boundary.

## Partial history, rate limits, offline

- Anonymous GitHub access is limited per network (about 60 requests/hour, 100 commits per request). Ingestion reads the real headers, keeps a reserve, and stops honestly. A partial dataset is compiled and labelled; the banner states the reset time GitHub reported.
- A fine-grained read-only token raises the ceiling to about 5,000 requests/hour and the page budget from 40 to 400. It is offered inline on the rate-limit error, held in memory for the tab only, and never persisted, logged or shared.
- Pages are cached in IndexedDB with their ETag and next-page link, so repeat visits use conditional requests (GitHub does not charge a 304 against the limit) and offline visits replay cached pagination, marked "served from your local cache".
- A rate limit before any data yields an error card with the reset time and, when available, an offer to play the cached copy. Nothing pretends to bypass GitHub.

## Two clocks

Performance time `P = f(H)` is monotone in historical time and serialized in `timeMap`. Seeking by date and by performance position use the same table. The caption and transport always show both; the timeline can draw either axis.
