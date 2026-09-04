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

## Pace

Two numbers govern how long a performance runs and therefore how fast its arrivals land.

`perNode` (0.26 s, or 0.4 s under reduced motion) is the stage time one visible commit needs to read as its own beat. It sizes the aggregation budget — the history is collapsed into ribbons until what remains can actually be watched — *and* it sizes the clock. Those two used to disagree: aggregation collapsed the history for 0.26 s a commit and the clock then played the result at 0.12 s, so every large repository ran at more than twice the pace it had been collapsed for. An explicitly chosen length is still honoured exactly; only the automatic length stretches, and only as far as legibility asks.

`rangeK` narrows the dynamic range as the number of arrivals grows. Speeding up and slowing down is only expressive while there is room to do it in; past a few hundred arrivals every one is already close to the shortest interval the eye can resolve, so the same swings that make a small history ride like a roller coaster just push the busy spans under the threshold — and the busiest span of a repository's life, usually its first month, ends up the one you cannot see at all. It depends only on the item count, never on the target duration, so geometry stays identical at every length ([ADR 0003](adr/0003-quantize-in-natural-time.md)).

`tests/unit/pacing.test.ts` asserts, for the demo and every fixture, that the typical arrival holds the stage for at least 0.25 s, that even the fastest tenth stays above 0.12 s, that arrivals stay under 4.5 per second, and that nothing runs longer than four minutes.

## Sound (`src/audio/score.ts`, `src/audio/engine.ts`)

Sound is on by default, is never required to understand anything, and **nothing drones**: every voice is a struck or bowed gesture with an envelope that ends.

The musical *decisions* live in `score.ts`, which is pure and DOM-free; `engine.ts` only realises them through the Web Audio API. That split exists so the rules below can be asserted against every history in the corpus without a browser — the failure they guard against is a constant quietly tuned until one example sounds right.

### The piece

Every repository gets its own, and it is chosen to *fit* rather than at random. `characterOf` measures three things from the compiled plan — `drive` (how much lands per second), `turbulence` (how bursty, parallel and merge-heavy it is) and `weight` (how much each merge actually absorbs) — and `derivePiece` turns those into a piece. Character picks the mode band (settled histories draw from ionian, dorian and mixolydian; restless ones from aeolian, phrygian and harmonic minor) and the harmonic rhythm; the plan hash picks which piece within that band, so a project always sounds like itself.

**Harmonic rhythm is counted in bars, not seconds.** `buildChordTimes` walks the same `tempoMap` the choreography uses, so when the history speeds up the bars shorten and the harmony turns over faster without being told to. Fixing it in seconds was what made a busy stretch sound as ponderous as a dormant one.

**The writing follows the activity curve too.** `articulationAt` blends the baseline with the current intensity: the deep doubled left hand lifts when things get busy, the ring shortens, the rolling figure fills in. A repository is not one mood for its whole life, and the piece moves between them rather than picking one and holding it.

**The piece is in movements.** A four-chord loop held for four minutes is monotonous however well it is voiced, so `buildSections` divides the performance and modulates between the parts. The seams are the choreography's eras — the repository's own chapters — and the *direction* says what happened: an era busier than the last lifts the key, a quieter one drops it. A history with no chapters at all, such as a pull-request treadmill, still gets movements, because no stretch may stay in one key for more than 52 seconds. Each section carries its own transposed chords **and its own scale**, so the melody modulates with the harmony instead of singing in the key the piece has just left.

**The melody has a motif.** Three intervals, fixed per piece, restated at the head of every four-bar phrase from wherever the harmony has moved to, with free stepwise motion in between. A line that never repeats itself is not a tune however well behaved each note is; recurrence is what a listener actually remembers.

**The piano plays that piece continuously.** It is not triggered by the data: it is sequenced on the performance's own beat grid (`seekGrid` places the cursor after a seek, `playBar` renders one beat), so it accelerates through a busy year and eases into a merge with the picture, and survives seeking without drifting. Past a certain speed it drops to half-time, the way a pianist feels a fast bar in two rather than four.

