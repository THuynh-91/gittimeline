# Choreography

The compiler turns graph facts into a small, explainable vocabulary. Every movement traces back to an event with a salience score; salience changes amplitude and staging, never meaning.

## Clocks (`src/choreography/clock.ts`)

1. **Natural steps.** Each visible commit gets an interval that shrinks steeply with local phrase intensity (calm ≈ 1.0 s, peak ≈ 0.12 s) and grows for merges, which need approach room. A quiet span longer than three weeks is *replaced* by a single short whoosh of under a second, whether it covers a month or a decade: the calendar spinning in the date readout does the talking, so dormancy never costs the viewer time. The three beats after a big merge accelerate away from it, giving the sequence its climb-and-drop shape.
2. **Tempo regions.** Per 4-second phrase, the average intensity picks a region (72 / 100 / 132 / 164 BPM) with hysteresis so the beat does not twitch.
3. **Quantization.** Impacts snap *upward* to the beat grid (quarter, eighth or sixteenth subdivisions by intensity) subject to: global order never changes; consecutive commits on one thread are at least half a beat apart; a child lands at least half a beat after each parent; merges reserve 1.25–2.5 beats from every parent; a diverging first commit reserves 0.9 beats from its base.
4. **Scaling.** The natural timeline is scaled to fit the target duration, never stretched by more than a third, so a small repository ends early rather than crawling. The duration is authoritative: there is no minimum step that could inflate it, and where many commits land together the result is an honest flurry. When a dense history implies an absurd nominal tempo, the pulse is read in half-time instead of slowing the show. Layout is computed in natural time, so geometry is identical for every duration.
5. **Aggregation follows the clock.** How many nodes can land inside the target and still get a legible beat is what decides how much of the history is collapsed into ribbons. A two-thousand-commit repository therefore plays in the same forty-five seconds as a forty-commit one, told through ribbons instead of a five-minute queue of identical dots. Two shapes collapse: plain linear runs, and runs of **pull-request bubbles** — a branch that left the spine, carried at most `SIDE_MAX` plain commits and was merged straight back. The second is what makes a merge-heavy project watchable at all: aggregation refused to touch junctions, and a repository that merges a branch for every change is almost nothing but junctions.

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

## Pace (`src/choreography/pace.ts`)

Two numbers govern how long a performance runs and therefore how fast its arrivals land.

`SECONDS_PER_NODE` (0.26 s, or 0.4 s under reduced motion) is the stage time one visible commit needs to read as its own beat. It sizes the aggregation budget — the history is collapsed into ribbons until what remains can actually be watched — *and* it sizes the clock. Those two used to disagree: aggregation collapsed the history for 0.26 s a commit and the clock then played the result at 0.12 s, so every large repository ran at more than twice the pace it had been collapsed for. An explicitly chosen length is still honoured exactly; only the automatic length stretches.

`rangeK` in `clock.ts` narrows the dynamic range as the number of arrivals grows. Speeding up and slowing down is only expressive while there is room to do it in; past a few hundred arrivals every one is already close to the shortest interval the eye can resolve, so the same swings that make a small history ride like a roller coaster just push the busy spans under the threshold — and the busiest span of a repository's life, usually its first month, ends up the one you cannot see at all. It depends only on the item count, never on the target duration, so geometry stays identical at every length ([ADR 0003](adr/0003-quantize-in-natural-time.md)).

### Length, and why there is no cap

There is no upper bound on duration, because any bound can only be honoured by breaking the per-commit budget. That is not hypothetical. Before bubbles collapsed, a pull-request repository kept nearly all of its commits on stage — mdBook kept 2,584 of 3,296 — and at the legible pace that is eleven minutes. Under the old four-minute cap it played at 0.10 s a commit, a blur, and the corpus never caught it because no fixture was dense enough to reach the cap.

Bubbles take the treadmill shape out of the dense class: `21-pull-request-treadmill` fell from 150 s to 82 s and `22-merge-dense-decade` from 10.5 minutes to 97 s. Re-measured on the real histories, mdBook fell from 2,581 visible commits and 11.3 minutes to 1,207 and 5.3, and public-apis' 2021 from 1,587 and 6.9 minutes to 1,171 and 5.1.

