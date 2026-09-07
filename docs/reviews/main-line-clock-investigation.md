# Main-line proposal: controlled clock investigation

Investigated 2026-09-07 against commit `60ec2d4`. This is evidence for a proposed change, not a shipped fix.

## Finding

The proposal correctly identifies unreadable compression, but its suggested weight-ceiling change does not fix the measured example. The clock mistakes a long interval between **visible** nodes for inactivity, even when that interval contains tens of thousands of aggregated commits. Its quiet-gap rule overwrites the aggregate's weighted duration.

In [compile.ts](../../src/choreography/compile.ts), the compiler builds clock items from surviving visible commits and gives aggregate exits a capped logarithmic weight. In [clock.ts](../../src/choreography/clock.ts), `dh > GAP_THRESHOLD` replaces the weighted step with a short quiet-gap step. In [events.ts](../../src/choreography/events.ts), that classification also produces a `QUIET_GAP` caption. Thus the problem affects both animation timing and the statement made to the viewer.

## Method and results

Compiled the actual Node and CPython catalog artifacts using their published presets and seeds. Both baseline plan hashes exactly matched their published sidecars. Four variants ran through the full compiler using isolated in-memory Vite transforms; production source and catalog files were unchanged. No browser or audio playback was involved.

Times below are seconds between the largest aggregate's entry and exit impacts, not total show duration.

| Variant | Node: 36,848 commits / 11.35 years | CPython: 33,481 commits / 15.51 years | False quiet caption at this aggregate |
| --- | ---: | ---: | --- |
| Baseline | 0.0774 | 0.1027 | Yes |
| Remove aggregate weight ceiling only | 0.0771 | 0.1027 | Yes |
| Exempt aggregate exits from quiet-gap rule only | 0.2531 | 0.4102 | No |
| Both diagnostic changes | 0.6368 | 1.0153 | No |

Node's baseline caption is “Quiet span of 11.4 years passes.” CPython's is “Quiet span of 15.6 years passes.” These are not supported by the hidden activity. The slightly different Node result after removing the ceiling comes from effects elsewhere in the normalized clock; it is not a meaningful improvement.

Node's presentation-time interval from 2016 onward takes 0.07284 seconds in the baseline and 0.07256 seconds with only the ceiling removed. The combined diagnostic raises it to 0.59931 seconds. A lower count of years below 50 milliseconds would therefore be an insufficient acceptance test: most of a decade can still disappear in less than a second.

Baseline plan hashes:

- Node: `86f5ca320ea108ff903922d113cb47cf31a9e244bb47ec81aad7e5e994b5b885`
- CPython: `8076afb8336fb280dced41ed70271aa3be4224f8aa9bbee6fcf207dd57f274a1`

The [saved measurements](main-line-clock-investigation.json) include all eight results and year-by-year durations. The [diagnostic harness](main-line-clock-investigation.mjs) runs from the repository root with `node docs/reviews/main-line-clock-investigation.mjs`; it requires the local catalog artifacts and installed dependencies. It writes fresh results to the ignored `x/` directory. The saved measurements describe the revision above; baseline mismatch on a future revision requires investigation, not silently accepting new numbers.

## What this proves, and what it does not

This establishes an independent cause beyond the 3.2 ceiling. It also shows that fixing the classification and ceiling together still leaves an unacceptable Node example. It does not establish optimal pacing parameters or prove that every aggregate contains continuous activity. Exempting every aggregate exit is a diagnostic intervention: a production fix must detect genuine empty intervals from the full loaded history, including real gaps inside aggregates and activity on other branches.

The aggregation budget is another contributor. [aggregate.ts](../../src/choreography/aggregate.ts) derives chunk size from collapsible commits and the remaining visible-node budget. Protected boundaries can consume that budget, leaving a very large plain stretch represented by a single aggregate. Temporal boundaries need to become an explicit constraint, while respecting legal graph boundaries.

## Independent visual cause

The existing [main-as-axis review](main-as-axis.md) measures Kubernetes closing lane spacing at 6.10 pixels in a 1855 × 620 viewport. Its saved local record was checked against the report. Current [canvas.ts](../../src/renderer/canvas.ts) still exempts the tableau from the nominal 26-pixel lane floor, and the explicit shot path uses `shot ? fit : ...`, bypassing that floor altogether.

Changing only the `laneFloor` expression will not fix the explicit shot path. A fix must recompute the closing composition, including scale and center, while retaining the newest commit and main reference in the safe area. Earlier [closing-shot investigations](closing-shot.md) explain why zooming around the old center can lose the endpoint.

These visual measurements were taken by the existing reviews, not newly reproduced in a browser during this clock experiment. Device smoothness and novice comprehension remain validation work. See the [resolution plan](../main-line-resolution-plan.md).
