# GitTimeline: fast static playback and a new viewing experience

Status: implementation plan, 2026-09-05. No runtime changes have been made for this plan.

## Outcome and architectural constraints

A visitor clicks Linux, sees useful motion quickly, and can watch or seek through
its history without downloading or retaining the entire performance first. The
selection, player, and demo should make that experience immediately understandable.

The architecture remains a static GitHub Pages application:

- Keep Vite, TypeScript, Preact, signals, and the existing single-package boundaries.
- GitHub Actions obtains curated histories with commit-only clones and runs the
  existing normalizer and deterministic compiler. No duplicate graph implementation.
- Pages serves build outputs. No repository proxy, runtime database, streaming
  server, or visitor-triggered hosted compilation is introduced.
- The optional OAuth Worker is outside the curated playback dependency chain.
  Browsing the shelf and watching any shipped history requires neither sign-in nor
  a token. Analytics remains optional and respects the existing allowlist.
- Live GitHub ingestion, local artifact imports, and synthetic fixtures remain
  supported through the current worker compiler, with honest coverage and limits.
- The renderer consumes immutable derived data and never interprets Git ancestry.
  Canvas2D remains the first renderer. Preserve SVG and semantic text access.
- Preserve deterministic topology, identities, layout, time mapping, and event
  timing. Nothing appears before its recorded presentation time. Buffer residency
  must not become a new interpretation of what Git proves.

This plan extends [Architecture](architecture.md), [Data truth](data-truth.md),
[ADR 0001](adr/0001-canvas2d-renderer.md), and
[ADR 0002](adr/0002-single-package-module-boundaries.md). It implements the current
direction in [TASKS.md](../TASKS.md); unimplemented suggestions remain proposals.

## Evidence and gaps

The local `public/catalog/index.json` records the following. Opening times are
previous local measurements, not network promises or newly reproduced benchmarks.
MB here means decimal megabytes.

| History | Source commits | Visible nodes | Plan MB | Local open seconds | Full duration |
| --- | ---: | ---: | ---: | ---: | --- |
| Linux | 1,481,850 | 332,279 | 152.7 | 14.2 | 12 h |
| Rust | 339,084 | 248,298 | 75.4 | 9.2 | 8 h 58 min |
| Kubernetes | 140,858 | 125,973 | 35.4 | 4.7 | 4 h 33 min |
| Chromium | 1,817,062 | 923 | 47.2 | 0.9 | 2 min 45 s |
| React | 21,678 | 4,204 | 1.9 | 0.4 | 9 min 11 s |

At 10 Mbps, Linux's present plan takes about 122 seconds just to transfer. Selecting
a year changes the playback interval but still downloads the same plan. Chromium
shows a different problem: very few visible nodes can still carry a large artifact.
Measure metadata, aggregate membership, and geometry separately before choosing
where to spend compression work.

The reader streams bytes but accumulates the full plan before returning it.
`CanvasRenderer.setPerformance` then scans geometry and constructs global indexes.
`Player`, the ledger, inspector, timeline, audio selection, and exports all assume
a complete `CompiledPerformance`. Download chunking alone does not remove these costs.

The landing already uses `buildLandingDataset` and seeks into a busy section at
0.22x speed. `buildDemoDataset` is a separate short fixture. The landing, the explicit
demo URL, and promoting the backdrop into the player all need separate checks.

Release gaps to address alongside the format change:

- Missing catalog collection is best-effort, but pruning unconditionally reads its
  index. A clean deploy can fail at pruning instead of publishing an empty shelf.
- The latest successful dataset run need not match the application's engine.
  Large fallback datasets are pruned, so an incompatible plan can leave no usable path.
- A successful single-repository dataset run can supply a replacement catalog
  containing only that repository; collection needs an explicit full-release policy.
- `VITE_AUTH_BASE` and `VITE_GA_ID` are read by the app but are not mapped from Actions
  variables into the production build. This does not block anonymous playback.

