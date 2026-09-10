# Working notes

Not documentation. This is the project's working history: the original brief,
proposals written before the work, plans that were partly abandoned, status
snapshots, and measurement logs.

It is kept, and kept out of the way, for two reasons.

**Several of these are cited from the code.** `src/renderer/canvas.ts` points at
`proposal-frame-budget.md` for the four-arm attribution behind the bloom, and
`tests/e2e/present.spec.ts` points at `proposal-present-and-parallel.md` for why
its thresholds are what they are. A comment that explains a strange number by
citing a document is only useful while the document exists.

**Some are wrong, and that is the point.** `proposal-frame-budget.md` contains a
retraction of its own central claim, and the retraction is more useful than the
proposal: three separate measurements of the same thing were confounded in three
different ways, each one plausible until the next disproved it. Deleting the
mistakes would leave a record of a project that got everything right first
time, which is not what happened and not a useful thing to hand the next person.

If you are trying to understand how the app works, none of this is the place to
start. Go to [`docs/`](../) — architecture, data truth, choreography, testing,
accessibility — and the [README](../../README.md).

## What is here

| | |
|---|---|
| `task.md` | the original brief the project was built from |
| `task-additional.md`, `PLAN.md`, `TASKS.md` | direction and state, at various points |
| `codex-tasks.md` | work packaged up to hand to another agent |
| `proposal-frame-budget.md` | why a frame cost 49 ms, and the three wrong measurements on the way |
| `proposal-main-line.md` | making the main line legible on a large history |
| `proposal-present-and-parallel.md` | marking the present, and main appearing to lag |
| `main-line-resolution-plan.md` | the plan that came out of those |
| `static-playback-plan.md` | shipping pre-built histories instead of fetching them |
| `pacing.md` | where the runtime goes, and the one aggregate that ate Node.js |
| `overview-hierarchy-evidence.md` | measurements behind an overview that was not shipped |
| `catalog-packaging-log.md` | a run log from building the shelf |
| `status.md` | a long snapshot of what stood and what needed work |

The adversarial reviews live one folder over, in
[`docs/reviews/`](../reviews/), and have their own index.
