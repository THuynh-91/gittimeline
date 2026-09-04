# GitDance

## Comprehensive Project Scope, Product Vision, and Technical Specification

> **Working title:** GitDance  
> **One-line pitch:** Paste a public GitHub repository URL and watch its real Git history become a deterministic, rhythm-driven choreography of commits, parallel development, contributors, divergences, and merges.  
> **North-star principle:** Every repository gets a performance, but the repository itself writes the choreography.  
> **Document status:** Vision and implementation specification  
> **Last updated:** September 3, 2026

---

## 1. Executive summary

GitDance is an open-source, browser-based Git history choreography visualizer. A visitor opens a static site, pastes the URL of a public GitHub repository, and presses **Play**. The site retrieves public repository data directly from GitHub, reconstructs the Git commit directed acyclic graph (DAG), compiles that history into a rhythmic performance, and renders it entirely on the user's device.

There is no application backend, no database, no account system, and no server-side analysis. GitHub Pages hosts the static frontend. GitHub Actions builds, tests, and deploys it; Actions may also precompute curated demonstration datasets, but it is never part of the interactive request path.

The finished experience should feel closer to a music visualizer, a rhythm game, and an abstract dance performance than to a developer dashboard. The screen begins nearly empty. A first commit lands. A bright primary path forms. Side threads peel away at real divergence points. Independent work advances simultaneously. Contributor signatures flow through the paths. Merges curve toward each other, synchronize, and hit with visual and musical weight. Quiet years pass quickly; dense periods occupy more performance time while their motion and beat density intensify. A persistent activity timeline along the bottom foreshadows the repository's coming eras and allows precise seeking.

The animation may be expressive, but its structure must remain truthful:

- Every displayed commit represents a real commit or is explicitly marked as an aggregate.
- Every displayed parent relationship comes from the Git DAG.
- Divergences occur only where ancestry diverges.
- Merges reconnect only where parent relationships establish a merge.
- Simultaneous work is spatially simultaneous rather than serialized for convenience.
- The default branch's first-parent history remains a high-contrast visual anchor.
- Historic branch names are never invented when Git no longer contains them.
- Missing or unfetched history is shown as unknown or aggregated, never fabricated.

The artistic goal is **maximum visual chaos without losing the thread**. The viewer should feel the energy of a repository at its busiest and still be able to answer: What was happening in parallel? Where did this split? Where did it merge? Which path is the main line? Who was active? Why did the timeline spike?

---

## 2. Product thesis

Git records software development as a causal graph of immutable snapshots. Most Git visualizers present that graph as a static technical diagram. GitDance treats the same graph as a score:

```text
public GitHub URL
        ↓
client-side ingestion
        ↓
canonical commit DAG
        ↓
threads, eras, activity, and salience
        ↓
generated beat map and movement cues
        ↓
deterministic choreography
        ↓
interactive cinematic performance
```

The distinctive idea is not merely “animate Git history.” It is:

1. preserve the real topology of parallel work;
2. make topology generate the spatial composition;
3. make activity generate the rhythm and pacing;
4. make merges, releases, and structural changes generate dramatic accents;
5. use a camera director to turn a potentially unreadable graph into a legible performance;
6. make the result deterministic, seekable, explainable, and shareable.

### 2.1 The promise

For supported public GitHub repositories, the core interaction is deliberately simple:

```text
Open the page → paste a repository URL → press Play → watch its history
```

No installation. No sign-in. No hosted processing queue. No project setup. No data uploaded to GitDance infrastructure.

### 2.2 What “no restraints on scope” means

The product vision is not artificially limited to a small proof of concept. It includes the complete desired experience: accurate topology, cinematic choreography, large-repository strategies, exploration, sound, export, sharing, accessibility, and an extensible open-source engine.

The roadmap is phased only to make the vision buildable and testable. A phase is a delivery order, not a ceiling on the project.

---

## 3. Explicit design principles

These principles are requirements. If a feature conflicts with them, the feature changes.

### 3.1 Topology first, spectacle second

The DAG is the skeleton. Effects can exaggerate energy, curvature, timing, scale, and impact, but cannot change ancestry.

### 3.2 Chaos must be earned by the data

The renderer must not manufacture random branches or arbitrary explosions to make a quiet repository look dramatic. Visual intensity comes from measured development intensity: concurrency, commits, merges, contributors, change magnitude when available, and structural novelty.

### 3.3 Parallel work must be visible as parallel work

Independent active lineages advance together in historical time. The experience must not flatten all commits into a single-file queue.

### 3.4 Main is always findable

The current default branch's first-parent chain is the visual anchor. It uses the strongest continuity, contrast, and depth priority. Even at maximum density, a viewer can reacquire it quickly.

### 3.5 Structural color and human color have different jobs

**Path appearance communicates topology. Contributor color moves through the path.** A branch is not permanently recolored every time a different person contributes to it. Contributor identity appears as moving pulses, particles, halos, or textures, preserving structural readability.

### 3.6 Artistic timing, honest history

Historical timestamps remain inspectable and correctly ordered subject to Git's causal constraints. Performance time may compress inactivity, dwell on complexity, and quantize events to beats. The UI must distinguish the real historical clock from the artistic performance clock.

### 3.7 Never fabricate missing information

Git does not retain every historic branch name, and the static site may not be able to fetch every commit before a rate limit is reached. Unknown data stays unknown. The renderer uses honest labels such as “thread 07,” “aggregated span,” “history not loaded,” or no label at all.

### 3.8 Determinism is a feature

The same normalized dataset, engine version, preset, and seed produce the same layout, events, timing, camera cues, and contributor identities. A shared performance should be recognizable as the same performance.

### 3.9 Readability is a system, not a cleanup pass

Lane assignment, focus, opacity, level of detail, effect budgets, labeling, and camera framing are designed together. The system is allowed to become dense, but not visually careless.

### 3.10 Progressive delight

The viewer should receive a meaningful result as early as possible. Loading becomes a prelude: repository metadata appears, the earliest or latest known structure materializes, the activity profile resolves, and the play button activates as soon as a coherent performance can be compiled.

### 3.11 Local-first privacy

Analysis and rendering happen in the browser. Repository data is fetched from GitHub and retained only in local browser storage unless the user explicitly downloads or shares an artifact.

### 3.12 Accessibility is part of the visual language

Color is never the sole carrier of meaning. Motion, flashes, sound, and camera movement have independent controls. A textual event stream provides an equivalent way to understand the history.

### 3.13 The stage is primary; chrome is secondary

The interface should disappear when the performance begins. Controls remain discoverable, but the repository—not the product UI—is the visual hero.

### 3.14 Originality over imitation

The rhythmic path-reading idea may take conceptual inspiration from *A Dance of Fire and Ice*, but GitDance must use original interaction design, graphics, movement, sounds, music, branding, and terminology. It is an interpretation of Git history, not a reproduction of another game's assets or exact mechanics.

### 3.15 Animation is the product

GitDance is not a static Git graph, a slideshow of graph states, or a line-reveal visualization. Lines drawing onto the screen may support the performance, but they are not the performance.

At all times during active history, the scene must contain intentional movement generated by repository events: performers travel between commit nodes, contributor signatures flow through paths, active threads progress concurrently, divergences physically separate, merges visibly approach and synchronize before impact, existing structures react, and the camera composes those actions into shots and phrases. Motion must communicate anticipation, cause, impact, and release.

A build fails the central product requirement if pressing **Play** merely causes paths and dots to appear over time while the viewport remains essentially static.

### 3.16 The specification is a score, not a cage

This document defines the product's intent, factual invariants, emotional arc, and quality bar. Its wireframes, formulas, event names, suggested technologies, visual metaphors, and numeric examples are starting material—not a demand for mechanical reproduction.

The designer and implementer should exercise taste: combine ideas, omit weak embellishments, discover stronger transitions, invent an original visual identity, and change the proposed implementation when a better solution serves the experience. The finished work should feel authored rather than assembled from a checklist.

Creative freedom is broad in composition, motion, pacing, typography, sound, shaders, interaction details, and visual metaphor. It does not extend to falsifying Git topology, hiding incomplete data, removing meaningful animation, violating the no-backend architecture, or sacrificing accessibility. Preserve the truth and the emotional goal; interpret the expression.

---

## 4. Goals and product outcomes

### 4.1 Primary goals

- Turn any valid public GitHub repository URL into a watchable animation with one obvious action.
- Preserve and explain the repository's known commit topology.
- Make periods of independent, parallel development visibly concurrent.
- Produce a compelling performance for linear, branch-heavy, merge-heavy, tiny, old, and enormous repositories.
- Make the default branch obvious without erasing side-thread importance.
- Show contributors as persistent human signatures moving through the structure.
- Convert repository-specific activity into adaptive rhythm, tempo, pacing, camera behavior, and effect intensity.
- Support pause, seek, inspect, replay, and deterministic sharing.
- Remain a static GitHub Pages application with no application backend.
- Establish an open, reusable engine and data format that others can extend.

### 4.2 Secondary goals

- Help maintainers see the narrative shape of a project they know intimately.
- Help newcomers understand when a project formed, branched, accelerated, stabilized, or went dormant.
- Produce short, striking videos and stills suitable for release posts, conference talks, project anniversaries, and social sharing.
- Provide an artful alternative to conventional commit graphs without sacrificing truth.
- Create a public corpus of synthetic pathological histories for Git visualization research and testing.

### 4.3 Comprehension outcomes

After watching or exploring, a viewer should be able to identify:

- when the repository began;
- the rough eras of activity and dormancy;
- the default branch's continuity;
- where major surviving divergences and merges occurred;
- how many lines of work were active during a selected period;
- which contributors were active and where their activity flowed;
- whether a dramatic moment represents commits, concurrency, a merge, a tag/release, or an aggregate;
- which parts of the history are exact, derived, aggregated, or unavailable.

### 4.4 Emotional outcomes

The performance should create:

- anticipation when a large waveform peak approaches;
- intimacy during quiet linear development;
- expansion as new work separates;
- controlled overwhelm during parallel bursts;
- satisfaction when long-running work converges;
- release when the camera and sound settle after a merge storm;
- wonder at the accumulated shape of years of collaboration.

---

## 5. Audience and use cases

### 5.1 Primary audiences

**Open-source maintainers**  
Watch and share the history of their project, celebrate anniversaries and releases, and explain development eras.

**Contributors and developer communities**  
See their collective work represented as a coherent performance.

**Developers and Git learners**  
Build an intuitive understanding of causal history, divergence, and merge structure.

**Data-visualization and creative-coding enthusiasts**  
Explore deterministic generative art driven by real software history.

**Educators, speakers, and documentarians**  
Create visual material for talks, courses, retrospectives, and project histories.

### 5.2 Representative use cases

- “Show me the first ten years of React in ninety seconds.”
- “When did this repository become highly parallel?”
- “Make a silent looping clip for our release page.”
- “Pause at this merge and inspect the paths that converged.”
- “Highlight one contributor without hiding everyone else.”
- “Compare the energetic signature of two releases.”
- “Export a deterministic `.gitdance` artifact for a talk that must work offline.”
- “Open the same shared link and see the same camera direction and color assignment.”

---

## 6. Scope boundary and truth model

### 6.1 Hosted product scope

The canonical hosted application accepts **public GitHub repository URLs**. Examples:

```text
https://github.com/facebook/react
github.com/facebook/react
https://github.com/torvalds/linux.git
```

URLs are normalized to `owner/repository`. Query strings, fragments, tree paths, issue paths, and trailing `.git` are removed when unambiguous. Gists, non-repository routes, private repositories, and non-GitHub hosts are rejected with clear guidance.

### 6.2 No-backend invariant

Runtime architecture:

```text
GitHub Pages static files
          ↓
user's browser ─────────────→ GitHub public API
          ↓
Web Workers: normalize, analyze, lay out, compile
          ↓
WebGL/Canvas renderer + Web Audio
          ↓
local cache / optional local export
```