## Decisions for the first implementation

1. Introduce bounded loading beneath the existing presentation engine. Keep
   `CompiledPerformance` as the complete compiler result and reference for correctness.
2. Compile a history globally, then package it. Do not independently compile each
   year: that would change lanes, aggregation, camera continuity, and identity.
3. Use independently compressed static files and a versioned manifest. Ordinary
   GET requests suffice; no HTTP Range support or custom server headers are required.
4. Split render necessities from inspect-on-demand data. Subjects for visible nodes
   remain immediately available. Full aggregate membership and large contributor,
   event, transcript, and commit-detail collections must not move into one giant header.
5. Preserve current continuous playback first. Add a short, explicitly edited
   director's cut using existing events once chunked seeking works.
6. Treat a whole-history overview with a new aggregation model as a separate phase.
   A highlights playlist skips intervals and must never be called a complete summary.
7. Establish the visual direction early, then finish the redesign against real
   loading and navigation states. Provisional direction: a cinematic stage, clear
   typography, curated selection up front, and controls revealed by task.

## Proposed data and runtime contracts

These are new interfaces to implement, not descriptions of interfaces that exist.
File-format structures belong in `src/export`; runtime views belong in `src/model`
and `src/player`. Exact filenames can change during implementation without moving
responsibility across those boundaries.

```text
Actions: clone -> buildDataset -> compilePerformance -> package and verify
                                                        |
Pages: catalog index -> versioned manifest -> geometry / time / detail pages
                                                        |
Browser: source -> fetch/decode worker -> bounded resident view -> Canvas2D
                   |                          |
                   +--------------------------+-> player controls and semantic UI

Live/import/demo -> existing compile worker -> in-memory source -> same consumers
```

### Manifest and immutable release identity

The root manifest identifies source revision, dataset hash, engine versions, preset,
seed, logical plan hash, package schema, build identity, overall bounds, duration,
source coverage, and global statistics. It advertises available presentations and
their resource dependencies. Keep large navigation tables in index pages.

Manifest descriptors include relative file paths, compressed and decoded sizes,
record counts, content hashes, and time/spatial ranges. Resources use content-derived
names within the catalog. The app verifies compatibility before starting large downloads.
All URLs resolve under the configured Pages base path.

Compact global data includes the catalog card, coarse activity strip, year directory,
selected chapters, and precomputed soundtrack character. Exact time/tempo/camera
samples live in indexed pages with bracketing samples at boundaries. A coarse map
may locate a page; final date-to-time mapping uses the exact page.

### Resource ownership and boundary continuity

Package according to compressed/decoded size and dependency cost, with time ranges
for discovery; do not make every calendar year one chunk. A busy year may need many
pages. Geometry resources are addressable spatially as well as through playback ranges.

Use stable global identities on disk. A resident view may use compact local array
positions with explicit mappings for every node, edge, thread, contributor,
aggregate, and event reference. Never treat a global index as a local array offset.
Selection, contributor colours, thread tints, anonymous-label policy, and density
budgets must remain stable when pages enter and leave memory.

Each time window includes dependencies whose visible lifetime overlaps it, plus
camera interpolation, trails, ripple effects, and label context on either side.
Landed edges remain visible after their travel interval; filtering only by
`edge.start/end` would delete history that is still on screen. Boundary context comes
from time AND the actual viewport, including manual camera positions.

Long-lived routes must not force loading their entire ancestry or duplicate a huge
polyline into every time page. Store shared routes or bounded geometry segments with
the original edge identity, original sample/arc-length position, endpoints, and
travel timing. Clipping and seams must preserve the original reveal and stroke.
Prototype full-route sharing first; add segmentation where measured dependencies
exceed the resident budget. This choice must pass the Linux feasibility gate before
the package schema is frozen.

Loading a later interval does not replay old event notifications or start a new
performance. Seek reconstructs visible state from the plan at absolute time. Camera
interpolation uses the same surrounding cues as continuous playback.

