# Choreography

The compiler turns graph facts into a small, explainable vocabulary. Every movement traces back to an event with a salience score; salience changes amplitude and staging, never meaning.

## Clocks (`src/choreography/clock.ts`)

1. **Natural steps.** Each visible commit gets an interval that shrinks with local phrase intensity — about 1.16 s where nothing much is happening, down towards 0.44 s at peak, though only a small history gets that full swing (see `rangeK` below). Merges grow instead of shrinking, because they need approach room, and grow further with salience and with how much they absorbed: the pause before a merge is part of it. A quiet span longer than three weeks is *replaced* by a whoosh of at most 0.9 s, whether it covers a month or a decade — the calendar spinning in the date readout does the talking, so dormancy never costs the viewer time. The beat before a heavy merge hangs and the four beats after it race away, which is the climb-and-drop shape that makes a sequence feel like a ride. That release is floored at `MIN_BUSY_STEP` (0.4 s of natural time), because it used to multiply an already-short busy step down to a third of itself, and the densest month in a repository — its first, usually — went past fastest of all.
2. **Tempo regions.** Per 4-second phrase of natural time, the average intensity picks a region (72 / 100 / 132 / 164 BPM). The region may only climb one step at a time and only falls when the average drops a clear margin below the boundary, so the beat does not twitch across a threshold.
3. **Quantization.** Impacts snap *upward* to the beat grid — quarter, eighth or sixteenth subdivisions, chosen by intensity — subject to: global order never changes; consecutive commits on one thread are at least half a beat apart; a child lands at least half a beat after each parent; merges reserve 1.25–2.5 beats from every parent, scaled by salience; a diverging first commit reserves 0.9 beats from its base; and no two bodies ever land on the exact same instant, because a dance has beats.
4. **Scaling.** The natural timeline is then scaled to fit the target duration, but never stretched by more than 1.6× and never so far that a single ordinary step exceeds 2.8 s: a small repository ends early rather than crawling. The duration is authoritative in the other direction too — there is no minimum step that could inflate it, and where many commits land together the result is an honest flurry, because that is what a busy day looked like. When a dense history implies an absurd nominal tempo, the pulse is folded in half (or doubled) into a 56–184 BPM band rather than the show being slowed: the impacts do not move, only the pulse we count them in. Layout is computed in natural time, so geometry is identical for every duration.
5. **Aggregation follows the clock.** How many nodes can land inside the target and still get a legible beat is what decides how much of the history collapses into ribbons: the budget is the target length minus the four-second frame, divided by `SECONDS_PER_NODE`, capped by the preset's `aggregateAbove`. A two-thousand-commit repository therefore plays in about the same time as a much smaller one, told through counted ribbons instead of a queue of identical dots. Two shapes collapse: plain linear runs, and runs of **pull-request bubbles** — a branch that left the spine, carried at most `SIDE_MAX` (three) plain commits and was merged straight back with nothing else hanging off it. Three is not a round number: measured over mdBook's whole history, 825 of its 881 branch-and-merge-back merges carry three commits or fewer, and past that a branch plausibly has a story the viewer should see rather than have summarized. The bubble case is what makes a merge-heavy project watchable at all, because aggregation refuses to touch junctions and a repository that merges a branch for every change is almost nothing but junctions.

## Event grammar (`src/choreography/events.ts`)

`REPO_BIRTH`, `MULTI_ROOT_REVEAL`, `COMMIT_STEP`, `COMMIT_CLUSTER`, `QUIET_GAP`, `DIVERGENCE`, `THREAD_ACTIVATE`, `PARALLEL_PHRASE`, `CONTRIBUTOR_ENTER`, `CONTRIBUTOR_HANDOFF`, `MERGE_APPROACH`, `MERGE_IMPACT`, `MAJOR_MERGE`, `OCTOPUS_MERGE`, `MERGE_STORM`, `THREAD_DORMANT`, `UNMERGED_TIP`, `TAG_LANDMARK`, `ERA_TRANSITION`, `AGGREGATE_SPAN`, `UNKNOWN_SPAN`, `REPO_PRESENT`.

Each carries `performanceStart` (pre-roll), `performanceImpact`, `performanceEnd` (release), subjects, salience, effect budget, provenance and a factual caption. Merge salience combines unique side-history size, contributors, age of the diverged thread, parent count, tags and (when fetched) change size, normalized repository-relatively.