**The melody walks the scale, not the chord.** `piece.scale` exists separately from `piece.chords` for exactly this reason: adjacent entries in a voiced chord are a third apart, so a melody that moved one place at a time through the chord array leapt on every single note and never sounded like a line. `melodyStep` moves by scale degree, keeps the sounding interval inside a major third between resolutions, stays within about an octave, and resolves onto a nearby chord tone on the downbeat. `tests/unit/score.test.ts` asserts all of that over every history in the corpus.

Around it the orchestra plays the event plan, and deliberately sparsely. Strings carry the harmony, entering on each chord change with a bowed swell. Basses take one deep root per chord. Harp puts a touch of light on each commit and rolls a short arpeggio for an aggregated run. Woodwind answers a divergence with a rising pair. Timpani marks merges; **brass is reserved for merges that genuinely absorbed something**, and a cymbal only for tags and the closing tutti, because unpitched noise carries no musical information and is the first thing to cut when the ask is that it sound composed. Measured in a browser, non-piano notes run at 0.5-1.1 per second and the piano stays inside 3-6 pitch classes of a single mode.

### Adjusting to the repository

None of the spacing rules are constants, because a quiet history and one built on pull requests produce wildly different numbers of events per second.

- **`accentGapFor`** — how much air one accent needs, scaled by the plan's own accent rate between 0.13 s (below which the ear stops separating notes) and 0.34 s.
- **`selectFeatured`** — merges and branch points *compete* for the downbeat rather than each taking one. Walking them in time order, one is featured only if enough time has passed since the last, and an important merge earns the right to interrupt sooner than a routine one, so what survives is the shape of the history rather than an arbitrary sample. Nothing is silenced: an unfeatured merge still sounds as a soft chord tone under the accent gate.
- **`mergePressureFor`** — the more a repository merges, the less each merge shouts.
- **`rangeK`** in `clock.ts` — the pacing's dynamic range narrows as the number of arrivals grows, because speeding up is only expressive while there is room to do it in.

The problem these solve was real and specific: `public-apis/public-apis` merges a pull request roughly every other commit, which at speed is several downbeats a second and reads as an unbroken barrage. None of the rules take any input about a particular project.

### Spacing

The piece has right of way. `takeVoice` rejects an accent that would land within the current gap of the previous accent *or* of any beat the piano has already scheduled, which the engine tracks in `pianoAt` and prunes behind the playhead. A single monotone cursor is not enough: accepting an accent must not pull the cursor back behind notes the piano has already committed to.

Gestures that occupy time reserve it. An aggregated run rolls **forward** from its landing, never backward — scheduling behind `ctx.currentTime` clamps every note to *now* and turns a roll into one smeared flam — and the roll is only as long as the span the run actually owns. A featured merge is snapped onto the nearest piano beat within 70 ms, so it lands as the downbeat of the bar rather than as a flam beside one.

Measured by instrumenting oscillator starts in a real browser, fusing onsets within 30 ms the way the ear does:

| Fixture | Attacks/s | Median gap |
|---|---|---|
| 13 contributor handoff | 0.8 | 1334 ms |
| 01 linear | 1.0 | 1320 ms |
| 07 octopus merge | 1.3 | 670 ms |
| 05 long-running side thread | 1.5 | 823 ms |
| 12 merge storm | 1.7 | 513 ms |
| Built-in demo | 2.3 | 343 ms |
| 19 million-node synthetic | 2.5 | 374 ms |
| 21 pull-request treadmill | 3.0 | 323 ms |
| 11 dense linear burst | 3.5 | 292 ms |

Dynamics follow the activity curve, and a compressor guarantees headroom.

## Reduced motion

Reduced motion follows the operating system preference and has no control of its own. Same plan, calmer expression: steady reveals instead of comets, markers at arrival nodes, merge rings that fade in place instead of expanding across the stage, no pops, ripples, breathing, sweep light, push-in or roll, a slower camera and a lower tempo cap. Event meaning, the calendar, the ledger and the timeline are unchanged.