### Playback source, window lifecycle, and consumers

Introduce a `PerformanceSource` implemented by an in-memory adapter and a static
catalog adapter. It exposes a summary, window availability, cancellable preparation
by time/view, indexed navigation, detail lookup, and disposal. The player retains
one absolute performance clock and desired playing/paused state. It must not call
`loadPerformance` on each window arrival.

A prepared immutable `PerformanceWindow` contains the locally indexed draw/event
data and prebuilt render indexes needed for its valid time and viewport range.
`CanvasRenderer` changes windows without rebuilding indexes for the entire history.
Precompute bounds/order in the packager where possible; decode and assemble the
resident view off the main thread, transferring each shared buffer exactly once.

Use byte-based eviction, including decoded geometry, indexes, text, buffers in
transfer, current/next views, and retained selection. Prefetch only near the actual
direction and rate of travel. Cancel obsolete requests when seeking or leaving a
repository. Persistent compressed-page caching is optional and quota-bounded;
cache denial/eviction must not prevent online playback. No service worker is needed
for the first implementation.

Availability is explicit: preparing, ready, buffering, and recoverable failure.
If required data is absent, hold the last complete frame and clock, pause music,
and show buffering. Resume only if the viewer still intends to play. A failed seek
retains the old usable view; a new seek supersedes old results using the existing
run-id/AbortController pattern plus a seek generation.

Manual pan/zoom queries geometry outside the current playback window. It must not
trigger reconstruction of the whole plan. Wide views need an explicit, labelled
coarser representation, or a documented detail limit while the full overview is
deferred. Do not silently omit geometry or fake unknown ancestry to meet a budget.
The feasible wide-view policy is a required output of the prototype.

Consumer migration is part of the work, not optional cleanup:

| Consumer | New source of data |
| --- | --- |
| Player/date/transport | Global duration plus exact indexed time and tempo pages |
| Canvas and hit testing | Current immutable resident view and stable identity mapping |
| Ledger/inspector | Visible-node subjects; selected detail pages, explicitly loading |
| Timeline/chapters | Small global activity summary and paged exact landmarks |
| Contributor focus | Stable identity and paged activity/detail; no global node scan |
| Audio | Global precomputed character; readiness gates without restarting on page swaps |
| Poster/events/transcript | Scoped SVG and paged semantic events; complete text export from static files |
| Share/history | Source/revision, presentation, time, scope, and stable selection identity |

Source coverage, chosen viewing scope, and buffered intervals are separate concepts.
An evicted page is still known source history. A missing fetch is a loading/error
state; only genuinely absent ancestry gets the existing unknown-history styling.

### Settings and accessibility

Speed, viewport, sound, labels, and resolution work without recompilation. Controls
that require a different compiled preset/seed must advertise the available catalog
variants rather than quietly compiling Linux in the tab or ignoring the choice.
The live/import path can retain its current recompilation behavior.

Reduced motion must work from the first frame without fetching an entire dataset.
The prototype must determine whether renderer suppression plus separately compiled
compact camera/time/event pages can preserve the existing reduced-motion behavior
while sharing geometry. If the compiler output requires distinct geometry, package
that variant and count its storage explicitly. Do not equate slower speed with
reduced motion. Preserve no-flashes, high contrast, keyboard, focus, and silent idle.

SVG fallback renders a labelled selected interval/view, avoiding a million-node DOM.
Provide a paged complete semantic history and a separately downloadable complete
transcript; a current-window transcript must not be labelled complete. Full-plan
export becomes an explicit size-disclosed download, not accidental resident assembly.

## UI and demo direction

The first viewport exposes real ready-to-watch repositories and a clear demo action.
Keep repository input available and route known shelf slugs to their compiled assets;
pasting Linux must not accidentally start an API crawl. Preserve explicit tip/preset
requests when choosing that route; a mismatched pinned tip cannot silently open latest.