The project operates no runtime API, proxy, database, queue, authentication service, or rendering farm. GitHub Actions builds and deploys static assets and can generate curated demo files on a schedule. An Action is build infrastructure, not a request-time backend.

### 6.3 What Git can and cannot prove

The commit graph reliably provides commit identities and parent relationships for fetched commits. It can establish ancestry, divergence, merge structure, and causal order.

Git commits do **not** permanently store “the branch this commit was created on.” A branch is a movable ref. After a branch is deleted, its former name may be gone even though a merge commit preserves its ancestry. Therefore:

- the internal primitive is a **thread**, not a named branch;
- current refs may label threads when the association is defensible;
- pull-request or release metadata may enrich labels when explicitly fetched;
- synthetic branch names are prohibited;
- unnamed historic paths may remain unlabeled or receive neutral non-semantic identifiers such as `thread 07`.

Similarly, rebased, squash-merged, force-pushed, garbage-collected, or otherwise removed history cannot be reconstructed from the current public repository. GitDance visualizes the history that survives and says so.

### 6.4 Exact, derived, aggregate, and unknown

Every datum that can influence a visible claim carries provenance:

| Class | Meaning | Example treatment |
|---|---|---|
| Exact | Directly present in fetched GitHub/Git data | Solid node and ordinary tooltip |
| Derived | Deterministically inferred from exact data | Solid geometry with “derived” explanation |
| Aggregate | Multiple exact items intentionally summarized | Capsule/ribbon with count and span |
| Estimated | Approximation based on sampling or incomplete metadata | Distinct dashed/soft style and estimate symbol |
| Unknown | Not fetched, missing, or not retained | Gap/veil; never replaced by invented edges |

The player exposes a compact data-quality indicator and a detailed “What am I seeing?” panel.

---

## 7. Core user experience

### 7.1 Landing state

The opening page is nearly empty:

```text
                              GITDANCE

                  Paste a public GitHub repository

             github.com/________________________________

                                PLAY

             Try React · Git · Kubernetes · a tiny repo
```

Desired qualities:

- one dominant input;
- one dominant action;
- examples available without overwhelming the page;
- a short privacy statement: “Fetched from GitHub, rendered on your device”;
- a link to “How it works” and the open-source repository;
- paste detection and immediate URL normalization;
- Enter submits; Escape clears;
- recent local repositories may appear only after the user has used the app.

### 7.2 Loading as a prelude

Loading should feel like the opening of the performance, while remaining honest and cancellable:

```text
REACT
facebook/react

Reading repository…
Mapping 18,442 known commits…
Finding parallel threads…
Composing 2013 → 2026…

██████████████████░░░░░░░░

[ Play when ready ]  [ Cancel ]
```

Progress is based on real completed stages or page counts, never a fake percentage. If total work is unknown, use stage progress and indeterminate motion. The user may start a coherent partial performance when available; continued loading can refine unseen future sections without moving already-compiled geometry unless the user opts to rebuild.

### 7.3 Opening sequence

1. Interface fades to a dark stage.
2. Repository owner/name and the first known date appear quietly.
3. A seed marks the root commit, or multiple seeds appear for multiple roots.
4. The first beat lands.
5. The primary line begins drawing.
6. UI chrome recedes; the bottom timeline stays faintly present.

### 7.4 Player layout

```text
┌──────────────────────────────────────────────────────────────────────┐
│ GITDANCE                                     facebook/react  ·  exact│
│                                                                      │
│                         ●──●                                         │
│                    ╭────╯  ╲                                        │
│             ●─────●         ●──╮                                    │
│          ╭──╯   ╭─╯             ╲                                   │
│ MAIN  ━━●━━━━━━●━━━━━━━━━━◎━━━━━━●━━━━                              │
│          ╲      ╲         ╱      ╱                                   │
│           ●──────●──●────●──────●                                    │
│               ╲      ╲  ╱                                            │
│                ●──────◎─●        contributor pulse →                 │
│                                                                      │
│  Jordan Walke · “Introduce public API” · 2013-05-29                  │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ ACTIVITY                  ╭╮                    ╭████╮                │
│ ──────╭──╮───────╭──────╯╰─────╭──────────────╯████╰──────────────  │
│ 2013  ╰──╯  2015 ╰──────────────╯        2021    ▲        2026       │
│                                                  NOW                 │
│              ⏮    ◀    ❚❚    ▶    ⏭     1×     00:47 / 01:30        │
└──────────────────────────────────────────────────────────────────────┘
```

The stage occupies roughly 82–88% of the viewport. The activity timeline and transport occupy the remaining lower band, expanding when hovered, focused, or explored.

### 7.5 Product modes

**Cinematic mode**  
The default. Minimal UI, automatic camera, generated soundscape, controlled labels, and a fixed target duration.

**Explore mode**  
Manual pan/zoom, persistent labels, filters, inspectable nodes and edges, exact historical time, and topology/data-quality overlays.

**Story mode**  
Automatically identifies eras and landmark moments and presents them as chapters with short factual captions.

**Contributor focus**  
One or more contributor signatures brighten while topology remains intact. The timeline shows their activity against total activity.

**Silent gallery mode**  
Loopable, UI-free, reduced text, suitable for installations, landing pages, and ambient displays.

**Compare mode — stretch**  
Synchronizes two repositories or two eras by normalized lifetime or release boundaries, showing activity and topology side by side.

### 7.6 Inspection

Hovering or keyboard-focusing a commit reveals:

- abbreviated SHA and link to GitHub;
- message subject;
- authored and committed timestamps when available;
- author and committer distinction;
- parent count;
- known thread/ref labels;
- whether it is a merge;
- additions, deletions, and files changed only when fetched;
- provenance and quality classification.

Selecting a merge highlights every displayed parent path leading into it. Selecting a thread temporarily raises its contrast from divergence to convergence/current tip. Selecting a contributor reveals their pulses and a timeline overlay without recoloring topology.

### 7.7 Animation acceptance requirements

The default playback must be visibly and continuously animated—not merely progressively rendered. The minimum complete motion language is:

- a clearly visible performer, pulse, or orbiting body travels from commit to commit;
- arrivals land on beats and cause local node/path reactions;
- two or more historically concurrent threads can have independently moving performers on screen at the same time;
- a divergence visibly peels a moving trajectory away from its exact source node;
- a merge has an approach phase, synchronized arrival, impact, and release—not an edge that suddenly appears;
- contributor identity travels through a path as moving color, shape, texture, or particles;
- the camera tracks calm work, pulls back for parallel activity, anticipates convergence, pushes or emphasizes impact, and settles afterward;
- older geometry remains alive through subtle breathing, drift, shimmer, or focus response without creating meaningless noise;
- pause freezes the performance into an inspectable truthful graph state, and resume continues without discontinuity;
- reduced-motion mode replaces travel and camera intensity with steady, accessible transitions while preserving event meaning.

At least one automated or recorded end-to-end fixture must demonstrate in a single performance: commit traversal, divergence, simultaneous parallel motion, contributor handoff, merge approach, merge impact, camera pullback/push, and post-merge settling.

---

## 8. Visual system

### 8.1 Stage aesthetic

The default direction is a restrained, high-contrast 2D stage with depth-like effects rather than a free 3D graph:

- near-black or very dark neutral background;
- warm ivory or electric white primary spine;
- dimmer cool-neutral historic paths;
- sparse, saturated contributor accents;
- luminous nodes, soft trails, restrained bloom;
- curves that feel grown and choreographed but remain diagrammatically traceable;
- limited camera rotation, never uncontrolled orbit;
- typography used sparingly and kept screen-aligned.

Two-dimensional topology is a deliberate choice. Perspective-heavy 3D can hide junctions, introduce ambiguous crossings, and make the main path difficult to follow. Shaders, parallax, glow, depth sorting, and small planar rotation can provide spectacle without sacrificing graph readability.

### 8.2 Structural hierarchy

| Element | Default treatment | Meaning |
|---|---|---|
| Default first-parent spine | Brightest, thickest continuous path | Primary historical anchor |
| Active focused thread | Temporarily brightened edge and nodes | Current choreography focus |
| Other active threads | Medium contrast, motion visible | Concurrent work |
| Inactive historic threads | Thin, dim, stable | Context |
| Merged thread | Persistent ghost trail, slowly receding | Past structure remains legible |
| Current unmerged ref | Live endpoint with restrained beacon | Surviving line of development |
| Unknown/unloaded span | Dashed veil or labeled gap | Data is unavailable |
| Aggregated span | Thick ribbon/capsule with count | Many known events summarized |
| Merge commit | Ringed or compound node | Multiple parents |
| Root commit | Seed node | History origin |
| Tag/release | Crown, halo, or tick | Named milestone |

### 8.3 Node scale and importance

Nodes do not simply map linearly to change size. Visual scale is a bounded salience function using available signals:

- merge parent count;
- size of merged side history;
- tag/release association;
- local activity percentile;
- change magnitude when explicitly fetched;
- structural novelty;
- manual landmark status for curated demos.

Ordinary commits stay compact. Repeated commits at high density may be rhythmically represented without every node receiving a full effect. The graph can still retain individually inspectable nodes at suitable zoom levels.

### 8.4 Paths and crossings

- Paths originate and terminate at exact DAG junctions.
- Curves use deterministic splines with bounded curvature.
- Ordinary edge crossings should be minimized by layout.
- When an unavoidable crossing is not a graph junction, bridge/gap styling makes non-connection explicit.
- Merge approaches bend gradually toward their destination before impact.
- Paths never teleport or silently swap lanes.
- Edge direction is inferable from reveal motion and optional arrow pulses, not a forest of permanent arrowheads.

### 8.5 Contributor identity

Each normalized contributor receives a stable signature derived from a deterministic hash and adjusted for perceptual separation from neighboring active contributors. A signature can include:

- an OKLCH color accent;
- particle shape or trail texture;
- pulse envelope;
- optional small glyph in accessibility mode;
- optional spatial/audio motif.

Identity appears as energy moving through the structural path:

```text
path meaning        = line brightness, thickness, continuity, dash
human activity      = traveling color, pulse, particle, halo, motif
focus/selection     = outline, isolation, label, timeline overlay
```

Bots may be grouped or displayed with a distinct mechanical signature. Co-authored commits can layer two signatures. When GitHub identity is absent, name/email metadata is normalized locally; raw email addresses are never displayed by default and should be hashed for identity keys.

### 8.6 Historical persistence

Old structure should remain faintly visible so the present has context. To keep long histories readable:

- inactive edges decay toward a floor opacity rather than disappearing;
- distant detail collapses into density-aware silhouettes;
- merged threads can leave “scars” or faint residues;
- labels expire aggressively unless selected;
- active geometry always wins the contrast and effect budget;
- zooming in restores exact nodes when the data is loaded.

---

## 9. Git topology model

### 9.1 Canonical graph

Represent the repository as a directed acyclic graph `G = (V, E)`:

- `V`: fetched commit objects keyed by full SHA;
- `E`: parent-to-child edges derived only from each commit's parent SHA list;
- one or more roots: commits with no known parent in the complete graph;
- boundary nodes: commits whose parent lies outside the fetched window;
- refs: current branches and tags pointing at commits;
- default tip: the repository's current default branch head.

The raw graph is immutable after a dataset version is finalized. Layout, thread assignment, activity analysis, aggregation, and choreography are derived layers.

### 9.2 Primary spine

The default primary spine is the **first-parent chain of the current default branch tip**, traversed toward the roots and displayed oldest to newest. This matches the mainline integration story more closely than simply choosing the busiest lane.

Fallback order when the default ref or tip cannot be resolved:

1. explicit user-selected ref;
2. current branch with the greatest reachable known history;
3. deterministic highest-salience tip;
4. a synthetic presentation spine clearly labeled as derived.

The selected policy is visible in the data panel and serialized into shared settings.

### 9.3 Threads, not fictional branches

A **thread** is a visual path assignment through the DAG. Thread decomposition should:

- pin the primary spine;
- identify non-first-parent ancestry introduced by merges;
- include current unmerged branch tips when fetched;
- reuse lanes across non-overlapping time spans when this does not imply false continuity;
- preserve octopus and criss-cross merge structure;
- allow a commit to be part of shared ancestry without duplicating the commit;
- attach branch names only from real refs or trustworthy enrichment.

One possible deterministic decomposition:

1. walk the primary first-parent chain;
2. at each merge, traverse unseen non-first-parent ancestry back to the nearest known junction;
3. assign that ancestry a thread using stable priority by merge time, tip SHA, and salience;
4. add unseen histories reachable from current refs;
5. resolve shared subgraphs with a deterministic path-cover heuristic;
6. retain every extra parent edge even when it is not the chosen visual continuation.

Thread assignment is a readability device; the actual edge set remains authoritative.

### 9.4 Parallelism

Two lineages are causally parallel when neither commit is an ancestor of the other. Human activity is historically concurrent when their timestamp intervals overlap after causal normalization.

Git timestamps can be skewed, rewritten, or inconsistent. Preserve raw authored and committed times, then calculate a presentation timestamp constrained so a child cannot appear before a known parent. Surface large corrections as data-quality warnings rather than silently rewriting the source.

Parallelism measures may include:

- active incomparable threads within a rolling historical window;
- commits per active thread;
- contributor overlap across threads;
- time between divergence and convergence;
- simultaneous unmerged tips;
- merge pressure: active work approaching an integration point.

### 9.5 Complex and unusual histories

The engine must intentionally support:

- linear histories;
- multiple roots and unrelated histories;
- ordinary two-parent merges;
- octopus merges with three or more parents;
- criss-cross merges;
- current unmerged branches;
- default branches not named `main` or `master`;
- missing author accounts;
- bots and co-authors;
- identical timestamps;
- clock skew;
- shallow or partial datasets;
- repositories with no commits;
- force-pushed current state;
- tags on non-mainline commits;
- histories in which branch names have disappeared;
- large numbers of refs;
- commits whose messages contain markup or hostile text.

### 9.6 What must never happen

- Invent an edge to make layout easier.
- Present a sampled gap as an exact path.
- Treat author date alone as causal ordering.
- Assume every merge has two parents.
- Assume all meaningful commits are reachable from the default branch.
- Hardcode `main` or `master`.
- Duplicate a commit into several fake nodes without a shared-commit visual convention.
- Claim a historic branch name based only on a commit message guess.
- Infer merge conflicts from the existence of a merge commit.

---

## 10. Time, rhythm, and intensity

### 10.1 Two clocks

GitDance has two explicit clocks.

**Historical time** is the repository's real authored/committed chronology, corrected only enough to respect known parent-before-child causality. It drives dates, era labels, and the bottom timeline.

**Performance time** is the duration and pacing of the animation. It compresses empty spans, reserves time for important events, groups dense micro-events, and quantizes movement into a musical structure.

The mapping `P = f(H)` must be monotonic. Seeking by date and seeking by performance position use the same serialized mapping.

### 10.2 Time-warp behavior

- Long inactivity passes rapidly but visibly, with a calendar sweep and graceful sustained motion.
- Ordinary linear development advances steadily.
- Busy periods receive more screen time so parallel events remain readable.
- Within busy periods, beat density and movement energy increase.
- Important merges receive approach, impact, and release time even if their timestamps are close to surrounding commits.
- The final performance fits a user-selected target duration such as 30, 60, 90, 180 seconds, or “natural.”

This creates the intended tension: **historical time slows down because much is happening, while the dance itself becomes faster.**

### 10.3 Activity feature vector

For each adaptive historical bucket, calculate available features:

```text
C = commit density
T = concurrent active threads
M = merge pressure and merge significance
U = concurrent unique contributors
D = change magnitude, when fetched
N = topology novelty: new divergence, new root, unusual parent structure
R = release/tag salience
```

Normalize features against the repository's own history using robust percentiles or median/MAD transforms. A small project's busiest week should be allowed to feel climactic even when its raw volume is tiny compared with Linux.

An initial intensity model:

```text
rawIntensity =
    0.20 * percentile(C) +
    0.24 * percentile(T) +
    0.22 * percentile(M) +
    0.12 * percentile(U) +
    0.08 * percentile(D) +
    0.09 * percentile(N) +
    0.05 * percentile(R)
```

Weights are renormalized when a feature is unavailable. The production model should be configuration-driven and versioned, not scattered constants.

### 10.4 Smoothing and musical shape

Raw activity is too jagged to direct a camera or score. Produce several related signals:

- **micro pulse:** near-raw local commit events;
- **phrase intensity:** smoothed over a short adaptive window;
- **era intensity:** smoothed over a longer window;
- **merge anticipation:** rises before a significant convergence;
- **release envelope:** attack, impact, and decay around landmarks.

Use hysteresis so the director does not repeatedly jump between calm and chaos near a threshold. Preserve sharp, important impulses such as major merges even when smoothing the surrounding curve.

### 10.5 Tempo

Tempo is driven by phrase intensity but has bounded, musically useful regions rather than a continuously twitching value. A default preset may move among approximately:

- calm: 64–84 BPM;
- active: 88–118 BPM;
- intense: 122–154 BPM;
- peak: 158–184 BPM or half-time interpretation.

Exact ranges are preset choices, not claims about repository speed. Tempo transitions happen over phrases. At extreme event density, subdivision, polyrhythmic accents, aggregation, and half-time can convey magnitude without producing an illegible machine-gun beat.

### 10.6 Generated beat map

The compiler assigns semantic events to musical roles:

| Git/history event | Musical role |
|---|---|
| Ordinary commit | Beat or subdivision |
| Large/salient commit | Accented beat |
| Divergence | Pickup or syncopated accent |
| Thread activation | New rhythmic voice |
| Merge approach | Rising phrase/tension |
| Merge impact | Downbeat |
| Octopus or major merge | Phrase boundary / compound hit |
| Tag or release | Major downbeat or cadence |
| Long gap | Sustain/rest with calendar motion |
| Dormancy/end | Decay or resolved cadence |

Quantization is bounded. If exact timestamps would be visibly misrepresented, the event stays in order and the rhythm adapts around it. The score must never reorder causally related commits for musical convenience.

### 10.7 Sound design

Sound is procedural, optional, and original:

- soft ticks or tonal impulses for commits;
- distinct envelopes for divergence and merge;
- contributor motifs that layer without becoming a literal notification sound per person;
- low-frequency impact and spatial convergence for significant merges;
- ambient sustain during quiet spans;
- intensity-driven filtering and texture rather than simple volume escalation;
- limiter and headroom so dense history cannot clip;
- a complete mute mode and independent music/effects controls.

No information is available only through audio. The system respects browser autoplay restrictions and starts audio only after a user gesture.

---

## 11. Choreography event grammar

The compiler converts graph and history facts into a small, composable, deterministic vocabulary. The vocabulary should remain explainable: every movement can be traced to an event and salience score.

| Event | Trigger | Movement | Visual treatment | Camera/audio behavior |
|---|---|---|---|---|
| `REPO_BIRTH` | First known root | Seed appears and settles | Root bloom; title/date | Close framing; first tone |
| `MULTI_ROOT_REVEAL` | Multiple unrelated roots | Seeds enter from separated anchors | Distinct root halos | Pull back to establish stage |
| `COMMIT_STEP` | Ordinary commit | Performer rotates/arcs to next node | Path reveal + small pulse | Beat-level response only |
| `COMMIT_CLUSTER` | Dense linear commits | Several steps become a phrase | Controlled burst/ribbon | Subdivision or roll |
| `QUIET_GAP` | Long historical inactivity | Slow suspended arc while calendar advances | Dim drift; dust/fade | Sustained tone; gentle drift |
| `DIVERGENCE` | Child line separates from known ancestry | New trajectory peels from exact node | Clean split flare | Slight pullback; pickup accent |
| `THREAD_ACTIVATE` | Previously quiet lineage becomes active | Dancer/pulse enters its path | Temporary brightening | Reframe to include it |
| `PARALLEL_PHRASE` | Multiple incomparable threads active | Performers advance concurrently | Independent pulses kept in phase family | Ensemble framing; layered rhythm |
| `CONTRIBUTOR_ENTER` | First visible activity by identity | Signature flows into active path | Color/shape motif | Small timbral entrance |
| `CONTRIBUTOR_HANDOFF` | Dominant contributor changes on a thread | New signature overtakes/fades with old | Crossfade, not path recolor | Optional motif transition |
| `MERGE_APPROACH` | Significant multi-parent commit imminent | Source thread curves toward destination | Tension glow along parent edges | Track convergence; rising cue |
| `MERGE_IMPACT` | Merge commit lands | Performers synchronize at merge node | Ring, ripple, brief shockwave | Push-in and downbeat |
| `MAJOR_MERGE` | High merge salience | Spiral/compound approach with bounded flourish | Larger but budgeted impact | Strong camera punch and cadence |
| `OCTOPUS_MERGE` | More than two parents | Several approaches phase-lock | Multi-ring node | Wide-to-tight ensemble cue |
| `MERGE_STORM` | Several merges overlap | Impacts combine into one composed phrase | Shared wavefront; local details | One designed sequence, not effect spam |
| `THREAD_DORMANT` | No later known activity | Motion stops; path remains | Gradual ghosting | Camera releases focus |
| `UNMERGED_TIP` | Current ref remains separate | Performer settles at endpoint | Quiet beacon/ref label | Balanced unresolved cadence |
| `TAG_LANDMARK` | Tag or release | Node receives halo/crown | Label appears briefly | Cadence or tonal marker |
| `ERA_TRANSITION` | Sustained activity/style regime changes | Composition breathes and reorganizes | Palette/atmosphere shift within theme | Phrase transition |
| `AGGREGATE_SPAN` | Known events intentionally coarsened | Pulse travels through a weighted ribbon | Commit count and duration encoded | Summary rhythm |
| `UNKNOWN_SPAN` | History unavailable | Movement crosses no claimed topology | Labeled fog/gap/dashed bridge | Audio thins; no fake impact |
| `REPO_PRESENT` | Playback reaches selected tip | Active signatures settle | Current refs glow; full structure visible | Final cadence and slow reveal |

### 11.1 Movement rules

- A movement begins and ends at real or explicitly aggregate anchors.
- Simultaneous events share a phrase clock but keep independent spatial trajectories.
- Salience changes amplitude and staging, not factual meaning.
- Motion paths are precomputed for seekability.
- Each event declares `preRoll`, `impactTime`, and `release` where applicable.
- All events have reduced-motion equivalents.
- The animation engine supports reversal and seeking without replaying side effects.

### 11.2 Effect budget

Every time window receives a deterministic effect budget based on display size, device tier, accessibility settings, and intensity. Events bid for:

- camera attention;
- bloom area;
- particle count;
- label slots;
- audio voices;
- shockwave count;
- screen-space motion.

High-salience events win. Lower-salience events collapse into local pulses or aggregate phrases. Several nearby merges may become one `MERGE_STORM`; twenty dense commits may become a `COMMIT_CLUSTER`. This is how the project achieves deliberate chaos instead of visual garbage.

---

## 12. Camera director

The camera is a first-class subsystem that consumes planned geometry and future events. It does not merely chase the newest node.

### 12.1 Camera states

**Intimate**  
Close follow on a single active path during calm linear history.

**Split awareness**  
Pull back enough to retain the divergence point and both live trajectories.

**Ensemble**  
Frame all materially active threads with the primary spine near a stable visual axis.

**Chaos overview**  
Show the entire active frontier, de-emphasize distant old geometry, and allow restrained planar rotation to reduce overlap.

**Convergence tracking**  
Bias the frame toward an approaching merge while keeping source and destination visible.

**Impact**  
Use a brief push-in, scale pulse, or small rotational correction at the exact hit.

**Release**  
Ease out, let trails settle, and reacquire the primary spine.

**Final tableau**  
Frame the repository's accumulated form and current tips.

### 12.2 Director inputs

