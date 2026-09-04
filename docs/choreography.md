# Choreography

The compiler turns graph facts into a small, explainable vocabulary. Every movement traces back to an event with a salience score; salience changes amplitude and staging, never meaning.

## Clocks (`src/choreography/clock.ts`)

1. **Natural steps.** Each visible commit gets an interval that shrinks with local phrase intensity (calm ≈ 0.9 s, peak ≈ 0.2 s), grows for merges (approach room) and aggregates (log of member count), and receives a bounded calendar-sweep bonus after gaps longer than three weeks.
2. **Tempo regions.** Per 4-second phrase, the average intensity picks a region (72 / 100 / 132 / 164 BPM) with hysteresis so the beat does not twitch.
3. **Quantization.** Impacts snap *upward* to the beat grid (quarter, eighth or sixteenth subdivisions by intensity) subject to: global order never changes; consecutive commits on one thread are at least half a beat apart; a child lands at least half a beat after each parent; merges reserve 1.25–2.5 beats from every parent; a diverging first commit reserves 0.9 beats from its base.
4. **Scaling.** The natural timeline is scaled to the target duration, bounded so tiny histories stay lively (scale ≤ 1.7, non-gap steps ≤ 3.4 s) and huge ones stay legible (steps ≥ 70 ms, BPM ≤ 200). Layout is computed in natural time, so geometry is identical for every duration.

## Event grammar (`src/choreography/events.ts`)

`REPO_BIRTH`, `MULTI_ROOT_REVEAL`, `COMMIT_STEP`, `COMMIT_CLUSTER`, `QUIET_GAP`, `DIVERGENCE`, `THREAD_ACTIVATE`, `PARALLEL_PHRASE`, `CONTRIBUTOR_ENTER`, `CONTRIBUTOR_HANDOFF`, `MERGE_APPROACH`, `MERGE_IMPACT`, `MAJOR_MERGE`, `OCTOPUS_MERGE`, `MERGE_STORM`, `THREAD_DORMANT`, `UNMERGED_TIP`, `TAG_LANDMARK`, `ERA_TRANSITION`, `AGGREGATE_SPAN`, `UNKNOWN_SPAN`, `REPO_PRESENT`.

Each carries `performanceStart` (pre-roll), `performanceImpact`, `performanceEnd` (release), subjects, salience, effect budget, provenance and a factual caption. Merge salience combines unique side-history size, contributors, age of the diverged thread, parent count, tags and (when fetched) change size, normalized repository-relatively.

**Effect budget:** per second of performance, the two most salient heavy events keep full amplitude, the next two 60%, the rest 30%. Three or more merges within ~3 beats become one `MERGE_STORM` phrase.

## Movement (`src/choreography/compile.ts` → edges)

Every parent relation becomes exactly one edge with a **travel window**. Thread continuations are carried by the thread's persistent **performer** (departs after a short dwell, arrives on the beat); extra parents by transient **pulses**; a thread's first edge is the **divergence** peel from its exact base; its last edge the **merge** swoop into the destination. Aggregates are ribbons the performer crosses with internal ticks. Unknown parents get dashed veils.

The renderer draws, for time *t*: settled paths (spine bright, merged threads receding to a floor), active paths revealed up to the body's position with contributor colour flowing behind it, comets with contributor glyphs, handoff cross-fades, node pops on arrival, contributor halos, merge rings + flash (budgeted, disabled by *no flashes*), a ripple displacement field through nearby settled nodes, split flares, tag halos, live-tip beacons, screen-space labels with collision avoidance, and a half-resolution bloom pass. Everything is a pure function of *t*, which is what makes pause exact and seeking side-effect free.

## Camera (`src/choreography/camera.ts`)

Planned at compile time at 20 Hz from geometry and future events, then smoothed with a critically damped spring on centre and log-extents. Attention points: every body now and 1.7 s ahead, the newest spine node, junctions of divergences in their window, merge nodes and parents up to 2.6 s before impact. States: `intimate`, `split`, `ensemble`, `overview`, `convergence`, `impact` (push-in scaled by salience × budget, tiny roll), `release`, `tableau`. Live junctions are never cropped; reduced motion removes push/roll and slows the spring.

## Sound (`src/audio/engine.ts`)

Original procedural voices scheduled from the same events with a 160 ms look-ahead: pentatonic plucks for commits (pitch by lane, timbre by contributor), pickup + swish for divergence, a rising filtered swell from `MERGE_APPROACH.start`, thump + chord at impact, bells for tags and birth, a pad for eras and the present. An ambient bed's low-pass follows intensity. A compressor/limiter guarantees headroom; a full mute and separate effect/ambience levels exist. Audio starts only after a user gesture and nothing is conveyed by sound alone.

## Reduced motion

Same plan, calmer expression: steady reveals instead of comets, markers at arrival nodes, no pops/ripples/breathing/dust drift, no push-in or roll, slower camera, tempo capped at ~108 BPM natural, and larger minimum steps. Event meaning, captions, timeline and the events stream are unchanged.