Use a coherent type/spacing/colour/motion system across the landing, selection,
player, loading states, and panels. Provisional layout: a quiet top identity/scope
bar, a large stage, one bottom playback bar, and one contextual detail surface.
On mobile, use a bottom sheet and touch-sized controls; preserve an unobstructed stage.
Keep advanced camera and appearance controls accessible without making every control
permanently visible. Mark selection on both stage and ledger; provide a compact
contextual explanation of the mark selected.

The initial Watch action starts the existing full performance as soon as its opening
window is ready. Once available, a separately named Highlights action plays a roughly
60-second director's cut; retain Full history and a date-range action. Select excerpts
deterministically from real events, include their approach/release context, avoid
overlap, keep chronological order, and show visible date changes at cuts. Chapters
reflect tags/merges/eras, not invented explanations of team behavior. A future
complete overview must declare its aggregation rules separately.

Back/Forward restores a performance descriptor. Share links include package identity
and stable commit identity where applicable; never reuse a time from an old plan as
though it denotes the same moment in a new plan. Retention is bounded by Pages storage:
if a referenced release is no longer served, explain that and offer the current
history explicitly. Do not promise permanent replay or send the link through live
GitHub ingestion automatically. Position updates replace state rather than pushing
a browser entry every frame. Local imports remain device-local and are not promised
as externally shareable histories.

Rework the demonstration as one coherent product experience with two uses: a silent
backdrop and an explicit watchable demo. Keep seeded generation and the old regression
fixture available under its fixture identity. Establish motion within a second,
several readable threads within three seconds, and an early visible merge. Aim for
a compact 20-30 second featured sequence at a pace representative of the shelf;
do not force an eightfold speedup on the old sparse script. Retain the long deterministic
continuation or seamless seeded continuation so the backdrop does not visibly snap
back every 30 seconds. Never imply that the generated history is a real repository.

## Measurement contract

The following are proposed acceptance budgets, not achieved results. Record exact
hardware, browser, viewport, DPR, GPU backend, cache state, network shaping, and
sample count. Establish feasibility in milestone 0; change a budget only with a
recorded measurement and an explained tradeoff.

| Measure | Initial target and procedure |
| --- | --- |
| First useful frame | At most 5 s from click, cold 10 Mbps / 100 ms RTT, 1280x800, declared integrated-GPU reference laptop |
| Initial transfer | At most 3 MiB of required history assets before the first frame; account for competing app/audio downloads |
| Root metadata | At most 256 KiB compressed per history; large indexes paged |
| Resident detail | At most 256 MiB of accounted decoded data/indexes including overlapping windows; separately measure process/JS peak |
| Steady frames | 60 fps target; p95 frame interval at most 20 ms on the reference GPU, with dropped-frame distribution reported |
| Software rasterization | 30 fps target with a disclosed resolution setting; do not claim the same quality or hardware result |
| Seeking | Ready within 3 s on the defined network for sampled cold seeks; under 250 ms for resident seeks |
| Boundary transitions | No duplicate/missing arrival, camera jump, music restart, or synchronous main-thread task over 50 ms attributable to page swap |
| Long sessions | After warmup, resident bytes remain capped and repeated seeking shows no accumulating retained plans |
| Demo | First motion within 1 s of ready page; meaningful parallel motion within 3 s; no idle sound |
| Static release | Under 1,000,000,000 bytes; warn at 900,000,000, including variants, detail pages, audio, and retained versions |

First-frame means the requested repository and interval are actually drawable,
not a spinner or an unrelated demo. Headless software rendering is useful for
functional checks, not evidence for real-GPU frame pacing. Report cold-load samples
individually when too few exist for meaningful percentiles. Record UI latency and
decode time independently from network transfer.

## Ordered implementation milestones

### 0. Baseline, bounded prototype, and early design preview

- Add separate measurements for transfer, decode, geometry regeneration, render-index
  construction, first frame, decoded ownership, and steady frame pacing.