Neither reaches its budget, because a third of their pull requests left the spine well before the commit they were merged onto — public-apis' median is sixteen commits back and its worst is 888 — and a ribbon can only hide a branch point if it also hides the branch that left it, so those stretches stay open. What remains dense is history no ribbon can honestly stand for. `23-back-merge-decade` integrates two long-lived lines into each other every few days, so each side history contains a merge of its own, none of it collapses, and all 1,921 commits stay on stage for 8.4 minutes. That fixture is what keeps this path tested.

`LONG_PERFORMANCE_SECONDS` (six minutes) is therefore a *question*, not a limit: nothing is truncated to it. `predictVisible` estimates what will survive aggregation from the commit count and a merge-ratio sample of the most recent hundred commits — the survivors are bounded by the junctions, which only collapse where the branch was a bubble, and by the budget, whichever is larger — and `willOutrunTheCeiling` turns that into the question the scope chooser asks *before anything is fetched*, with the length on the button. It is deliberately pessimistic on the dense side: offering a choice that turns out to be unnecessary is a far smaller failure than not offering one that was.

Since bubbles collapse, that junction bound is an over-estimate for a treadmill repository, and the question can turn out to have been unnecessary — so the button gives the length as an upper bound. Telling a bubble from a branch with real history behind it needs the side-branch lengths, which the two probe requests do not carry, and re-fitting the estimate on a guess about what fraction of a project's merges are bubble-shaped is exactly the unmeasured tuning this whole file exists to avoid.

The prediction is an estimate of a repository's *current* habits, since the sample is recent. A project that adopted pull requests late reads denser than its whole history really is — a bias that points the safe way.

## Sound (`src/audio/score.ts`, `src/audio/engine.ts`, `scripts/build-music.mjs`)

The soundtrack is real recorded music and **there are no sound effects**. No voice is triggered by an event; the repository chooses which track plays and after that the music is simply music.

This replaced a generated score: a key, mode and four-bar turnaround derived from the plan hash, a melody that walked the scale, and an orchestra of harp, woodwind, strings, basses, timpani, brass and cymbal answering individual events. Every part of it was derived from something true about the history, all of it was measured and spaced, and it was still hard to listen to — which is the only test a soundtrack has to pass. Roughly nine hundred lines of synthesis were deleted.

### The tracks

There is no public-domain rock, so nothing here is a famous recording. Kevin MacLeod's library is released under Creative Commons Attribution 4.0, which permits redistribution and requires credit; the credit is rendered in the help panel by `MusicCredit`, next to the explanation of what the sound is. Three tracks ship, tagged `frantic`, `driving` and `calm`.

`scripts/build-music.mjs` fetches them into `public/music/` at build time and writes an index carrying each track's source URL and licence. They are gitignored for the same reason the catalog is: twenty megabytes of audio does not belong in a git history, and a deploy that fetches its own assets stays reproducible. The step is best effort — a build without music is quiet, not broken, and `loadCatalogue` returning an empty list simply means nothing plays.

### Choosing

`characterOf` still measures the plan: `drive` is how much lands per second, `turbulence` is how bursty, parallel and merge-heavy it is, `weight` is how much each merge absorbs. `registerFor` adds drive and turbulence, so either can reach the top register alone — a project can land a great deal steadily, or very little in violent bursts, and both deserve to be pushed. `public-apis` at 44% merges lands on `frantic`; a long dormant history lands on `calm` however many commits it eventually accumulated.

### What a recording cannot do

It cannot follow the timeline. The old score was laid on the performance's own beat grid and accelerated with the picture; a recording has its own fixed tempo, and time-stretching one in a browser sounds worse than the problem it solves. So the music does not respond to the speed control, does not mark merges, and does not resynchronise on a seek. It is a soundtrack over the performance rather than a score of it.

What it does do is hold while the viewer scrubs — dragging the scrubber used to pull the audio through at whatever speed the pointer moved — and pick up where it left off.

## Reduced motion

Reduced motion follows the operating system preference and has no control of its own. Same plan, calmer expression: steady reveals instead of comets, markers at arrival nodes, merge rings that fade in place instead of expanding across the stage, no pops, ripples, breathing, sweep light, push-in or roll, a slower camera and a lower tempo cap. Event meaning, the calendar, the ledger and the timeline are unchanged.
