# Architecture

GitDance is a static site. Everything below runs in the visitor's browser; GitHub Actions only builds, tests and publishes the bundle.

```
public GitHub URL
      ↓  src/github/url.ts            normalize to owner/name, reject gists / other hosts / non-repo routes
      ↓  src/github/ingest.ts         staged, budgeted, cancellable ingestion (metadata → default history → tips → tags)
      ↓  src/github/adapter.ts        REST client: API-version headers, ETag/304, rate-limit headers, backoff, typed errors
      ↓  src/github/cache.ts          IndexedDB: pages (+ETag +next link), datasets, recent list
      ↓  src/model/dataset.ts         normalizer: dedupe, caps, sanitization, identity hashing, boundaries, coverage, content hash
      ↓  Dataset (src/model/types.ts) — immutable once finalized
      ↓  src/workers/compile.worker.ts  ─┐
      ↓  src/choreography/compile.ts    │  deterministic compilation (also runs in Node for tests)
           dag/graph.ts       graph index, roots, boundaries, topological order
           dag/time.ts        causal presentation timestamps (child never before parent)
           dag/spine.ts       primary spine: first-parent chain of the default tip (+ recorded fallbacks)
           dag/threads.ts     thread decomposition (path cover; every parent edge kept)
           analysis/aggregate.ts   exact aggregation of plain linear runs (protected landmarks never collapse)
           analysis/activity.ts    repository-relative intensity, smoothing, eras
           choreography/clock.ts   time-warp, tempo regions, beat grid, causal/approach reserves
           layout/layout.ts        lanes (capped), straight spine axis, splines (natural-time x)
           choreography/events.ts  event grammar, effect budget, landmarks, transcript
           choreography/camera.ts  shot planning with look-ahead + critically damped spring
      ↓  CompiledPerformance (typed arrays transferred back to the main thread)
      ↓  src/player/player.ts        performance clock: play / pause / seek / loop / landmarks
      ↓  src/renderer/canvas.ts      Canvas2D stage: every pixel is a function of (plan, t)
      ↓  src/audio/engine.ts         procedural score scheduled from the same event plan
      ↓  src/app/*                   Preact UI: landing, prelude, timeline, transport, panels
```

## Boundaries

- **Core packages are DOM-free.** `model`, `dag`, `analysis`, `layout`, `choreography` and `fixtures` import nothing from the browser; they run in the Worker and in Vitest under Node.
- **Rendering consumes immutable compiled buffers.** The renderer never decides Git semantics; it draws `NodeGeom`, `EdgeGeom`, `ThreadGeom`, events and camera cues.
- **The GitHub adapter never leaks provider records.** `ingest.ts` maps API JSON to `RawCommitRecord`s; `buildDataset` is the only path into the canonical model, shared with synthetic fixtures and artifact import, so every truth rule lives once.
- **UI contains no graph algorithms.** Components call `src/app/controller.ts`, which orchestrates runs, compilation, the frame loop, keyboard and export.
- **Audio and camera consume the same event plan as visuals.**

## State machine

`src/app/store.ts` holds the explicit phases from the specification: `IDLE → VALIDATING_URL → FETCHING_METADATA → FETCHING_TOPOLOGY → BUILDING_DAG → LAYING_OUT → CHOREOGRAPHING → READY → PLAYING ↔ PAUSED`, with side states `DEGRADED_READY`, `RATE_LIMITED`, `OFFLINE_CACHED`, `CANCELLED`, `ERROR_RECOVERABLE`, `ERROR_FATAL`. Every ingestion run has an id and an `AbortController`; late results from a cancelled run cannot mutate state.

## Frame loop

`requestAnimationFrame` → `player.advance(dt)` → `renderer.render(t, dt)` → `audio.schedule(t, rate, intensity)`. Preact signals are updated at most 15× per second from the loop; nothing framework-related runs per frame.

## Determinism

The plan is a pure function of `(dataset.contentHash, ENGINE versions, preset, seed)`. There is no `Math.random` in `src/` (lint-enforced); aesthetic variance uses the seeded PRNG in `src/model/prng.ts`. `planHash` (SHA-256 over layout, events and sampled camera cues) is exposed in the data panel and asserted equal across runs in tests. Layout is computed in natural time so geometry is identical for every target duration.

## Rendering fallback ladder

1. Canvas2D, full effects (bloom pass on a half-resolution layer, trails, ripples).
2. Canvas2D, reduced/minimal quality (Settings → Render quality; also chosen by the device pixel ratio cap).
3. Static SVG poster + event list (`renderer/poster.ts`) when a 2D context cannot be created or `#renderer=poster` is set.
4. The textual transcript (Events panel, transcript export) always exists.

WebGL is intentionally not used in this version; see [ADR 0001](adr/0001-canvas2d-renderer.md).

## Where to add things

- A new event type: `src/model/types.ts` (`ChoreographyEventType`), emit it in `choreography/events.ts`, react to it in `renderer/canvas.ts` and `audio/engine.ts`, label it in `app/Panels.tsx`.
- A new fixture: `src/fixtures/corpus.ts` using the `Script` helper; it is automatically covered by `tests/unit/compile.test.ts`.
- A new provider: implement ingestion that yields `RawCommitRecord[]`/`RawRef[]` and call `buildDataset`.