- current and near-future active bounds;
- primary spine location;
- active thread count;
- occlusion and label pressure;
- phrase and era intensity;
- upcoming divergence/merge salience;
- selected/focused contributor or thread;
- timeline/UI safe areas;
- reduced-motion preferences;
- manual override state.

### 12.3 Shot planning

The director looks ahead by a configurable number of beats. It computes shot keyframes during compilation, then applies critically damped or authored easing between them. This prevents reactive jitter and gives significant events setup time.

Rules include:

- never crop the exact junction during a split or merge;
- do not cut during a continuous movement unless a preset deliberately permits it;
- keep title, captions, and bottom timeline clear;
- cap rotation and angular velocity;
- use longer settling after high-intensity phrases;
- retain the primary spine in frame or provide an obvious reacquisition move;
- respect manual control until the user explicitly returns to “Auto camera.”

### 12.4 Motion safety

Reduced-motion mode replaces fast zooms, spirals, rotation, screen shake, and large parallax with opacity, stroke emphasis, bounded dissolves, and steady framing. A separate “no flashes” option limits luminance transitions and removes rapid full-screen pulses.

---

## 13. Bottom activity timeline

The bottom timeline is both navigation and the visible control signal for the show.

### 13.1 Required layers

- repository lifetime from first known commit to selected tip;
- smoothed development-intensity waveform;
- exact/aggregate/unknown coverage overlay;
- current historical-time playhead;
- buffered/fetched range;
- divergence, merge, tag/release, and era markers;
- selection range;
- optional contributor activity overlay;
- optional raw commit rug at high zoom.

### 13.2 Interaction

- click/tap to seek;
- drag the playhead;
- drag a range to loop;
- wheel/pinch to zoom the historical scale in Explore mode;
- hover/focus for a bucket tooltip;
- arrow keys step by beat, commit, or time bucket depending on mode;
- jump to next/previous landmark;
- click a peak to open its causal summary.

### 13.3 Bucket tooltip

Example:

```text
October 11–17, 2021
────────────────────
84 known commits
6 concurrent threads
11 contributors
3 merges
1 tagged release
+18,402 / −9,381 lines (enriched)
Intensity: 94th percentile
Coverage: exact
```

Unavailable measures are omitted or marked unavailable, not shown as zero.

### 13.4 Foreshadowing

The entire high-level waveform is visible from the start. A viewer should be able to see a distant mountain of activity and wonder what is coming. Optional “spoiler-free” mode reveals the timeline progressively.

### 13.5 Accessibility representation

The waveform has a textual summary and landmark list. Screen-reader users can navigate eras and events, hear labels such as “high activity, five concurrent threads, two merges,” and seek without operating a canvas-only control.

---

## 14. Client-side ingestion

### 14.1 Data sources

The initial hosted product uses GitHub's public REST API directly from the browser. Candidate calls include:

- repository metadata and default branch;
- current branch refs;
- current tags/releases as budget permits;
- paginated commit listings for the default branch and selected other tips;
- individual commit enrichment only for high-salience or user-selected commits;
- contributor information when available and affordable.

The ingestion adapter owns API-version headers, pagination, conditional requests, retry policy, rate-limit interpretation, and schema validation. The rest of the application consumes provider-neutral normalized records.

### 14.2 Staged ingestion

**Stage 0 — Validate and identify**

- normalize the URL;
- reject unsupported hosts/routes;
- fetch repository metadata;
- confirm public visibility and non-empty state;
- record default branch, size hints, latest push metadata, and API limits.

**Stage 1 — Establish the anchor**

- fetch the default branch tip and newest commit page;
- build an initial exact graph window;
- show repository identity and a preliminary timeline range.

**Stage 2 — Expand default history**

- follow pagination within a dynamic request budget;
- deduplicate by SHA;
- update coverage and size estimates;
- stop cleanly before rate exhaustion.

**Stage 3 — Discover surviving parallel tips**

- enumerate current branches within budget;
- prioritize tips not already reachable in the known graph;
- fetch ancestry until it connects to known history or reaches a budget boundary;
- preserve an explicit unknown boundary when it does not connect.

**Stage 4 — Landmarks**

- fetch tags/releases and associate them with known commits;
- identify candidate significant merges from parent counts and unique side ancestry;
- avoid one-request-per-commit enrichment.

**Stage 5 — Selective enrichment**

- retrieve full commit details for visible landmark commits, current selection, or export-quality compilation;
- attach additions, deletions, and changed-file counts where the API supplies them;
- renormalize intensity only if doing so will not invalidate an already-playing compiled future, or ask to rebuild.

**Stage 6 — Normalize and cache**

- validate records;
- produce the canonical model;
- persist safe responses and compiled artifacts in IndexedDB;
- compile the performance in a Worker.

### 14.3 Request budgeting

