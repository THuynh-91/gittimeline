# Kubernetes and Linux: main-line validation

Investigated 2026-09-07 against `60ec2d4`. Production source is unchanged. A camera change was built and tested as an isolated prototype.

## Conclusion

For these two repositories, prioritize closing-camera composition and the readability of parallel branch activity. Do not treat the Node quiet-gap defect as their established cause. Both full-plan baseline recompilations match the published plan hashes, and neither published plan has a `QUIET_GAP` event.

The tested camera prototype preserves the existing 26-pixel nominal lane floor in the closing shot, recalculates its horizontal center so the newest resident commit sits at 90% of the safe width, and centers vertically on MAIN. It retains the existing time-based easing and affects streamed closing shots only. This is a promising visual correction, not a complete production implementation: branch cropping, endpoint/label collisions, accessibility, physical-device performance, and comprehension still need broader validation.

## Timing and aggregation

| Baseline | Kubernetes | Linux |
| --- | ---: | ---: |
| Loaded commits | 140,858 | 1,481,850 |
| Visible plan nodes | 125,973 | 332,279 |
| Show duration | 16,380.69 s | 43,200.47 s |
| Largest aggregate by member count | 135 | 2,779 |
| Historical span of that aggregate | 3.67 hours | 37.99 days |
| Entry-to-exit presentation duration | 4.4716 s | 358.4981 s |
| Calendar years below 50 ms | 0 | 0 |
| Quiet-gap events in published plan | 0 | 0 |

Largest by member count is not longest by historical span. The longest Kubernetes aggregate spans 250.27 days and contains five commits. Linux's longest spans 605.82 days and contains 712 commits. These warrant temporal-coverage review, but they do not establish Node's single-decade/subsecond failure in these repos.

An uncapped-weight Kubernetes recompile also completed: the largest aggregate changed from 4.4716 to 4.5723 seconds, with unchanged total duration. The Linux uncapped run was interrupted after the independent plan audit established that neither baseline contains quiet-gap events. The remaining diagnostic variants were not completed; no four-variant Linux result is claimed. Their priority fell behind the directly reproduced visual failure.

## Closing-view experiment

Each repo was measured at its midpoint and ending in six viewport shapes, first with current code and then with the isolated camera change: **24 baseline and 24 prototype samples**. DPR was 1 for these geometry checks. Nominal spacing is `54 × viewport.scale`; it does not guarantee that every curved or shared-lane stroke is separated by that distance.

| Viewport | Kubernetes closing spacing | Linux closing spacing | Prototype, both |
| --- | ---: | ---: | ---: |
| 1280 × 800 | 8.76 px | 6.83 px | 26 px |
| 1855 × 620 | 6.10 px | 6.10 px | 26 px |
| 1920 × 1080 | 12.89 px | 10.06 px | 26 px |
| 390 × 844 | 7.10 px | 7.10 px | 26 px |
| 844 × 390 | 2.71 px | 2.69 px | 26 px |
| 820 × 1180 | 14.36 px | 11.21 px | 26 px |

All midpoint spacing values were unchanged by the prototype. MAIN's label remained inside the viewport in all samples, and no page errors occurred. Native media getters were checked and played media remained at volume zero with muting enabled. Settled stage images were captured by copying the canvas, and the Kubernetes wide-view before/after images were visually inspected. The prototype makes the branch paths substantially easier to distinguish by showing a smaller portion of the ending.

The first local run lacked streaming packages and fell back to the entire plan. That run was stopped and excluded. Accepted runs used matching local streamed packages, with their plan hashes checked against the current catalog sidecars and a non-null loaded geometry window required. This reproduces the failure without cloud requests; it does not measure remote loading latency or establish that the remote release has identical assets today.

## Branches passing MAIN

A full-plan scan counted later landed branch nodes relative to the latest landed MAIN node. Kubernetes has such nodes for 54.3% of runtime; Linux for 86.3%. The maximum consecutive non-main run is 35 nodes for Kubernetes and 637 for Linux. Their maximum presentation-time separation from the latest landed MAIN commit is 4.01 and 95.39 seconds respectively.

These are whole-plan measurements, not simultaneously visible on-screen counts, and not Git ahead/behind commit counts. MAIN's revealed stroke also interpolates toward its next commit. Consequently these numbers describe why later branch activity is common; they do not prove that every such node is right of the animated tip in a particular frame.

The tested camera change does not alter this relationship. A subsequent main-endpoint treatment and first-time-viewer test should address it directly, without extending MAIN into nonexistent work or forcing branches into a false order.

## Motion and limits

The motion harness tests midpoint playback for 15 seconds and playback into the ending for 11 seconds, at DPR 2 on 1855 × 620 and 390 × 844 viewports. It records frame intervals, presentation-time advance, camera transitions, and native media state. The ending run starts eight seconds before completion, so its average clock ratio over eleven wall-clock seconds is deliberately below one after the show stops; this is not a slow-clock defect.

Initial runs overlapped offline compiler work and are retained separately as contended observations. Final performance results and compact measurements are recorded in the companion evidence JSON. An accelerated NVIDIA RTX 3060 Ti desktop rendering a phone-sized viewport is not a physical phone test. The camera prototype must not be described as optimized for every device on this evidence.

The sampled entry into tableau retained position and scale continuity in both baseline and prototype. That establishes absence of the old initial cut in these samples, not a universal bound on camera acceleration through every transition.

## Reproduction and next implementation

The companion diagnostic scripts build a camera variant using an in-memory Vite transform and run the muted browser matrix. They do not edit `src/`. Run them from the repository root with installed dependencies, a fresh baseline build served on port 4199, and the matching catalog packages. The browser harness currently resolves package resources from the local review cache at `x/rev2/dist/catalog`; if absent, generate matching packages with `scripts/package-catalog.mjs` and point the harness to that directory.

Promote the camera composition into production only with tests for actual endpoint positions, crop behavior, narrow-screen labels, seek/resize, reduced motion, and closing transition continuity. Profile the dense midpoint separately: a readable final still does not establish smooth ongoing playback. Keep the Node/CPython timing repair as a separate compiler task. Re-run these checks on weekly catalog candidates so changing branch structures remain covered.
