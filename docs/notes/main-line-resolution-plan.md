# Main-line resolution plan

Status: recommended implementation plan, 2026-09-07. No production changes shipped by this investigation.

## Decision

Keep the time-directed branch animation, but repair its representation of compressed activity and make the main reference readable throughout playback and the closing shot. A branch can legitimately have later work than the latest landed MAIN commit. MAIN should be identifiable; it should not be artificially extended or forced to lead every branch.

The [original proposal](proposal-main-line.md) describes three related failures: viewers cannot interpret branches passing MAIN, dense closing views fuse lanes, and years of active history disappear almost instantly. A counter explains only part of the first. The [controlled compiler experiment](reviews/main-line-clock-investigation.md) identifies a timing defect that the proposal's weight-ceiling recommendation misses.

## 1. Correct activity classification before tuning speed

Build interval activity information from the full loaded commit history before visual aggregation. Keep activity classification separate from the spacing between surviving visible nodes. Use the existing causally ordered presentation dates consistently, and retain coverage boundaries so incomplete history cannot be called empty history.

Only emit `QUIET_GAP` for an interval supported as empty within known coverage. For compressed activity, show an aggregate count and historical range with sufficient dwell to read it. Genuine quiet intervals within a large aggregate must remain distinguishable; other branches' activity must also participate in the classification.

The diagnostic “aggregate exits are never quiet” flag is not the implementation. It proves where the current assumption fails. Similarly, removing the 3.2 weight ceiling alone is ruled out as a fix: Node remains at approximately 77 milliseconds for 11.35 years.

Acceptance:

- Node and CPython no longer describe their largest active aggregates as quiet spans.
- Genuine empty intervals still compress and receive appropriate captions; unknown coverage stays unknown.
- Fixtures cover activity hidden in an aggregate, a real gap inside an aggregate, overlapping branch activity, and incomplete coverage.

## 2. Preserve historical coverage during aggregation

Prototype a maximum active historical span per aggregate, initially one year, using actual commit boundaries. Compare a quarter-year variant where the annual result remains unreadable. These are experiment settings, not established perceptual thresholds.

Preserve merge structure, protected refs, and legal enclosed graph boundaries. Do not invent a commit at a calendar boundary or split a graph region illegally. If a region cannot be divided safely, mark its compression explicitly and give its summary enough presentation time.

Treat the current visible-node target as a soft budget when satisfying it would erase a decade. First reserve meaningful historical boundaries, then allocate detail within those spans. Derive the resulting runtime from that representation. If the result is too long, expose deliberate summarization rather than silently squeezing the same activity back into a fraction of a second.

Measure dwell in **final performance seconds**, after every weighting, normalization, and duration limit. Start a local comparison with a one-second minimum for each newly introduced active-period summary, then adjust through viewing tests. This is a prototype parameter; it must not become an untested global pause on every commit.

Acceptance:

- The known Node decade no longer traverses as one subsecond aggregate.
- Active periods have inspectable boundaries or an explicit readable summary; a good “years below 50 ms” count alone cannot pass the change.
- Report year-by-year runtime, longest aggregate spans, visible counts, total duration, and recent-history coverage across all twelve catalog entries.
- Preserve deterministic compilation, ancestry ordering, commit accounting, protected refs, and agreement between full and streamed time maps.
- Compare well-paced entries too; fixing Node and CPython must not erase their tempo variation or create excessively long idle-looking holds.

## 3. Recompose the closing shot for readable lanes

Prefer a readable closing portion of the graph anchored on MAIN and the newest work. Show that it is a portion of the history; do not imply that a cropped view contains every branch. A separate overview can be considered later if users need it.

Apply the existing nominal lane-separation constraint to the explicit tableau shot path, not just the ordinary camera. Recalculate bounds, scale, and center together. Keep the main reference, newest commit, and their labels inside the safe area. If they cannot all fit at readable scale on a narrow screen, use a deliberate staged focus transition between them, retaining a visible MAIN reference cue; do not shrink everything until it fuses.