- Profile Linux, Rust, Chromium, and React. Include late Linux intervals, long branches,
  dense merges, portrait view, and software rendering. Diagnose Chromium's metadata cost.
- Prototype packaging existing plans into bounded resources without changing compiler
  semantics. Compare uninterrupted and direct-seek views at resource boundaries.
- Resolve long-route dependencies, manual wide views, reduced-motion variants, global
  metadata sizes, and simultaneous old/new-view memory before freezing the schema.
- Produce a representative landing/player preview using the existing app and real
  catalog content. Review appearance while the data work is still easy to adjust.

Exit: a recorded feasibility report, explicit resource ownership and wide-view policy,
and a concrete visual direction. If budgets fail, revise the representation with
evidence before converting the whole shelf. No full catalog rebuild is needed here.

### 1. Package schema and correctness proof

- Add the versioned manifest/page codec and deterministic packager in `src/export`.
- Add runtime summary/window types without weakening `CompiledPerformance`.
- Reuse existing reversible geometry codecs where appropriate; include byte limits,
  relative-path checks, integrity validation, and referential validation.
- Round-trip the fixture corpus and a small real plan; verify the recombined logical
  plan against the reference. Compare exact visible state at boundary-adjacent times.
- Keep old `.gtperf.gz` reading and live/import behavior during migration.

Exit: stable schema, content hashes, stable identities, and tests for cross-boundary
merges, long routes, unknown parents, aggregates, and cancelled/corrupt pages.

### 2. Playback source and first Linux path

- Add the in-memory and static `PerformanceSource` adapters, decode worker, and bounded
  cache. Move window preparation out of `controller.ts`; keep orchestration there.
- Adapt `Player`, render indexes, `store`, and the frame loop to availability-aware
  windows without resetting time, camera, score, or selection at each swap.
- Migrate every consumer listed above; no component may secretly fetch or reconstruct
  the whole plan to keep an old array-based implementation alive.
- Support cancellable direct date seeking and loading dependencies for manual views.
- Introduce catalog-aware paste/share routing without changing pinned-tip meaning.

Exit: Linux opens, plays across boundaries, and seeks into a late year within the
agreed budgets, with zero GitHub API calls and bounded residency. React/live/import/demo
still work through the in-memory adapter. Missing pages remain retryable.

### 3. Camera and frame-cost improvements

- Fix newest-arrival framing after smoothing and final aspect-ratio fitting, preserving
  frame caps and future-visibility rules. Test simultaneous arrivals and portrait views.
- Blur/composite at the appropriate smaller resolution; measure both glow passes.
- Retain spatial culling and density budgets, remove remaining repeated state/index
  work where profiling identifies it, and add a visible resolution setting.
- Test long playback and repeated jumps without screenshots contaminating GPU timings.

Exit: camera containment and frame budgets pass the declared hardware matrix.
Camera semantics require an ENGINE bump; queue this before the final shelf rebuild.
WebGL/OffscreenCanvas remain later options only if measured limits justify them.

### 4. Complete the redesigned UI, navigation, and demo

- Implement the chosen visual system across selection, player, loading, errors, and
  responsive panels; keep real catalog content on the primary path.
- Finish ledger/stage selection, date navigation, Back/Forward, moment sharing, and
  accessible settings using the source contracts rather than whole-plan arrays.
- Replace the product demo sequence while preserving the old regression fixture.
- Package and offer the director's cut, with explicit cuts and dependency-aware prefetch.
- Keep attribution findable, sound off while idle, and reduced-motion/poster/text paths
  functional. Music-library expansion is a separate TASKS.md brief.

Exit: a visitor can choose a history, understand the stage's basic vocabulary, seek,
inspect, return, and share a moment. Verify desktop/mobile and keyboard flows, plus
both demo entry paths and landing continuation.

### 5. Catalog migration and GitHub Pages release validation

- Use a single checked-in shelf specification for the dataset matrix and indexer.
- Package in the same per-repository job as compilation and upload nested resource
  directories. Exclude authoring datasets and obsolete monoliths from final delivery
  once all published consumers use the new format; preserve rebuild inputs in CI/local storage.