As of the document date, GitHub documents a primary limit of 60 REST requests per hour for unauthenticated public-data requests, associated with the originating IP, and 5,000 per hour for typical authenticated personal requests. GitHub also documents pagination and notes that most paginated endpoints allow up to 100 items per page. These are external constraints and must be read from response headers and handled dynamically rather than assumed forever. See [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [REST pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api), and [commit endpoints](https://docs.github.com/en/rest/commits/commits).

The product should:

- reserve requests for metadata and recovery;
- display the actual remaining/reset information from headers when available;
- avoid parallel request bursts that trigger secondary limits;
- use `ETag`/conditional requests where supported;
- reuse cached pages across sessions;
- make enrichment optional and salience-driven;
- pause before exhaustion and offer a truthful partial performance;
- never imply GitDance can reset or bypass GitHub limits.

### 14.4 Optional local token mode

An advanced setting may allow a user to supply a fine-grained GitHub personal access token for public-read requests. This remains backend-free, but it is optional and must be handled conservatively:

- keep it in memory by default;
- never include it in URLs, logs, exports, error reports, analytics, service-worker caches, or persisted artifacts;
- do not store it in `localStorage`;
- clearly explain that the token is sent only from the browser to `api.github.com`;
- encourage minimal permissions and easy revocation;
- wipe it on tab close/reload unless the user explicitly chooses a safer platform-supported credential mechanism in a future release;
- ship a strict Content Security Policy and dependency review.

Anonymous public-repository use remains the primary experience.

### 14.5 Caching

Use IndexedDB for:

- normalized API pages keyed by endpoint, API version, and ETag;
- repository metadata;
- canonical commit fragments keyed by SHA;
- compiled layout/choreography keyed by dataset hash and engine version;
- optional user presets and recent-repository list.

Use the Cache API/service worker for versioned static application assets and curated demo artifacts. Provide “storage used,” “clear repository,” and “clear all local data” controls.

### 14.6 Cancellation and replacement

Every ingestion run has an `AbortController` and run identifier. Pasting a new URL cancels stale network, worker, and compile work. Late responses from a cancelled run cannot mutate the active state.

---

## 15. Large-repository strategy and level of detail

Large-repository support is a foundational architecture concern, not a future patch. It has two separate problems:

1. obtaining enough history within browser/API limits;
2. rendering and choreographing millions of facts without overwhelming the device or viewer.

### 15.1 Non-negotiable distinction

**Aggregation after complete ingestion can be topology-preserving. Sampling before ingestion cannot prove unseen topology.**

Therefore:

- if all commits in a span are known, the engine may replace a linear run or subgraph with a truthful aggregate that records exact boundary edges and counts;
- if commits are not fetched, the engine must show an unknown/estimated span and may visualize activity density, but must not draw invented internal branches or merges;
- curated precomputed demos can provide exact coarse topology for giant repositories because their analysis happens ahead of deployment;
- zooming into an exact aggregate can expand it; zooming into an unknown span requires fetching more data.

### 15.2 Adaptive modes

Thresholds are tunable heuristics based on commit count, edge count, refs, device capacity, and request budget—not hard conceptual limits.

| Mode | Typical known scale | Initial representation | Detail behavior |
|---|---:|---|---|
| Full | Up to a few thousand commits | Individual commits and edges | All known nodes available |
| High detail | Thousands to tens of thousands | Exact graph with clustered linear runs | Expand on zoom/selection |
| Adaptive | Tens to hundreds of thousands | Exact landmarks, merge skeleton, density ribbons | Load/render tiles by era and viewport |
| Cinematic topology | Hundreds of thousands to millions | Hierarchical exact aggregates when precomputed; unknown spans otherwise | Drill-down and progressive refinement |

### 15.3 Hierarchical representation

Build a multiresolution graph pyramid from known data:

- **L0:** individual commits and parent edges;
- **L1:** compress maximal low-salience linear runs;
- **L2:** time-bucketed thread segments retaining junctions;
- **L3:** era subgraphs retaining roots, divergence/merge landmarks, current refs, and releases;
- **L4:** repository-wide topology silhouette and activity waveform.

Every aggregate stores:

- exact member count;
- boundary commits and boundary edges;
- historical span;
- contributor distribution;
- activity statistics;
- parent count/merge summaries;
- expansion key;
- provenance and completeness.

Never aggregate away a junction required to understand surviving topology at the current level. Significant merges, multi-parent commits, roots, current tips, selected commits, and visible tags are protected landmarks.

### 15.4 Visual aggregation

Examples:

```text
Exact linear commits:
●─●─●─●─●─●─●─●─●─●

Collapsed known span:
●══════════════════●
       3,812 commits

Unavailable history:
●╌╌╌╌╌ history not loaded ╌╌╌╌╌●
```

Aggregate thickness can encode volume; internal pulses can encode rhythm; labels state counts. Aggregation should make giant histories more legible, not merely cheaper.

### 15.5 Progressive refinement

- Compile a stable overview first.
- Prioritize the current viewport, upcoming playback window, and landmark neighborhoods.
- Fetch and expand ahead of the playhead.
- Avoid changing geometry already on screen during playback.
- If a refinement changes a major future topology, splice it only at a phrase boundary with a subtle “detail resolved” transition.
- Allow users to pin an era for maximum available detail.

### 15.6 Resource adaptation

At startup, choose a device tier from measured capability—not user-agent alone. Adapt:

- render resolution and device-pixel ratio;
- particle and trail budgets;
- bloom passes;
- label count;
- graph LOD;
- worker concurrency;
- cache size;
- prefetch window;
- export resolution.

The topology and event order remain the same; only visual fidelity and aggregation level adapt.

---

## 16. Deterministic compilation

### 16.1 Determinism key

A performance is identified by:

```text
datasetHash
+ modelSchemaVersion
+ analyzerVersion
+ layoutVersion
+ choreographyVersion
+ presetId/presetVersion
+ explicit seed
+ accessibility-affecting settings
```

Repository fetch time and other volatile metadata do not influence layout unless intentionally included.

### 16.2 Canonicalization

- sort records by full SHA before hashing;
- serialize object keys canonically;
- normalize Unicode and line endings;
- retain raw timestamps while using a separately named presentation timestamp;
- sort parent arrays only when Git semantics do not depend on parent order—otherwise preserve parent order;
- sort refs and contributors by stable keys;
- define tie-breakers for every graph algorithm;
- use a versioned seeded PRNG for all aesthetic variance;
- avoid `Math.random()` in compiled paths;
- quantize geometry at a documented precision where cross-runtime stability matters.

### 16.3 Fixed-step playback

The player samples a precompiled timeline by performance time. It does not integrate irreversible effects frame by frame. Particles that need pseudo-physics are deterministic functions of event time and seed or run through fixed-step simulation with seek checkpoints.

This enables:

- seeking without replaying from zero;
- repeatable capture;
- consistent thumbnails;
- visual regression testing;
- exact shared landmarks;
- deterministic reduced-motion alternatives.

### 16.4 Expected limits

Pixel-perfect output may vary slightly across GPUs, browsers, font renderers, and shader precision. Structural layout, color assignment, event timing, camera keyframes, and selected content must remain stable. Export can offer a deterministic software/canvas path when exact repeatability is more important than real-time effects.

---

## 17. Data model

The canonical data model is provider-neutral even though the initial hosted adapter is GitHub-specific.

```ts
type Sha = string;
type UnixMs = number;

type Provenance = "exact" | "derived" | "aggregate" | "estimated" | "unknown";

interface RepositorySource {
  provider: "github";
  owner: string;
  name: string;
  canonicalUrl: string;
  apiUrl: string;
  defaultBranch: string | null;
  selectedRef: string | null;
  selectedTipSha: Sha | null;
  fetchedAt: string;
}

interface CommitNode {
  sha: Sha;
  parentShas: Sha[];             // preserve Git parent order
  authorIdentityId: string;
  committerIdentityId: string | null;
  authoredAtRaw: string | null;
  committedAtRaw: string | null;
  presentationTime: UnixMs;
  messageSubject: string;
  messageBodyAvailable: boolean;
  githubUrl: string | null;
  stats?: {
    additions: number;
    deletions: number;
    filesChanged: number;
  };
  flags: {
    isMerge: boolean;
    isBoundary: boolean;
    isTimeCorrected: boolean;
    isBot: boolean;
  };
  provenance: Provenance;
}

interface ParentEdge {
  parentSha: Sha;
  childSha: Sha;
  parentIndex: number;
  provenance: Provenance;
}

interface RefRecord {
  id: string;
  kind: "branch" | "tag" | "release" | "other";
  name: string;
  targetSha: Sha;
  current: boolean;
  sourceUrl: string | null;
  provenance: Provenance;
}

interface ContributorIdentity {
  id: string;
  githubLogin: string | null;
  displayName: string;
  githubNumericId: number | null;
  avatarUrl: string | null;
  color: string;
  glyph: string;
  isBot: boolean;
  aliases: string[];              // non-sensitive normalized IDs only
  provenance: Provenance;
}

interface ThreadAssignment {
  id: string;
  commitShas: Sha[];
  startSha: Sha;
  endSha: Sha;
  laneId: string;
  knownRefIds: string[];
  role: "primary" | "merged" | "current" | "auxiliary";
  provenance: Provenance;
}

interface ActivityBucket {
  historicalStart: UnixMs;
  historicalEnd: UnixMs;
  knownCommitCount: number;
  activeThreadCount: number | null;
  contributorCount: number | null;
  mergeCount: number;
  changeMagnitude: number | null;
  topologyNovelty: number;
  rawIntensity: number;
  phraseIntensity: number;
  eraIntensity: number;
  coverage: Provenance;
}

interface AggregateSpan {
  id: string;
  memberShas?: Sha[];
  memberCount: number | null;
  boundaryShas: Sha[];
  historicalStart: UnixMs | null;
  historicalEnd: UnixMs | null;
  level: number;
  expandable: boolean;
  provenance: Provenance;
}

interface ChoreographyEvent {
  id: string;
  type: string;
  historicalTime: UnixMs | null;
  performanceStart: number;
  performanceImpact: number;
  performanceEnd: number;
  subjectIds: string[];
  salience: number;
  beat: number;
  variant: string;
  effectBudget: number;
  provenance: Provenance;
}

interface CameraCue {
  time: number;
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  easing: string;
  reasonEventId: string | null;
}

interface PerformancePlan {
  duration: number;
  historicalToPerformanceMap: Array<[UnixMs, number]>;
  tempoMap: Array<[number, number]>;
  events: ChoreographyEvent[];
  camera: CameraCue[];
  seed: string;
  preset: { id: string; version: number };
}

interface GitDanceArtifact {
  schemaVersion: number;
  source: RepositorySource;
  coverage: {
    completeness: Provenance;
    knownRanges: Array<[UnixMs, UnixMs]>;
    warnings: string[];
  };
  commits: CommitNode[];
  edges: ParentEdge[];
  refs: RefRecord[];
  contributors: ContributorIdentity[];
  threads: ThreadAssignment[];
  activity: ActivityBucket[];
  aggregates: AggregateSpan[];
  performance?: PerformancePlan;
  contentHash: string;
}
```

### 17.1 Format requirements

- JSON schema published and versioned.
- Optional binary/columnar encoding for large artifacts.
- Compressed `.gitdance` distribution form.
- Forward-compatible unknown-field handling.
- Explicit migration utilities between supported schema versions.
- Content hash verification.
- No credentials, raw email addresses, or browser-local secrets.
- Metadata includes engine versions and completeness warnings.

---

## 18. Analysis and layout pipeline

```text
GitHub API records
      ↓
schema validation + normalization
      ↓
commit DAG + boundary analysis
      ↓
default first-parent spine
      ↓
thread/path decomposition
      ↓
causal timestamp normalization
      ↓
activity buckets + salience + eras
      ↓
hierarchical aggregation / LOD
      ↓
layered graph layout
      ↓
performance time map + beat map
      ↓
choreography events + effect budget
      ↓
camera shot plan + audio cues
      ↓
render buffers and seek checkpoints
```

### 18.1 Layout objectives

Optimize a weighted cost function for:

- edge crossings;
- lane changes;
- curvature and sharp bends;
- distance of the primary spine from its preferred axis;
- instability between adjacent time windows;
- separation of simultaneously active threads;
- screen-space density;
- label collisions;
- distance traveled by the camera;
- preservation of recognizable aggregate shapes.

### 18.2 Suggested layout approach

Use a constrained layered-DAG layout inspired by Sugiyama methods, adapted for animation:

1. assign causal/topological layers using presentation time and ancestry;
2. pin primary-spine nodes to a strong, gently curving baseline;
3. place divergence/merge intervals in lanes above or below the spine;
4. order lanes with deterministic barycentric crossing minimization;
5. preserve a thread's side and relative position across its lifetime;
6. route secondary parent edges explicitly;
7. smooth coordinates into bounded splines;
8. compute screen-space LOD and non-junction crossing bridges;
9. store exact geometry and low-resolution approximations.

The layout may alternate sides to balance composition, but the choice must be seeded and stable. It may bend the primary path for artistic phrasing, but not so much that chronology reverses visually.

### 18.3 Era detection

Detect candidate eras from sustained changes in:

- activity level;
- concurrency;
- contributor population;
- merge style;
- release/tag cadence;
- dormancy;
- topology shape.

Era names should be factual and restrained by default: “early formation,” “rapid expansion,” “merge-heavy period,” “maintenance,” “dormancy,” “renewed activity.” Avoid pretending to infer organizational causes from graph data alone.

### 18.4 Salient merge scoring

A merge's salience can incorporate:

- number of parents;
- count of commits unique to non-first-parent ancestry;
- age of the diverged thread;
- contributors represented in the incoming ancestry;
- activity around the merge;
- attached tag/release;
- change magnitude if enriched.

This distinguishes a routine small merge from months of parallel work converging.

---

## 19. Rendering architecture

### 19.1 Rendering choice

Use a 2D logical scene rendered through WebGL2 for scale and effects, with a Canvas2D fallback. WebGPU may become an optional future backend, but the core must not depend on it initially.

Recommended approach:

- PixiJS or a thin custom WebGL2 layer for batched scene rendering;
- custom instanced shaders for nodes, path segments, halos, and particles;
- signed-distance-field or mesh paths for consistent zoom;
- off-screen framebuffers for bounded bloom and distortion;
- an HTML/React overlay for accessible controls, labels, and panels;
- no React state updates in the per-frame render loop.

### 19.2 Scene layers

Back to front:

1. background atmosphere/grid/dust;
2. distant aggregate silhouettes;
3. inactive historical paths;
4. ordinary exact paths and nodes;
5. primary spine;
6. active/focused trajectories;
7. contributor pulses and particles;
8. merge/divergence effects;
9. screen-space labels and selection outlines;
10. HTML timeline and controls.

### 19.3 Geometry and buffers

- Store graph positions, timestamps, thread IDs, salience, and reveal parameters in typed arrays.
- Batch nodes with instanced drawing.
- Tessellate or shader-render paths in chunks by LOD tile.
- Reveal paths by a normalized path-distance attribute rather than rebuilding geometry.
- Cull tiles outside the camera plus look-ahead margin.
- Pool transient effects.
- Use a spatial index or GPU ID buffer for picking.
- Transfer buffers from Workers rather than cloning large objects.

### 19.4 Worker responsibilities

**Ingestion Worker**

- normalization;
- schema validation;
- deduplication;
- cache serialization.

**Analysis/Layout Worker**

- DAG indexes and reachability summaries;
- thread decomposition;
- timestamps, activity, salience, eras;
- aggregation pyramid;
- layout and camera planning.

**Export Worker — where supported**

- offline frame stepping;
- image encoding;
- artifact compression;
- audio/event rendering support.

The main thread owns UI, input, WebGL submission, and audio scheduling.

### 19.5 Seekability

All persistent visual state is a function of performance time. Long-running particle systems use deterministic spawn records and checkpoints. Seeking must complete quickly without replaying the entire repository from its first commit.

### 19.6 Graceful fallback

Fallback ladder:

1. WebGL2 with full supported effects;
2. WebGL2 reduced effects/resolution;
3. Canvas2D exact/aggregated graph with simplified pulses;
4. static SVG/canvas poster plus interactive timeline/event list;
5. textual history summary if no canvas is available.

The application must explain the fallback without blaming the user or pretending full effects are running.

---

## 20. Application architecture and technical stack

### 20.1 Recommended stack

| Area | Choice | Rationale |
|---|---|---|
| Language | TypeScript, strict mode | Shared types across ingestion, analysis, renderer, and tests |
| App shell | React | Accessible UI, routing, settings, panels; kept outside hot render loop |
| Build | Vite | Fast local iteration and straightforward static output |
| Renderer | WebGL2 via PixiJS/custom shaders | Large batched 2D scenes with effects |
| Fallback | Canvas2D | Broad degradation path and deterministic simple export |
| State | Small explicit store such as Zustand or reducer architecture | Playback and async run state without excessive framework ceremony |
| Workers | Native Web Workers, optionally Comlink | Keep graph analysis and layout off the UI thread |
| Audio | Web Audio API | Procedural, synchronized, backend-free sound |
| Cache | IndexedDB, optionally a thin typed wrapper | Large local datasets and compiled plans |
| Validation | JSON Schema plus generated TypeScript validators or Zod at boundaries | Treat API and artifact input as untrusted |
| Compression | `CompressionStream` plus WASM fallback as needed | Local `.gitdance` artifacts and demo assets |
| Unit tests | Vitest | Fast deterministic package tests |
| Browser tests | Playwright | Ingestion, playback, keyboard, fallback, export flows |
| Visual tests | Playwright screenshots with stable fixtures | Camera/layout/effect regression detection |
| Property tests | fast-check or equivalent | DAG invariants and determinism |
| Accessibility | axe-core plus manual keyboard/screen-reader review | Automated and human coverage |
| Deployment | GitHub Actions → GitHub Pages | Static hosting; no runtime backend |

The exact dependency list may evolve. Architectural boundaries matter more than library loyalty.

### 20.2 Runtime modules

```text
URL Parser
   ↓
GitHub Adapter ──→ Request Budget / Cache
   ↓
Normalizer ──→ Canonical Model
   ↓
DAG Engine
   ├── topology index
   ├── spine/thread assignment
   ├── activity/intensity
   └── LOD pyramid
   ↓
Layout Engine
   ↓
Choreography Compiler
   ├── performance clock
   ├── beat map
   ├── event grammar
   ├── effect budget
   ├── camera director
   └── audio cues
   ↓
Player
   ├── renderer
   ├── Web Audio
   ├── timeline
   ├── inspector
   └── export/share
```

### 20.3 State machine

The user-visible application state should be explicit:

```text
IDLE
  → VALIDATING_URL
  → FETCHING_METADATA
  → ESTIMATING_AND_BUDGETING
  → FETCHING_TOPOLOGY
  → ENRICHING_OPTIONALLY
  → BUILDING_DAG
  → LAYING_OUT
  → CHOREOGRAPHING
  → READY
  → PLAYING ↔ PAUSED ↔ SEEKING
```

Side states:

```text
CANCELLED
DEGRADED_READY
RATE_LIMITED
OFFLINE_CACHED
UNSUPPORTED_RENDERER
ERROR_RECOVERABLE
ERROR_FATAL
```

Each state has defined UI copy, progress semantics, cancellation behavior, retry behavior, and preserved data.

### 20.4 GitHub Pages deployment

GitHub Pages serves the generated static bundle. GitHub documents support for publishing a static site through a custom GitHub Actions workflow; see [GitHub Pages documentation](https://docs.github.com/en/pages) and [configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

The deployment workflow should:

- install dependencies from a locked manifest;
- lint and type-check;
- run unit/property tests;
- build the static application with correct base paths;
- run smoke tests against the built output;
- optionally generate/validate curated demo artifacts;
- upload the Pages artifact;
- deploy only from protected branches/environments;
- emit provenance/SBOM information where practical.

Shared state should use query/hash parameters compatible with static hosting so no server-side routing rule is required.

---

## 21. Performance targets and engineering considerations

These are quality targets, not product-scope limits.

### 21.1 Responsiveness targets

- Input and controls respond within one frame under ordinary load.
- Graph analysis and layout never monopolize the main UI thread.
- Playback targets 60 FPS on capable desktop hardware and a stable 30+ FPS fallback on modest devices.
- Seeking in a compiled performance should normally settle in under 100 ms for loaded LOD.
- The first meaningful repository metadata appears as soon as the first metadata request completes.
- A usable partial performance can compile without waiting for optional enrichment.

### 21.2 Memory strategy

- compact SHAs to indexed integer IDs internally;
- use adjacency offsets and typed arrays rather than object-heavy edge lists in hot paths;
- release raw API response bodies after normalization unless cached separately;
- keep only visible and nearby render tiles on the GPU;
- make contributor strings and messages lazy;
- bound particle pools;
- evict cache by repository and least-recent access;
- expose memory estimates in a diagnostics panel.

### 21.3 CPU strategy

- incremental DAG construction;
- memoized reachability summaries rather than naive all-pairs ancestry;
- adaptive historical buckets;
- layout by connected region/era where possible;
- cancellable Workers with progress messages;
- avoid rebuilding the entire performance for a cosmetic setting;
- precompute easing, camera, and path-distance lookup tables.

### 21.4 GPU strategy

- instancing and batch by material/LOD;
- screen-space culling;
- effect budget scaled to frame time;
- dynamic render resolution during chaos;
- optional bloom and distortion passes;
- avoid one DOM element per commit;
- never upload the full scene every frame.

### 21.5 Adaptive quality controller

Measure moving frame time and change one quality dimension at a time with hysteresis. Prioritize preserving:

1. exact active topology;
2. primary-spine contrast;
3. timeline and controls;
4. active node motion;
5. contributor signatures;
6. particles, bloom, atmosphere, and secondary labels.

---

## 22. UI states, errors, and degraded cases

### 22.1 Invalid input

Examples:

- empty input;
- malformed URL;
- non-GitHub host;
- GitHub route that is not a repository;
- owner/repository not found.

Response: preserve the input, explain the accepted format, show a corrected interpretation when safe, and provide a one-click example.

### 22.2 Private or inaccessible repository

Response: “This hosted viewer supports public GitHub repositories. GitHub did not expose this repository publicly.” Do not imply whether a hidden repository definitely exists. Offer optional local artifact/CLI support only when that feature exists.

### 22.3 Empty repository

Show an intentional empty-state performance: repository title, “No commits yet,” a dormant seed, and a link back. This is not a crash.

### 22.4 Rate limited

Show:

- known commits already loaded;
- whether a partial performance is coherent;
- reset time if GitHub supplies it;
- actions: play partial, retry after reset, use cached data, or optionally provide a local token;
- a clear coverage warning in the player.

### 22.5 Partial history

Boundary parents and unloaded eras are visually distinct. The UI must say, for example, “6,000 recent commits loaded; earlier topology is not yet available.” It must not call the result “full history.”

### 22.6 API/network failure

- retry idempotent calls with capped exponential backoff and jitter;
- distinguish offline, DNS/network, GitHub error, abuse/secondary limit, and malformed response;
- preserve cached pages;
- offer offline playback if a compiled artifact exists;
- never spin forever.

### 22.7 Repository changes while loading

Anchor a run to a selected tip SHA as early as possible. New pushes should not mutate the performance mid-compile. Offer “New commits are available—rebuild from latest” after playback.

### 22.8 Missing metadata

- anonymous author → neutral identity, not “Unknown” merged with every other anonymous author;
- missing email/login → locally derived stable key;
- missing timestamps → causal placement with warning;
- missing stats → omit magnitude claims;
- missing names → unlabeled thread;
- missing parent in fetched window → boundary node.

### 22.9 Pathological topology

If layout quality falls below measurable thresholds:

- increase aggregation;
- widen lanes and camera;
- reduce labels/effects;
- show a topology-warning badge;
- allow Explore mode to inspect raw edges;
- never drop edges silently.

### 22.10 Unsupported graphics or low memory

Automatically use the fallback ladder. Preserve playback, seeking, topology, captions, and textual event access even when spectacle is reduced.

### 22.11 Cache/schema mismatch

Validate content hashes and schema versions. Migrate supported artifacts, otherwise re-fetch/recompile with a concise explanation. Never deserialize untrusted executable content.

---

## 23. Settings and customization

### 23.1 Playback

- target duration: 30 s / 60 s / 90 s / 180 s / natural;
- speed multiplier;
- loop full performance or selected era;
- start/end dates or refs;
- pause on landmark;
- chronological vs cinematic pacing;
- spoiler-free timeline.

### 23.2 Visual

- theme/preset;
- main-spine contrast;
- contributor visibility;
- path persistence/ghosting;
- node density and LOD bias;
- labels: minimal / landmarks / all visible;
- particles, bloom, trails, distortion;
- background atmosphere;
- camera auto/manual;
- camera intensity and rotation cap;
- UI auto-hide.

### 23.3 Data

- selected ref/tip;
- include surviving non-default refs;
- enrichment depth;
- author vs committer time preference, with causal correction retained;
- bot grouping;
- contributor identity merge/split controls;
- loaded-history coverage and continue-loading action;
- cache management.

### 23.4 Audio

- master mute;
- effects level;
- ambient/music level;
- dynamic range: quiet / standard / dramatic;
- contributor motifs;
- haptic feedback where supported and explicitly enabled.

### 23.5 Accessibility

- reduced motion;
- no flashes;
- high contrast;
- color-vision palettes;
- contributor glyphs/textures;
- large labels and controls;
- captions/event narration;
- keyboard step granularity;
- screen-reader landmark verbosity.

### 23.6 Advanced/director controls

- deterministic seed;
- choreography preset and version;
- primary-spine policy;
- intensity weights;
- smoothing windows;
- aggregation threshold;
- effect budget;
- camera look-ahead;
- debug overlays for edges, lanes, bounds, and provenance.

Presets serialize to share/export metadata. Settings that change structural compilation are distinguished from inexpensive playback/display settings.

---

## 24. Accessibility

### 24.1 Keyboard

All product functions are keyboard accessible:

- Enter submits URL;
- Space plays/pauses outside text fields;
- Left/Right seek by configured unit;
- Shift+Left/Right jump landmarks;
- Up/Down move through active threads or timeline layers;
- `M` toggles mute;
- `C` toggles auto camera;
- `R` toggles reduced motion or opens motion settings;
- Escape closes panels/selection;
- visible focus indicators never disappear with UI auto-hide.

Shortcuts are documented and remappable where feasible.

### 24.2 Screen readers and non-canvas equivalence

The canvas has an accessible summary rather than thousands of inaccessible pseudo-elements. A synchronized semantic event list exposes:

- current date/era;
- event type;
- commit/merge identity;
- active thread count;
- contributor names;
- selected topology relations;
- activity level;
- data completeness.

Users can navigate landmarks and open the same inspector information available visually.

### 24.3 Color and contrast

- structural meaning uses weight, continuity, luminance, and pattern in addition to hue;
- contributor focus can use glyph/texture;
- palettes are tested for common color-vision deficiencies;
- UI text and controls meet WCAG contrast expectations;
- dark and light high-contrast themes are available.

### 24.4 Motion, flashes, and sound

- respect `prefers-reduced-motion` on first visit;
- avoid essential information in camera motion;
- disable rapid flashes by default or keep them under recognized safety thresholds;
- provide no-flash and static-camera modes;
- show captions for significant audio cues;
- preserve the experience while muted.

### 24.5 Touch and motor accessibility

- generous hit targets;
- no hover-only functions;
- timeline fine adjustment controls;
- no drag-only operation;
- adjustable gesture sensitivity;
- prevent accidental seeking during scroll.

---

## 25. Security, privacy, and trust

### 25.1 Treat repository data as hostile

Commit messages, names, branch/tag names, repository descriptions, URLs, and imported artifacts are untrusted input.

- render text as text, never unsanitized HTML;
- validate every API/artifact boundary;
- cap string lengths and collection sizes;
- reject prototype-polluting keys and malformed schemas;
- restrict navigation links to validated GitHub HTTPS URLs;
- prevent shader/source generation from untrusted text;
- bound decompression to resist zip bombs;
- run heavy parsing in Workers but do not treat Workers as a security boundary.

### 25.2 Content Security Policy

Use a strict CSP compatible with:

- the static site origin;
- `api.github.com` for data;
- explicitly permitted GitHub avatar hosts only if avatars are enabled;
- no arbitrary third-party scripts;
- no `unsafe-eval`;
- hashed/nonced inline content only when unavoidable.

Prefer self-hosted fonts and assets.

### 25.3 Privacy

- no GitDance server receives repository URLs or histories;
- no accounts or cross-device profiles;
- no analytics by default, or only transparent privacy-preserving static-host-compatible analytics if the community explicitly adopts them;
- local cache is inspectable and erasable;
- email addresses are not rendered or exported raw;
- contributor avatars are optional because fetching them creates additional remote requests;
- share links contain repository/settings, not secrets or full histories;
- optional tokens never persist by default.

### 25.4 Supply chain

- lock dependencies;
- enable automated vulnerability and license review;
- minimize runtime dependencies;
- require review for workflow permission changes;
- pin critical Actions by immutable commit SHA where practical;
- generate an SBOM for releases;
- publish a security policy and supported versions.

---

## 26. Export, import, and sharing

### 26.1 Shareable links

A lightweight link can encode:

```text
repo=owner/name
tip=<sha>
time=<historical or performance position>
preset=<id@version>
seed=<seed>
focus=<thread/contributor/commit>
settings=<compact non-secret subset>
```

Opening the link re-fetches or uses locally cached public data and recompiles deterministically. Pinning the tip SHA prevents a moving default branch from changing the shared performance.

### 26.2 `.gitdance` artifact

Allow local download/import of a versioned artifact containing normalized data, coverage, optional compiled performance, and content hashes. Benefits:

- offline playback;
- reproducible talks and exhibits;
- exact giant-repository demos;
- local CLI interoperability in the future;
- archival and test fixtures;
- sharing without refetching, subject to file size.

Artifacts contain data, never executable code or credentials.

### 26.3 Still exports

- PNG at current viewport or poster resolution;
- SVG topology poster for supported LOD/effect subsets;
- transparent-background graph layer;
- timeline image;
- contributor legend;
- metadata sidecar with repository, tip, date, engine version, and license notice.

### 26.4 Motion exports

- real-time WebM capture through `MediaRecorder` where supported;
- deterministic offline frame rendering for high quality;
- GIF for short/small loops with clear quality warning;
- WebCodecs/WASM-assisted formats as optional capabilities;
- audio-inclusive and silent versions;
- vertical, square, landscape, ultrawide, and presentation presets;
- automatic title/end cards with repository link and data coverage.

### 26.5 Embeds

Provide a static embed URL or generated snippet with:

- pinned repository tip;
- autoplay only when browser policy allows, muted by default;
- loop range;
- reduced UI;
- responsive aspect ratio;
- click-through attribution;
- graceful static poster fallback.

No embed depends on a GitDance backend.

### 26.6 Narrative exports

- chapter list of detected eras;
- Markdown event summary;
- accessible text transcript;
- JSON event/tempo/camera plan;
- timeline CSV;
- “year in review” or “release journey” templates.

---

## 27. Curated demos

Curated demonstrations prove that the same engine handles radically different histories. Precomputed artifacts may be generated by GitHub Actions or checked in as compressed, versioned LOD datasets.

### 27.1 Real repositories

Candidate demos, subject to size, API availability, and project licenses:

| Repository type | Candidate | What it should demonstrate |
|---|---|---|
| Iconic enormous history | Linux | Extreme scale, aggregation, merge-heavy eras |
| Long-lived language/runtime | CPython | Decades, releases, evolving contributor population |
| Frontend library | React | Recognizable formation and growth |
| Cloud-native project | Kubernetes | High concurrency and contributor scale |
| Developer tool | Git | Self-referential history and mature maintenance |
| Language/toolchain | Rust or TypeScript | Release cadence and sustained parallel work |
| Framework | Django or Vue | Medium/large history with clear eras |
| Small focused tool | ripgrep or another compact project | Readable complete history |
| Tiny personal project | purpose-built demo | Linear history that is still beautiful |
| Dormant/revived project | selected with consent/context | Dormancy and renewed activity |

Do not hardcode special choreography for a famous repository. Curated metadata may choose a camera preset or chapter boundaries, but the graph engine must remain general.

### 27.2 Synthetic topology suite

Publish tiny generated repositories/artifacts for:

- one root and linear commits;
- simple branch and merge;
- two simultaneous feature threads;
- long-lived unmerged branch;
- octopus merge;
- criss-cross merge;
- multiple roots/unrelated histories;
- tag on side thread;
- clock skew;
- deleted historic branch name;
- squash-like linear history;
- 100 contributors at one timestamp;
- bot-dominated activity;
- huge linear run;
- merge storm;
- partial/unloaded boundaries;
- malicious strings and oversized metadata.

These fixtures double as documentation and regression tests.

---

## 28. Testing and quality strategy

### 28.1 Unit tests

- URL parsing and normalization;
- API pagination and rate-limit parsing;
- schema validation and sanitization;
- commit deduplication;
- parent/child index construction;
- root and boundary detection;
- default-spine selection;
- thread assignment;
- concurrency metrics;
- timestamp correction;
- contributor normalization;
- intensity normalization/smoothing;
- aggregate boundary preservation;
- event generation;
- time mapping;
- beat quantization;
- effect-budget allocation;
- camera bounds;
- canonical hashing and migrations.

### 28.2 Graph invariants and property tests

For generated DAGs:

- every exact edge corresponds to an input parent relation;
- no compiled event references a missing subject;
- topological order never violates known ancestry;
- performance time is monotonic;
- primary-spine commits form a valid chain;
- aggregation preserves all external boundary edges;
- expanding an aggregate recovers its known members;
- identical input/seed/version yields identical serialized output;
- arbitrary missing metadata does not crash compilation;
- octopus merges retain all parents;
- unknown spans never become exact edges.

### 28.3 Golden fixtures

Each synthetic and selected real-history fixture has golden outputs for:

- canonical model hash;
- thread/lane assignment;
- activity curve;
- event list;
- camera keyframes;
- low-resolution geometry;
- accessible narrative transcript.

Changes require intentional review and version notes.

### 28.4 Visual regression

Capture deterministic frames at:

- repo birth;
- first divergence;
- maximum concurrency;
- major merge approach and impact;
- unknown/aggregate span;
- final tableau;
- reduced-motion mode;
- high-contrast/color-vision themes;
- Canvas fallback;
- mobile and ultrawide layouts.

Use perceptual thresholds while separately asserting exact structural geometry.

### 28.5 End-to-end tests

Mock GitHub responses for:

- happy path;
- paginated history;
- cancellation and new URL;
- conditional cache hit;
- rate limit before completion;
- API error and recovery;
- repository update during fetch;
- empty/private/not-found states;
- optional token lifecycle;
- import/export and hash validation;
- share-link restoration;
- keyboard-only playback and inspection;
- fallback renderer.

Live GitHub smoke tests should be few, read-only, rate-aware, and not the main correctness suite.

### 28.6 Performance tests

Benchmark fixed fixtures at increasing graph sizes and complexity. Record:

- ingestion normalization throughput;
- layout time;
- compile time;
- peak memory;
- buffer size;
- frame-time percentiles;
- seek latency;
- export speed;
- cache size and load time.

Include low-end simulated CPU/GPU settings and mobile thermal testing.

### 28.7 Accessibility and safety tests

- automated accessibility scans;
- manual keyboard audit;
- screen-reader pass on landing, player, timeline, inspector, and errors;
- contrast and color-vision simulation;
- reduced-motion/no-flash verification;
- audio mute/caption equivalence;
- hostile metadata fuzzing;
- CSP and token-leak checks.

### 28.8 User comprehension tests

Show unfamiliar histories and ask viewers to identify:

- the main line;
- number of concurrent efforts;
- divergence and merge points;
- busiest era;
- contributor focus;
- whether a span is exact or aggregated.

If the performance looks impressive but users cannot answer these questions, the design has failed its central promise.

---

## 29. Open-source repository structure

Recommended monorepo:

```text
gitdance/
├─ apps/
│  ├─ web/                       # GitHub Pages application
│  └─ storybook/                 # isolated UI/visual grammar lab
├─ packages/
│  ├─ model/                     # canonical types, schema, migrations
│  ├─ github-adapter/            # public GitHub ingestion
│  ├─ dag/                       # graph indexes and algorithms
│  ├─ analysis/                  # concurrency, intensity, eras, salience
│  ├─ layout/                    # lanes, routing, LOD pyramid
│  ├─ choreography/              # clocks, beat map, event compiler
│  ├─ camera/                    # shot planning
│  ├─ audio/                     # procedural sound cues
│  ├─ renderer-webgl/            # primary renderer
│  ├─ renderer-canvas/           # fallback/deterministic subset
│  ├─ player/                    # playback, seek, selection
│  ├─ export/                    # image/video/artifact export
│  ├─ themes/                    # original visual/audio presets
│  └─ test-fixtures/             # synthetic and captured API fixtures
├─ demos/
│  ├─ manifests/                 # curated demo metadata
│  └─ generated/                 # compressed artifacts or build outputs
├─ docs/
│  ├─ architecture/
│  ├─ data-format/
│  ├─ choreography/
│  ├─ accessibility/
│  ├─ security/
│  └─ adr/                       # architecture decision records
├─ scripts/                      # fixture/demo generation and validation
├─ .github/
│  ├─ workflows/
│  ├─ ISSUE_TEMPLATE/
│  ├─ PULL_REQUEST_TEMPLATE.md
│  ├─ CODEOWNERS
│  └─ dependabot.yml
├─ CONTRIBUTING.md
├─ CODE_OF_CONDUCT.md
├─ SECURITY.md
├─ GOVERNANCE.md
├─ LICENSE
└─ README.md
```

### 29.1 Package boundaries

- Core model, graph, analysis, layout, and choreography packages are DOM-free and testable in Node and Workers.
- Rendering consumes immutable compiled buffers; it does not decide Git semantics.
- The GitHub adapter does not leak provider-specific records into core packages.
- UI does not contain graph algorithms.
- Audio and camera consume the same event plan as visuals.
- Export reuses the player timeline rather than maintaining a second animation implementation.

### 29.2 License and governance

A permissive license such as MIT or Apache-2.0 maximizes reuse; choose one explicitly before accepting substantial contributions. Original visual/audio assets need compatible licensing and attribution rules. Include:

- contributor guide with architecture map;
- code of conduct;
- security disclosure policy;
- issue templates for topology bugs, performance, accessibility, and visual proposals;
- architecture decision records for truth-affecting changes;
- semantic versioning for packages and artifact schema;
- governance path from maintainer-led to multi-maintainer stewardship;
- generated-data licensing review for curated demos.

### 29.3 Extension points

- provider adapters;
- analyzers and feature signals;
- layout strategies;
- event grammar plugins;
- original themes;
- camera directors;
- audio engines;
- renderer backends;
- export codecs;
- caption/story generators.

Extensions must declare whether they affect factual interpretation, deterministic compilation, or only presentation.

---

## 30. Roadmap

### Phase 0 — Truth prototype

Purpose: prove that the DAG can become a readable moving performance.

- load a bundled synthetic artifact;
- render linear commits, one divergence, parallel advancement, and one merge;
- primary-spine contrast;
- fixed camera and simple activity timeline;
- deterministic event stepping;
- no network required;
- golden topology tests.

**Exit:** A viewer can correctly identify the primary path, the two concurrent paths, and the merge while the sequence feels rhythmic.

The exit demonstration must show bodies or pulses traveling through the graph, simultaneous motion on parallel threads, a staged merge approach and impact, and active camera direction. A path-only reveal does not pass Phase 0.

### Phase 1 — Public URL vertical slice

- minimalist landing page;
- public GitHub URL normalization;
- direct repository metadata and paginated commit ingestion;
- exact DAG construction for a small repository;
- default first-parent spine;
- thread assignment;
- Web Worker pipeline;
- basic WebGL/Canvas renderer;
- play/pause/seek;
- bottom waveform;
- GitHub Pages deployment.

**Exit:** Paste a small public repository and watch a complete, truthful performance with no backend.

### Phase 2 — Parallelism and contributor language

- simultaneous thread scheduling;
- contributor identity normalization;
- traveling contributor pulses;
- divergence/merge approach and impact grammar;
- main-thread focus migration;
- current refs and tags;
- inspector and provenance labels;
- complex synthetic DAG suite.

**Exit:** Branch-heavy histories communicate real parallel work and remain followable.

### Phase 3 — Rhythm engine and camera director

- repository-relative intensity model;
- historical/performance clock mapping;
- generated beat map;
- smoothing, phrases, and era detection;
- procedural Web Audio score;
- camera shot planning and look-ahead;
- effect budget and merge storms;
- cinematic/explore modes.

**Exit:** Quiet, active, and chaotic repositories feel different for data-driven reasons, with repeatable direction.

### Phase 4 — Scale and resilience

- request budgeting and conditional caching;
- current non-default ref ingestion;
- LOD pyramid and exact aggregation;
- progressive refinement and unknown spans;
- GPU tiling/culling and adaptive quality;
- partial/rate-limited experience;
- Canvas/static fallbacks;
- performance corpus through giant synthetic histories.

**Exit:** Large histories produce honest, useful performances without freezing the browser or inventing topology.

### Phase 5 — Sharing, export, and accessibility completion

- pinned-tip share links;
- `.gitdance` import/export;
- PNG/SVG poster export;
- WebM and deterministic frame export;
- embed/gallery modes;
- full keyboard and semantic event navigation;
- reduced-motion/no-flash/high-contrast modes;
- captions and narrative transcript.

**Exit:** A performance can be reproduced, shared, presented, and understood across input and motion needs.

### Phase 6 — Curated public launch

- polished original brand and landing page;
- React, Git, Kubernetes, CPython, tiny, and pathological demos as feasible;
- documentation site;
- contributor onboarding;
- security and privacy review;
- browser/device compatibility pass;
- project launch video generated by GitDance itself.

**Exit:** The site communicates the concept in seconds and the repository is ready for outside contribution.

### Version 1.0 definition

Version 1.0 is reached when:

- the static Pages site reliably handles public GitHub URLs;
- default playback is a continuous choreographed animation with moving performers, parallel motion, staged divergences and merges, contributor flow, and camera direction—not a progressive line drawing;
- exact vs partial/aggregate history is always clear;
- supported known DAG topology is rendered correctly, including octopus merges and multiple roots;
- main, parallel work, divergence, merge, and contributors remain understandable;
- deterministic sharing and artifact export work;
- large-repository degradation is graceful;
- core accessibility modes are complete;
- testing covers algorithmic, visual, performance, and security invariants;
- documentation enables a new contributor to add a fixture, event, or theme without reverse-engineering the codebase.

---

## 31. Future stretch vision

These ideas extend the system without changing its core truth principles.

### 31.1 Universal local Git analyzer

A companion CLI or desktop utility could analyze any repository the user's installed Git can read:

```text
npx gitdance .
npx gitdance https://gitlab.com/org/repo.git
npx gitdance git@example.com:team/repo.git
```

It would produce a `.gitdance` artifact and open the same player. This enables private repos, non-GitHub providers, exact giant histories, file-change analysis, and fully local use without adding a hosted backend.

### 31.2 Pull-request and release enrichment

Optional provider adapters can add:

- pull-request titles and retained head-ref names;
- review and discussion landmarks;
- release notes;
- issue references;
- CI status rhythms;
- contributor teams.

Enrichment must be visually separate from facts contained in Git and degrade cleanly when absent.

### 31.3 File-system morphology layer

Overlay or alternate mode where:

- folders form regions;
- files appear as cells/crystals;
- edits pulse;
- deletions leave scars;
- churn creates turbulence;
- dependencies form tendrils;
- the commit DAG remains the temporal/choreographic backbone.

This realizes the “repository as living organism” direction without replacing topology.

### 31.4 Blame and ownership evolution

For locally analyzed or precomputed artifacts, show how contributor influence moves through files over time, distinguishing authorship, maintenance, and churn without reducing ownership to a simplistic permanent color.

### 31.5 Live mode

Poll a public repository at respectful intervals and append new commits to the current tableau. A release-event display could wait for new work and perform it as it arrives. This remains browser-local and is opt-in.

### 31.6 Collaborative performances

- synchronized watch links without a central server via WebRTC signaling alternatives or manual session codes;
- presenter-follow mode;
- annotated chapter files;
- audience-controlled contributor focus;
- installations spanning several displays.

Any required coordination service would be an optional separate project, not a silent violation of the static core.

### 31.7 Theme studio

A safe, declarative editor for creating:

- palettes;
- path styles;
- node glyphs;
- effect envelopes;
- camera personality;
- procedural instruments;
- caption typography.

Themes cannot alter DAG facts. Shareable theme files are schema-validated and contain no executable JavaScript.

### 31.8 Choreography laboratory

An advanced developer view displaying:

- raw and smoothed intensity signals;
- beat quantization;
- event bids/effect budget;
- camera bounds and look-ahead;
- lane cost function;
- exact/aggregate provenance;
- deterministic seed comparisons.

This makes the system teachable and invites creative-coding contributions.

### 31.9 AI-assisted narration — optional and separable

An optional local or user-configured system could draft era descriptions from selected public metadata, but generated interpretation must be labeled, must not affect topology, and cannot be required for the base static experience. A deterministic factual template system should exist first.

### 31.10 Physical and artistic outputs

- generative posters of full repository topology;
- plotter/SVG editions;
- album-like release-history covers;
- ambient screensavers;
- MIDI/OSC output for live performance;
- projection-mapped installations;
- sonification-only accessibility/art mode;
- repository “fingerprints” derived from the activity and topology signature.

### 31.11 Comparative research

- compare fork evolution;
- visualize upstream/downstream convergence;
- contrast release eras;
- cluster repositories by topology/activity signature;
- export anonymized derived metrics locally for academic study;
- explore how workflow styles appear without making productivity judgments.

### 31.12 Education mode

Pause the performance at carefully chosen synthetic events and explain:

- parent links;
- first-parent history;
- divergence;
- fast-forward vs merge commits;
- octopus merges;
- rebase/squash information loss;
- why branch names may disappear.

---

## 32. Product and engineering risks

### 32.1 Spectacle overwhelms meaning

**Risk:** The project becomes an attractive particle system that viewers cannot interpret.  
**Response:** topology invariants, main-spine hierarchy, effect budgets, comprehension tests, Explore mode, and provenance styling.

### 32.2 Browser/API limits prevent “full history”

**Risk:** Large arbitrary repositories cannot be completely ingested anonymously.  
**Response:** progressive coverage, honest unknown spans, request budgeting, local cache, optional local token, precomputed demos, `.gitdance` import, and future local analyzer. Never overclaim completeness.

### 32.3 Layout instability

**Risk:** Small data changes radically rearrange the whole graph.  
**Response:** deterministic tie-breakers, pinned primary spine, stable lane inheritance, versioned layout, anchored refinement, and no live geometry mutation during playback.

### 32.4 Dense histories become unreadable

**Risk:** Too many exact nodes and effects destroy the performance.  
**Response:** semantic LOD, aggregates, focus, culling, camera overview, label/effect budgets, and protected topology landmarks.

### 32.5 Rhythmic quantization misrepresents history

**Risk:** Artistic timing looks like factual chronology.  
**Response:** two explicit clocks, monotonic mapping, exact dates in inspection, bounded quantization, and chronological Explore mode.

### 32.6 Contributor identity errors

**Risk:** Aliases split one person or merge different people.  
**Response:** provenance, conservative normalization, local alias controls, GitHub numeric IDs when available, and no raw-email exposure.

### 32.7 Accessibility afterthought

**Risk:** Motion-heavy canvas UI excludes users.  
**Response:** semantic event stream, reduced-motion/no-flash from the first architecture, keyboard controls, non-color encodings, and fallback presentation.

### 32.8 Export complexity

**Risk:** Browser codecs and cross-origin assets make deterministic video fragile.  
**Response:** self-host assets, avoid tainted canvas, start with PNG/WebM, provide frame sequences and metadata, and version export capabilities.

### 32.9 Copyright/trademark confusion

**Risk:** Inspiration reads as imitation of a rhythm game.  
**Response:** original brand, art, score, terminology, interaction, and choreography; cite inspiration only as conceptual context.

### 32.10 Open-source extensibility compromises truth

**Risk:** Plugins invent facts or create incompatible artifacts.  
**Response:** typed extension boundaries, capability declarations, schema validation, provenance requirements, and core invariants that presentation extensions cannot bypass.

---

## 33. Success criteria

### 33.1 Product success

- A first-time visitor understands the input and result without instructions.
- A small public repository reaches a playable state in a reasonable period under normal API conditions.
- Most viewers can identify the primary path, a split, parallel work, and a merge after one viewing.
- Users intentionally seek to peaks and inspect landmarks.
- Maintainers recognize their project's development eras.
- Shared links reproduce a stable performance when pinned to the same tip and engine version.
- Exported clips remain legible without the interactive inspector.

### 33.2 Technical success

- No runtime GitDance backend exists.
- Exact edges are never fabricated.
- Partial coverage is always detectable in model and UI.
- Determinism tests pass across supported environments within documented rendering tolerances.
- Worker and rendering architecture keeps the UI responsive on supported device tiers.
- Large datasets degrade through LOD, not crashes.
- All core flows work with keyboard, reduced motion, and mute.
- Imported artifacts and repository text cannot execute code.

### 33.3 Open-source success

- A contributor can understand the pipeline from API record to rendered frame.
- Synthetic topology fixtures make graph bugs reproducible.
- New themes do not need to modify Git semantics.
- Truth-affecting changes have tests and architecture records.
- Curated demos are reproducible from manifests.
- Releases include schema/version notes and migration guidance.

### 33.4 Suggested qualitative research questions

- “Where was the main line during the busiest moment?”
- “How many efforts were moving independently?”
- “Did this branch merge, stop, or remain current?”
- “Was that large effect caused by volume, topology, or a release?”
- “Which spans are exact, aggregated, or unknown?”
- “Did the camera help you understand the event or merely make it dramatic?”
- “Could you follow the performance with motion reduced and sound muted?”

---

## 34. Definition of the ideal finished experience

A visitor pastes `https://github.com/owner/repository` and presses **Play**.

The page confirms the repository, reads as much public history as current GitHub limits and local cache allow, and clearly states coverage. The stage goes dark. The first known commit appears as a seed. The default branch grows as a bright, unmistakable path. Real side histories peel away where the DAG diverges. If several incomparable lines receive commits in the same historical window, several performers move at once. Each contributor has a stable visual signature that travels through, rather than replaces, the structural paths.

The bottom waveform shows the entire development lifetime. Quiet years slide past in a breath. As the playhead approaches a peak, the rhythm gains layers, the calendar slows, and the camera pulls out to reveal more of the stage. One branch splits into three. A fourth thread wakes on the opposite side. The main path remains bright through the density. A long-running thread curves back toward it. The camera anticipates the convergence, pushes in at the final beat, and the merge lands as a controlled flash and ripple. Several smaller merges join the phrase without each demanding a separate explosion. The structure exhales and settles.

At any instant, the viewer can pause. Exact edges remain traceable. A selected merge reveals every known parent path. A contributor can be followed through the era. A date, message, SHA, and provenance are available without turning the stage into a dashboard. An aggregated ribbon says exactly how many known commits it contains. An unavailable interval admits that it is unavailable.

The same repository, tip, engine version, preset, and seed replay the same choreography. The user can share a pinned link, export a video or poster, or download a `.gitdance` artifact for offline use. A reduced-motion viewer sees the same history through steady framing, emphasis, and a navigable textual event stream. A giant repository becomes a hierarchy of meaningful shapes rather than a frozen browser or a dishonest tangle.

The result is simultaneously:

- a faithful visualization of known Git ancestry;
- a legible account of parallel human work;
- a procedural rhythm map;
- a piece of generative art;
- a shareable history of an open-source project;
- and an open engine others can study, test, and extend.

That is GitDance: **the repository is the score, the DAG is the stage, contributors are the motion, and history performs itself.**

---

## Appendix A — Initial public API plan

This appendix is intentionally implementation-oriented and should be revalidated against current GitHub documentation during development.

1. Parse and normalize `owner/repo`.
2. `GET /repos/{owner}/{repo}` for identity, visibility, default branch, and metadata.
3. Fetch the default branch commit page with `per_page=100`.
4. Read rate-limit and pagination response headers.
5. Follow commit pagination under a dynamic request budget.
6. Build exact nodes/parent edges for returned commits; mark missing parents as boundaries.
7. Fetch current branches, prioritize tips not present in the known graph, and expand selectively.
8. Fetch tags/releases under a separate landmark budget.
9. Fetch full details only for selected/salient commits where change statistics justify the cost.
10. Cache normalized pages and `ETag` values.
11. Anchor the run to a selected tip SHA.
12. Compile and label coverage before playback.

Core references:

- [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Using pagination in the REST API](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)
- [REST API endpoints for commits](https://docs.github.com/en/rest/commits/commits)
- [GitHub Pages documentation](https://docs.github.com/en/pages)
- [Configuring a GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

---

## Appendix B — First proof corpus

Before live ingestion, create these deterministic fixtures:

```text
01-linear
02-simple-split-merge
03-two-parallel-threads
04-nested-divergence
05-long-running-side-thread
06-unmerged-current-ref
07-octopus-merge
08-criss-cross
09-multiple-roots
10-clock-skew
11-dense-linear-burst
12-merge-storm
13-contributor-handoff
14-bots-and-coauthors
15-partial-boundaries
16-known-aggregate
17-unknown-span
18-hostile-metadata
19-million-node-synthetic-lod
20-empty-repository
```

Every fixture includes the raw normalized model, expected primary spine, expected exact edges, expected coverage classes, expected event summary, and selected golden frames.

---

## Appendix C — Decision checklist

Before merging a feature, ask:

- Does it preserve every known parent relationship?
- Does it distinguish exact, derived, aggregate, estimated, and unknown data?
- Does it keep the primary spine findable?
- Does it represent actual parallel work rather than serialize it?
- Does it remain deterministic?
- Can it seek without replaying irreversible state?
- Does it have a reduced-motion and muted equivalent?
- Does it fit within the effect and label budgets?
- Does it work with partial history?
- Does it keep the runtime architecture backend-free?
- Is untrusted repository text safely handled?
- Is it testable with a small synthetic fixture?
- Does it make the performance clearer, more truthful, or more emotionally effective?
- Does it create meaningful movement beyond paths and nodes appearing?

If the answer to the last question is no, the feature probably does not belong in the core.