That side-history walk is bounded in aggregate rather than only per merge, and the bound is derived from how many merges a repository has. What it costs is precision on the largest merges in the largest histories, and it costs nothing anyone can see: the volume is consumed as a logarithm and lands on a stroke a few pixels wide, so "absorbed 1,900" and "absorbed 2,000" were never distinguishable on screen. What it bought was Rust compiling at all — see [Architecture](architecture.md#three-quadratics-and-the-shape-of-the-lesson).

**Effect budget:** per second of performance, the two most salient heavy events keep full amplitude, the next two 60%, the rest 30%. Three or more merges inside about three beats become one `MERGE_STORM` phrase.

## Movement (`src/choreography/compile.ts` → edges)

Every parent relation becomes exactly one edge with a **travel window**. Thread continuations are carried by the thread's persistent **performer** (departs after a short dwell, arrives on the beat); extra parents by transient **pulses**; a thread's first edge is the **divergence** peel from its exact base; its last edge the **merge** swoop into the destination. Aggregates are ribbons the performer crosses with internal ticks. Unknown parents get dashed veils.

The renderer draws, for time *t*: settled paths (spine bright, merged threads receding to a floor), active paths revealed up to the body's position with contributor colour flowing behind it, comets with contributor glyphs, handoff cross-fades, node pops on arrival, contributor halos, merge rings + flash (budgeted, disabled by *no flashes*), a ripple displacement field through nearby settled nodes, split flares, tag halos, live-tip beacons, screen-space labels with collision avoidance, and a half-resolution bloom pass. Everything is a pure function of *t*, which is what makes pause exact and seeking side-effect free.

## Camera (`src/choreography/camera.ts`)

Planned at compile time on a fixed 0.05 s grid — twenty keyframes a second — from geometry and future events, then smoothed with a critically damped spring on centre and log-extents. Attention points: every body now and shortly ahead, the newest spine node, junctions of divergences in their window, merge nodes and parents up to 2.6 s before impact. Rather than chasing the newest body, the camera rides a **dolly track**: world x as a function of performance time, which is very nearly linear and gives the show its timelapse glide. The bounding box only nudges that track and guarantees nothing important is cropped, and the vertical is biased toward the straight spine axis so the main line stays level. Zoom breathes on a slower spring than the centre so the frame does not pump.

States: `intimate`, `split`, `ensemble`, `overview`, `convergence`, `impact` (push-in scaled by salience × budget, tiny roll), `release`, `tableau`. An impact is never demoted by a neighbouring merge's approach. Live junctions are never cropped; reduced motion removes push/roll and slows the spring.

The viewer can override it: zooming or dragging enters free look, and pressing `C` then hands the framing back to the director **while keeping the zoom the viewer chose**.

That fixed keyframe grid is cheap at every length anyone watches and is the reason there is an upper bound on length at all, which is the next section.

## Pace (`src/choreography/pace.ts`)

Three numbers govern how long a performance runs, and therefore how fast its arrivals land.

**`SECONDS_PER_NODE` (0.13 s, or 0.2 s under reduced motion)** is the stage time one visible commit gets. It sizes the aggregation budget — the history is collapsed into ribbons until what remains can actually be watched — *and* it sizes the clock. Those two used to disagree, and every large repository ran at more than twice the pace it had been collapsed for.

It was 0.26 s, chosen as the point below which an arrival stops reading as its own beat, and watching it, the first thing anyone reached for was the speed control. A timelapse is not read commit by commit; the eye follows the shape. So the natural pace is what 2× used to be and 1× means it: shows are half as long and the length selector opens where it should. Everything downstream halved with it, including the thresholds in `tests/unit/pacing.test.ts` — the typical arrival must still hold the stage for at least 0.125 s, the fastest tenth must clear 0.06 s, and arrivals must stay under nine a second.

**`rangeK` in `clock.ts`** narrows the dynamic range as the number of arrivals grows. Speeding up and slowing down is only expressive while there is room to do it in; past a few hundred arrivals every one is already close to the shortest interval the eye can resolve, so the same swings that make a small history ride like a roller coaster just push the busy spans under the threshold — and the busiest span of a repository's life, usually its first month, ends up the one you cannot see at all. It depends only on the item count, never on the target duration, so geometry stays identical at every length ([ADR 0003](adr/0003-natural-time-quantization.md)).

**`MAX_PERFORMANCE_SECONDS` (thirty-five minutes)** is where the automatic length stops. It is the newest of the three and the one with the most history behind it, so it gets its own section.

### Length: a question at three minutes, a ceiling at thirty-five

For most of this project's life there was no upper bound on duration, and the argument for that was sound: any bound can only be honoured by breaking the per-commit budget, and a show nobody can follow is not a shorter show, it is a broken one. That was not hypothetical. Before bubbles collapsed, a pull-request repository kept nearly all of its commits on stage — mdBook kept 2,584 of 3,296 — and under the old four-minute cap it played at 0.10 s a commit, a blur. The corpus never caught it because no fixture was dense enough to reach the cap.

`LONG_PERFORMANCE_SECONDS` (three minutes) is the answer to that, and it is a *question* rather than a limit: nothing is truncated to it. `predictVisible` estimates what will survive aggregation from the commit count and a merge-ratio sample of the most recent hundred commits — the survivors are bounded by the junctions, which only collapse where the branch was a bubble, and by the budget, whichever is larger — and `willOutrunTheCeiling` turns that into the question the scope chooser asks *before anything is fetched*, with the length on the button. It is deliberately pessimistic on the dense side: offering a choice that turns out to be unnecessary is a far smaller failure than not offering one that was. The sample is recent, so it measures a repository's *current* habits — a project that adopted pull requests late reads denser than its whole history really is, a bias that points the safe way.

Since bubbles collapse, that junction bound over-estimates a treadmill repository, so the button gives the length as an upper bound. Telling a bubble from a branch with real history behind it needs the side-branch lengths, which the two probe requests do not carry, and re-fitting the estimate on a guess about what fraction of a project's merges are bubble-shaped is exactly the unmeasured tuning this file exists to avoid.

**Then the catalog grew to include Rust, and the "no cap" position became untenable — not on taste, on arithmetic.** Rust's whole history leaves 248,298 nodes after aggregation, because it lands everything through a merge queue and a queue produces junctions, not bubbles. At a readable moment each that is 32,278 seconds: a nine-hour performance. Nothing about that is a show, and it poisons everything downstream — the camera is keyframed every 0.05 s, so a nine-hour plan is 645,561 keyframes to plan, smooth, serialize and carry in memory, and planning Rust's camera alone took twenty-eight minutes.

So there is a ceiling now, at thirty-five minutes: the point where a history stops being something you watch and starts being something you leave running, past which stretching further buys nothing. Two things are worth being clear about, because a ceiling is exactly the mechanism that failed before.

- **It applies only to the automatic length.** An explicitly chosen duration is honoured exactly, at whatever pace it implies, because it was chosen.
- **Past it, arrivals do compress below the budget, and that is the admission being made.** Rust at the ceiling is 248,298 nodes in 2,100 seconds. There is no version of that history you read commit by commit. The honest thing is to say the history is bigger than an afternoon and let it compress, rather than to pretend a nine-hour file is a viewing option. Below the ceiling nothing changes: a history that needs eleven minutes still gets eleven.

Nothing in the fixture corpus comes near thirty-five minutes — the longest fixture is four and a quarter — and an untested cap is exactly what the last one was. So the corpus guards the *question* rather than the ceiling: `tests/unit/pacing.test.ts` requires that any show running past `LONG_PERFORMANCE_SECONDS` was predicted dense from the probe, so nobody arrives at a long one unasked, and it requires that at least one fixture actually runs long or the suite proves nothing. `23-back-merge-decade` is that fixture — two long-lived lines integrating into each other every few days, so every side history contains a merge of its own, none of it collapses, and all 1,921 commits stay on stage for 254 seconds. Without a history that dense the suite would only ever test the comfortable path, which is how the old cap degraded real repositories unnoticed.

What bubbles bought is the difference between the last two fixtures, compiled at the automatic length: `22-merge-dense-decade` collapses 2,401 commits to 403 nodes and 97 seconds, while `23-back-merge-decade` collapses 1,921 to 1,921. Both are 50% merges. The only difference is that one repository's side histories are routine pull requests and the other's contain merges of their own, and a ribbon may hide the first and must not hide the second. (`21-pull-request-treadmill` now fits whole — all 561 commits, 82 seconds — because halving `SECONDS_PER_NODE` doubled the budget past what that fixture needs, so nothing has to collapse. The bubble path is exercised deliberately instead, in `compile.test.ts`, against treadmills built with the budget forced down.)

On real histories, measured when bubbles landed and at the pace of the time, mdBook fell from 2,581 visible commits and 11.3 minutes to 1,207 and 5.3, and public-apis' 2021 from 1,587 and 6.9 to 1,171 and 5.1. Neither reached its budget, because a third of their pull requests left the spine well before the commit they were merged onto — public-apis' median is sixteen commits back and its worst is 888 — and a ribbon can only hide a branch point if it also hides the branch that left it. Those are the figures `predictVisible` was fitted against. `tests/unit/pacing.test.ts` records them alongside the same histories re-measured at the current, doubled budget — mdBook 1,210 visible and public-apis 1,171 — and both of those come in under the three-minute question, which is why the shorter span they are still offered is a precaution rather than a necessity.

## Sound (`src/audio/score.ts`, `src/audio/engine.ts`, `scripts/build-music.mjs`)

The soundtrack is real recorded music and **there are no sound effects**. No voice is triggered by an event; the repository chooses which track plays and after that the music is simply music.

This replaced a generated score: a key, mode and four-bar turnaround derived from the plan hash, a melody that walked the scale, and an orchestra of harp, woodwind, strings, basses, timpani, brass and cymbal answering individual events. Every part of it was derived from something true about the history, all of it was measured and spaced against the corpus, and it was still hard to listen to — which is the only test a soundtrack has to pass. Roughly nine hundred lines of synthesis were deleted.

### The tracks, and the check that has to exist

There is no public-domain rock — the genre is entirely inside copyright, composition and recording both — but Kevin MacLeod's catalog is released under Creative Commons Attribution 4.0 and sixty-one of its pieces are filed under Rock. Three ship, chosen for range, all of them guitar, bass and drums:

| Register | Track | | For |
|---|---|---:|---|
| `frantic` | *Ready Aim Fire* | 172 bpm | a history that never stops moving |
| `driving` | *Riptide* | 128 bpm | steady, sustained work |
| `calm` | *Cold Funk* | 112 bpm | a long, quiet history |

The first attempt shipped by title alone and got it badly wrong. *Volatile Reaction* is filed under **Soundtrack** and described by its own composer as "blasting brass, pounding percussion… suitable for fights, evil"; the other two were Electronica and Funk. It sounded like a war film because it was one.

So `scripts/build-music.mjs` reads incompetech's own `genre.json`, checks each pick against it, and **fails the build** if a track is not actually filed under Rock. A guitar-bass-drums lineup is not something to take on trust from a title, and the failure mode here is silent: nothing crashes when the music is wrong, it just plays, and the mismatch is only audible to someone who happens to know what the picture is supposed to feel like. The same step enforces a length floor, because a two-minute loop under a ten-minute history is its own kind of unpleasant.

The script fetches the audio into `public/music/` at build time rather than committing it — twenty megabytes does not belong in a git history — and writes an index carrying each track's genre, bpm, source URL and licence. The step is best effort: a build without music is quiet, not broken, and `loadCatalogue` returning an empty list simply means nothing plays. The credit is rendered in the help panel by `MusicCredit`, next to the explanation of what the sound is, which is the condition the licence attaches to using it at all.

### Choosing

`characterOf` measures the plan: `drive` is how much lands per second, `turbulence` is how bursty, parallel and merge-heavy it is, `weight` is how much each merge absorbs. `registerFor` adds drive and turbulence, so either can reach the top register alone — a project can land a great deal steadily, or very little in violent bursts, and both deserve to be pushed. `tests/unit/score.test.ts` asserts that over every history in the corpus, including that the corpus genuinely spans the range rather than clustering, which is what stops a threshold being tuned until one example fits: the pull-request treadmill has to land on `frantic` and a sparse, long-running history on `calm`.

### When it plays

During a performance and at no other time. Not on the landing page, not while paused, not after the last commit has landed.

That is a rule with a file behind it (`syncAudioToPlayback` in `src/app/controller.ts`) rather than a property of the audio. A synthesised score needed nothing of the sort — there was nothing to hear between events — but a recording keeps playing until something stops it, so pausing left the soundtrack running over a frozen picture and going back to the landing page left it playing over the form. Neither is a performance, so neither gets music. The condition is the phase rather than the clock, because during a fetch the clock can be running against a performance that has nothing on screen yet, and music over a loading screen is music with nothing to accompany.

### What a recording cannot do

It cannot follow the timeline. The old score was laid on the performance's own beat grid and accelerated with the picture; a recording has its own fixed tempo, and time-stretching one in a browser sounds worse than the problem it solves. So the music does not respond to the speed control, does not mark merges, and does not resynchronise on a seek. It is a soundtrack over the performance rather than a score of it.

What it does do is hold while the viewer scrubs — dragging the scrubber used to pull the audio through at whatever speed the pointer moved — and pick up where it left off.

## Reduced motion

Reduced motion follows the operating system preference and has no control of its own. Same plan, calmer expression: steady reveals instead of comets, markers at arrival nodes, merge rings that fade in place instead of expanding across the stage, no pops, ripples, breathing, sweep light, push-in or roll, a slower camera and a lower tempo cap. It also gets a slower pace — `SECONDS_PER_NODE_REDUCED` is 0.2 s against 0.13 — which means a different aggregation budget, a different plan, and therefore no shipped `.gtperf.gz` will be used for it. Event meaning, the calendar, the ledger and the timeline are unchanged.
