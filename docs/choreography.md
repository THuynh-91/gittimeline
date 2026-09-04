# Choreography

The compiler turns graph facts into a small, explainable vocabulary. Every movement traces back to an event with a salience score; salience changes amplitude and staging, never meaning.

## Clocks (`src/choreography/clock.ts`)

1. **Natural steps.** Each visible commit gets an interval that shrinks steeply with local phrase intensity (calm ≈ 1.0 s, peak ≈ 0.12 s) and grows for merges, which need approach room. A quiet span longer than three weeks is *replaced* by a single short whoosh of under a second, whether it covers a month or a decade: the calendar spinning in the date readout does the talking, so dormancy never costs the viewer time. The three beats after a big merge accelerate away from it, giving the sequence its climb-and-drop shape.
2. **Tempo regions.** Per 4-second phrase, the average intensity picks a region (72 / 100 / 132 / 164 BPM) with hysteresis so the beat does not twitch.
3. **Quantization.** Impacts snap *upward* to the beat grid (quarter, eighth or sixteenth subdivisions by intensity) subject to: global order never changes; consecutive commits on one thread are at least half a beat apart; a child lands at least half a beat after each parent; merges reserve 1.25–2.5 beats from every parent; a diverging first commit reserves 0.9 beats from its base.
4. **Scaling.** The natural timeline is scaled to fit the target duration, never stretched by more than a third, so a small repository ends early rather than crawling. The duration is authoritative: there is no minimum step that could inflate it, and where many commits land together the result is an honest flurry. When a dense history implies an absurd nominal tempo, the pulse is read in half-time instead of slowing the show. Layout is computed in natural time, so geometry is identical for every duration.
5. **Aggregation follows the clock.** How many nodes can land inside the target and still get a legible beat is what decides how much of the history is collapsed into ribbons. A two-thousand-commit repository therefore plays in the same forty-five seconds as a forty-commit one, told through ribbons instead of a five-minute queue of identical dots.

## Event grammar (`src/choreography/events.ts`)

`REPO_BIRTH`, `MULTI_ROOT_REVEAL`, `COMMIT_STEP`, `COMMIT_CLUSTER`, `QUIET_GAP`, `DIVERGENCE`, `THREAD_ACTIVATE`, `PARALLEL_PHRASE`, `CONTRIBUTOR_ENTER`, `CONTRIBUTOR_HANDOFF`, `MERGE_APPROACH`, `MERGE_IMPACT`, `MAJOR_MERGE`, `OCTOPUS_MERGE`, `MERGE_STORM`, `THREAD_DORMANT`, `UNMERGED_TIP`, `TAG_LANDMARK`, `ERA_TRANSITION`, `AGGREGATE_SPAN`, `UNKNOWN_SPAN`, `REPO_PRESENT`.

Each carries `performanceStart` (pre-roll), `performanceImpact`, `performanceEnd` (release), subjects, salience, effect budget, provenance and a factual caption. Merge salience combines unique side-history size, contributors, age of the diverged thread, parent count, tags and (when fetched) change size, normalized repository-relatively.

**Effect budget:** per second of performance, the two most salient heavy events keep full amplitude, the next two 60%, the rest 30%. Three or more merges within ~3 beats become one `MERGE_STORM` phrase.

## Movement (`src/choreography/compile.ts` → edges)

Every parent relation becomes exactly one edge with a **travel window**. Thread continuations are carried by the thread's persistent **performer** (departs after a short dwell, arrives on the beat); extra parents by transient **pulses**; a thread's first edge is the **divergence** peel from its exact base; its last edge the **merge** swoop into the destination. Aggregates are ribbons the performer crosses with internal ticks. Unknown parents get dashed veils.

The renderer draws, for time *t*: settled paths (spine bright, merged threads receding to a floor), active paths revealed up to the body's position with contributor colour flowing behind it, comets with contributor glyphs, handoff cross-fades, node pops on arrival, contributor halos, merge rings + flash (budgeted, disabled by *no flashes*), a ripple displacement field through nearby settled nodes, split flares, tag halos, live-tip beacons, screen-space labels with collision avoidance, and a half-resolution bloom pass. Everything is a pure function of *t*, which is what makes pause exact and seeking side-effect free.

## Camera (`src/choreography/camera.ts`)

Planned at compile time at 20 Hz from geometry and future events, then smoothed with a critically damped spring on centre and log-extents. Attention points: every body now and 1.7 s ahead, the newest spine node, junctions of divergences in their window, merge nodes and parents up to 2.6 s before impact. Rather than chasing the newest body, the camera rides a **dolly track**: world x as a function of performance time, which is very nearly linear and gives the show its timelapse glide. The bounding box only nudges that track and guarantees nothing important is cropped, and the vertical is biased toward the straight spine axis so the main line stays level. Zoom breathes on a slower spring than the centre so the frame does not pump.

States: `intimate`, `split`, `ensemble`, `overview`, `convergence`, `impact` (push-in scaled by salience × budget, tiny roll), `release`, `tableau`. An impact is never demoted by a neighbouring merge's approach. Live junctions are never cropped; reduced motion removes push/roll and slows the spring.

The viewer can override it: zooming or dragging enters free look, and pressing `C` then hands the framing back to the director **while keeping the zoom the viewer chose**.

## Sound (`src/audio/engine.ts`)

Sound is on by default, is never required to understand anything, and **nothing drones**: every voice is a struck or bowed gesture with an envelope that ends.

A small synthetic orchestra plays the same event plan as the visuals. Strings carry the harmony, entering on each chord change with a bowed swell and receding before the next. Basses take one deep root per chord. Woodwind carries the melody on the main line; harp answers above it on side threads. Brass and timpani mark merges, weighted by how many commits converged, and a cymbal shimmer marks tags and the largest merges. A short convolution hall ties the sections together.

A four-chord progression in A minor (i, VI, iv, VII) turns over every 7.5 seconds. Both melodic voices *walk* that chord by step, holding or moving one place at a time, rather than indexing a pitch from a thread's lane — that difference is what makes the line read as a tune instead of as leaps wherever the graph happens to branch. Two notes closer than an eighth of a second never sound together: the later one is dropped, because below that gap the ear stops separating them. Dynamics follow the activity curve, and a compressor guarantees headroom.

## Reduced motion

Reduced motion follows the operating system preference and has no control of its own. Same plan, calmer expression: steady reveals instead of comets, markers at arrival nodes, merge rings that fade in place instead of expanding across the stage, no pops, ripples, breathing, sweep light, push-in or roll, a slower camera and a lower tempo cap. Event meaning, the calendar, the ledger and the timeline are unchanged.