- Add a catalog release manifest recording supported engine/schema/preset versions
  and all required files. Select a compatible complete release, not simply the last
  successful workflow run. A single-repository rebuild must retain validated compatible
  entries or remain a non-publishable partial build.
- Make production deployment fail early if the configured shelf or any required
  variant/resource is missing. Local development retains a deliberate demo-only state.
- Resolve build variables and bootstrap sequencing. Test the final pruned build at
  the actual Pages base path after catalog collection, with GitHub API access blocked.
- Keep data refresh and app release compatible: a successful weekly build must have
  an explicit publication path; a failed refresh leaves the last good site available.
- Before promotion, complete the full catalog build and report download/storage sizes,
  boundary checks, first-frame measurements, and variant coverage.

Exit: a clean Actions run produces a complete compatible Pages artifact and hosted
smoke checks pass. Preserve the last known-good deployable site artifact for rollback;
rollback restores app and catalog together. Remote publishing still follows the user's
existing authorization and the owner tasks in TASKS.md.

## Validation and migration details

For a small deterministic fixture, test every page boundary just before, at, and
after it, in both directions. Cover seeks during fetch/decode, pause while buffering,
repository changes, looping, a failed next page, truncated bytes, incompatible
versions, missing dependency pages, and duplicate buffer transfers. Verify stable
identities, raw/presentation dates, parent relations, and aggregate counts.

For real histories, sample the same moments from monolithic and packaged sources,
including Linux late playback, Rust dense merges, Chromium large aggregates, and
React small-plan overhead. Check semantic draw commands/geometry and selected
screenshots for correctness; collect frame pacing separately without capture overhead.
Exercise cache hits, cold cache, cache eviction, and selected-node eviction.

Keep fast fixtures in normal CI. Run a bounded packaged real-history smoke against
the final Pages artifact, and full shelf/boundary sweeps with dataset releases.
Catalog tests may skip only in explicitly demo-only development builds. Release
tests must fail on absent shelf entries. Existing unit/type/lint/build checks remain.

Separate version changes: renderer/UI edits do not recompile the shelf; packaging-only
changes increment package schema and can repack a compatible existing plan; changes
to camera/time/layout/events require the appropriate ENGINE bump and recompilation.
Rebuild the full shelf after semantic compiler changes are consolidated and verified
on fixtures plus Linux. Do not run a half-hour rebuild after each CSS or decoder edit.

Update `docs/architecture.md`, `docs/data-truth.md`, `docs/accessibility.md`, README,
workflow comments, and TASKS.md when their corresponding behavior actually changes.
Archive or clearly supersede `codex-tasks.md` so it cannot act as a competing backlog.

## Scope boundary and unresolved choices

The selected design taste is provisional; no UI preference was supplied in response
to the earlier question. Use the existing app for an early concrete preview, then
incorporate feedback without making the static-data work wait on colours or typography.
Reference hardware is also not yet identified; milestone 0 must record the machines
actually available rather than treating CPU throttling as a substitute for a weak GPU.

The representation questions in milestone 0 are research tasks, not requests for
the user to choose technical internals. Resolve them with measurements and record
the decisions before schema stabilization. If exact wide-view behavior, storage, and
memory targets cannot coexist, document the demonstrated tradeoff before changing
what the product promises.

Deferred: a new whole-history aggregation model, WebGL rewrite, OffscreenCanvas
rendering, incremental compilation, new providers, comparisons, embeds, and expanded
music. Incremental `git log` extraction alone does not make compilation incremental:
new ancestry and refs may alter aggregation, timing, and global layout. Similarly,
moving rendering to a worker does not by itself remove pixel/compositing costs.

Completion means measured static playback, a finished UI/demo, preserved truth and
accessibility, and a validated release path. A small first download without bounded
memory, or a smooth local demo without a compatible published shelf, is incomplete.