Retain the fixes that removed tableau punch and corrected camera travel. Ease into the new composition without an abrupt zoom or a frame-rate-dependent endpoint. Do not merely increase `LANE_GAP`: a fit-to-bounds camera can cancel that increase by zooming out.

Nominal lane spacing is only a starting constraint. Curves, reused lanes, glow, and reduced render resolution affect actual separation. Test neighboring strokes in dense portions at render scales 1, 0.75, and 0.6. Constrain glow or simplify secondary effects when needed to preserve distinct strokes. Do not sacrifice the main line, topology, or labels to maintain decorative effects.

## 4. Strengthen MAIN's endpoint and explain the picture

Use the existing `spineTip(t)` geometry to place a recognizable endpoint marker on the actually revealed main stroke. Keep the main stroke crisp and its label visibly associated with that endpoint. Use shape and contrast as well as color; preserve contributor color meaning. The main line already has a stable axis and a nameplate, so this is a targeted legibility improvement.

Keep the shipped “the show has reached” date wording. Add a short explanation where it can be discovered: branches can continue developing between MAIN commits, and compressed spans change the pace of historical time. Do not add a second competing date.

Do not make “N ahead of MAIN” the primary fix. Existing measurements count drawn nodes, some representing many commits; this is not Git's ahead/behind calculation. Only add a precisely labeled count if comprehension testing shows a remaining need after the picture is corrected.

## Validation and sequence

Implement and validate activity classification first, then compare temporal aggregation variants. The renderer correction can be developed independently, but review the combined result before choosing final pacing. Package regenerated catalog plans only after the compiler policy is selected, following the repository's engine/version compatibility rules. This plan does not authorize deployment.

Use all twelve entries for deterministic geometry and timing checks. Cover phone portrait (390 × 844), laptop (1280 × 800), short wide window (1855 × 620), and desktop (1920 × 1080). Add phone landscape and tablet interaction checks. Exercise DPR 1 and 2 on the dense cases and all three render scales. Check closing endpoints, actual stroke separation, label clipping, seek/resume, reduced motion, and resize during the final transition.

Measure browser frame-time distributions on accelerated desktop and representative physical iOS and Android devices. Target sustained 60 fps where supported and a deliberate stable 30 fps fallback on weaker devices. Report measured hardware and limitations; headless software-rendering results cannot establish phone performance. Reduce optional glow and particles before compromising readable geometry. Use paused, settled screenshots for pixel comparisons and active playback for frame-time measurements.

Keep all playback tests natively muted before media starts, retaining the existing mute regression coverage. Run the appropriate compiler, renderer, streaming, and browser checks when implementation changes land; documentation alone does not establish these gates as passed.

Finally, run a small pilot with five first-time viewers, before explaining the display. Ask them to identify MAIN's endpoint, interpret the date, explain a later branch, distinguish summarized activity from inactivity, and interpret the closing crop. Aim for at least four correct interpretations out of five on each question before expanding the test. This is a usability pilot, not statistical proof. If the same misunderstanding persists, revise the visual treatment before adding more counters.

The agreed **weekly** refresh cadence remains a separate follow-up requirement. Re-run these timing and closing-geometry checks on each candidate catalog refresh, including recent-history coverage, so this fix is evaluated against new commits instead of becoming a static snapshot. Scheduling and publication monitoring are not implemented by this plan.

## Explicitly excluded shortcuts

- Extending MAIN into an empty ruler falsely suggests work beyond its actual endpoint.
- A uniform calendar grid does not describe this warped performance-time axis.
- A topological-layout replacement would change the product and its clock architecture; it is unnecessary for these confirmed defects.
- A weight-ceiling-only change leaves the demonstrated failure in place.
- Lower render resolution alone can further merge crowded branch strokes.

The solution is complete only when the timing is truthful, the active history is readable, and the main reference survives the closing composition on supported screens.
