# Overview ancestry measurement

Measured 2026-09-08 from the local full published plans, using
`node x/overview-hierarchy.mjs`. Raw results: `x/overview-hierarchy-results.json`.
This follows up the open depth question in `proposal-overview-stems.md`.

For every visible side thread, follow its base node to the owning thread,
repeating until a spine node, missing base, or cycle. A direct child of MAIN
has depth 1. These are compiled thread relationships, not necessarily named
Git refs or simultaneously active ancestors.

| Measurement | Kubernetes | Linux |
|---|---:|---:|
| Visible side threads | 56,101 | 108,751 |
| Base on MAIN | 55,542 | 64,947 |
| Merge on MAIN | 55,985 | 43,354 |
| Maximum resolved base depth | 5 | 224 |
| Depth 1–3 | 56,088 | 102,245 |
| Chains ending at an unknown base | 0 | 18 |
| Cycles | 0 | 0 |

The 18 unresolved Linux chains include descendants of missing-base threads;
they are not a finding of 18 missing immediate bases. The proposal reports
three missing immediate bases. Neither missing bases nor their descendants
should be attached to MAIN by default.

Plan hashes:

- Kubernetes: `e1c36c48bbab89f413dc9d36a20498fbb4bfeec69d40cf4986a95d95b266710e`
- Linux: `4d7ba8596d7b120968ccdc3e3933190432148a0e63d72886c0346fe4f2e6ca9e`

## Implication for the proposal

Keep A + D as the first implementation: attach only verified MAIN bases and
explain selected lineage. An unrestricted lane for every ancestry level is
not justified by these results. About 94% of Linux threads are within three
levels, but a long tail reaches 224. Historical depth alone does not establish
how much simultaneous hierarchy needs drawing.

Before B, measure ancestor visibility at the 600-thread peak and throughout
playback, then prototype parent connections with a bounded display depth and
explicit grouping or off-screen-parent indications. Validate count
conservation, no future connections, selection, and quiet-machine frame cost.

Endpoint times alone are insufficient for A + D: the payload also needs to
identify the owning thread or MAIN and distinguish unknown endpoints. Measure
the actual gzip delta; the proposal's raw-number estimate cannot establish
that the compressed index will double. A selected future merge must not be
drawn or described as already completed.

No stem rendering or catalog publication was performed in this measurement.
