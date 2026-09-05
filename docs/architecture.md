# Architecture

GitTimeline is a static site. Everything a visitor sees runs in their browser; GitHub Actions builds, tests and publishes the bundle — and, for the histories that ship with it, does the fetching and the compiling too.

That last part is the shape of this document. There are two ways a history reaches the stage, and they differ only at the ends: how the commits are obtained, and whether the plan is computed here or arrived ready. In between they are the same code, deliberately, because two implementations of the truth model would drift and the drift would be invisible — the picture would simply be of a different history.

```
a history arrives one of two ways
      ↓  src/github/url.ts            normalize to owner/name, reject gists / other hosts / non-repo routes
      ↓  src/github/ingest.ts         staged, budgeted, cancellable ingestion (metadata → default history → tips → tags)
      ↓  src/github/adapter.ts        REST client: API-version headers, ETag/304, backoff, typed errors
      ↓  src/github/ratelimit.ts      rate-limit and Link headers, read from GitHub rather than assumed
      ↓  src/github/cache.ts          IndexedDB: pages (+ETag +next link), datasets, recent list
      │
      │      …or, for a shipped history, none of the above. scripts/build-clone-dataset.mjs
      │      clones with --filter=tree:0 and reads the graph with `git log`, in CI, once.
      ↓
      ↓  src/model/dataset.ts         normalizer: dedupe, caps, sanitization, identity hashing, boundaries, coverage, content hash
      ↓  Dataset (src/model/types.ts) — immutable once finalized
      ↓
      ↓  src/workers/compile.worker.ts  ─┐
      ↓  src/choreography/compile.ts     │  deterministic compilation (also runs in Node, in tests and in CI)
           dag/graph.ts       graph index, roots, boundaries, topological order
           dag/time.ts        causal presentation timestamps (child never before parent)
           dag/spine.ts       primary spine: first-parent chain of the default tip (+ recorded fallbacks)
           dag/threads.ts     thread decomposition (path cover; every parent edge kept)
           analysis/aggregate.ts   exact aggregation of plain linear runs and pull-request bubbles (protected landmarks never collapse)
           analysis/activity.ts    repository-relative intensity, smoothing, eras
           choreography/pace.ts    per-commit budget, the length to ask about, the length nothing may exceed
           choreography/clock.ts   time-warp, tempo regions, beat grid, causal/approach reserves
           layout/layout.ts        lanes (capped, interval-indexed), straight spine axis, splines (natural-time x)
           choreography/events.ts  event grammar, effect budget, landmarks, transcript
           choreography/camera.ts  shot planning at 20 Hz with look-ahead + critically damped spring
      ↓  CompiledPerformance (typed arrays transferred back to the main thread)
      │
      │      …or, for a shipped history, none of that either. scripts/build-performance.mjs
      │      ran the block above in CI and src/export/performance.ts reads the result back.
      ↓
      ↓  src/player/player.ts        performance clock: play / pause / seek / loop / landmarks
      ↓  src/renderer/canvas.ts      Canvas2D stage: every pixel is a function of (plan, t)
      ↓  src/audio/score.ts          measures the repository's character and picks a soundtrack register
      ↓  src/audio/engine.ts         plays the chosen recording; no synthesis, no effects
      ↓  src/app/*                   Preact UI: landing, prelude, timeline, transport, panels
```

## Two ways in, one model

**The live path is the REST API, and it is what the product is.** Someone pastes a URL for a repository nobody has pre-fetched, and the browser reads its history directly from `api.github.com`: a hundred commits per request, ETag revalidation so an unchanged page costs nothing against the limit, an IndexedDB cache across visits, and a budget that stops before exhaustion and plays a truthful partial performance rather than a fabricated whole one. The ceiling is GitHub's — about sixty anonymous requests an hour, or five thousand with a token — and no browser application can move it. The [README](../README.md) covers what that means for a visitor; [Data truth](data-truth.md) covers what a partial fetch is allowed to claim.

**The catalog path is a clone, because for a large history the API is not a slow option but an impossible one.** Linux is 1,481,850 commits. At a hundred per request that is 14,819 requests: hours of waiting, and three times what an authenticated user is allowed in an hour. `scripts/build-clone-dataset.mjs` asks git instead:

```
git clone --bare --filter=tree:0    # commit objects only; no source code is transferred
git log  --format=…                 # the whole graph, in one pass
```

The script times both stages and prints them: the clone takes about four minutes and `git log` reads all 1.48 million records out of it in fourteen seconds. The git protocol has no REST rate limit to spend, and `--filter=tree:0` is what keeps it honest as well as cheap — it asks the server for commit objects and nothing else, so none of the repository's source code is ever downloaded. The shape of the history is all this project ever needed.

Tags arrive in a second fetch, which is easy to get wrong. `--no-tags` on the clone is deliberate (pulling every tag's history alongside the branch is much of what makes a naive clone slow), but without a follow-up fetch every pre-fetched repository had no releases at all. The filter has to be repeated on that fetch too, or git tries to repack local links against objects a partial clone does not have and dies.

**Both paths end in `buildDataset`.** The build script loads it through Vite — `server.ssrLoadModule('/src/model/dataset.ts')` — rather than reimplementing normalization in Node. The same is true of `streamArtifact` when it writes the file, and of `parseArtifact` and `compilePerformance` in the performance builder. Nothing in `scripts/` re-derives anything `src/` already decides.

## Artifacts are line-delimited

An artifact used to be one JSON document, which works until it doesn't. Linux is roughly 600 MB of JSON and a JavaScript string cannot exceed about 512 MB, so `JSON.stringify` throws `RangeError: Invalid string length`. No amount of memory helps; it is a property of the language. LLVM, Linux and Chromium all died on that one line, having normalized perfectly.

Fixing only the writing side would not have helped, because reading the file back means `JSON.parse` on a string of the same size. Text had to stop being a single value in *both* directions.

So `src/export/stream.ts` defines a newline-delimited format: a header, one object per line, a trailer carrying the hash. It is written by appending and read a line at a time, and the largest string either side ever builds is one commit — a few hundred bytes against a half-gigabyte ceiling. The whole file is still gzip, so it is still one download, and it compresses slightly *better* than before because the repeated key names now sit next to each other.

The object graph at the end is identical. The ceiling was never on how much data could be held, only on how much of it could be one string.

The older single-document format is still read, and still written by the browser's own export (`serializeArtifact`), where nothing is anywhere near the limit. `parseArtifact` peeks at the first line and dispatches, so a file exported before the streamed format existed still opens.

## The plan ships compiled

Pre-fetching removed half the wait, and it turned out to be much the smaller half. The other half is `compilePerformance`, measured on one machine (`scripts/benchmark-performance.mjs` is the repeatable version, and reports per-stage timings): ripgrep 0.5 s, React 2.0 s, CPython 20 s, VS Code 36 s, Kubernetes 142 s, Rust 639 s — and Linux and Chromium never finished at all. That cost tracks merge density rather than commit count, which is why it is so uneven: LLVM's 595,778 commits collapse to 894 nodes because it has five merges, while Rust's 339,084 leave 248,298 because it has 107,048.

None of that work needs a browser. The compile is deterministic — the same dataset, preset and seed always produce the same plan, and `planHash` is the proof — so `scripts/build-performance.mjs` runs it in CI and writes the *result* as `<owner>-<name>.gtperf.gz` beside the dataset. If such a file is there and this build can use it, `loadCatalogEntry` hands the plan straight to the player and the compiler never runs. Measured in the browser: CPython opens in 1.8 s where it took 20, Kubernetes in 8 s where it took 142.

Two things make that trustworthy rather than merely fast. The dataset is read back through `parseArtifact` before it is compiled, so the input in CI is byte-for-byte the input the browser would have had — a shortcut that read the ndjson directly would skip `buildDataset` and produce a plan for a subtly different history. And every file is re-read after it is written and the plan recomputed from what came back; if the round trip changed anything, the fingerprint notices and the file is not kept.

### Why a plan is not simply JSON

The same 512 MB ceiling applies, so the container is the same idea as `stream.ts`: a gzip member holding tagged text lines with one counted run of raw little-endian float32 in the middle. Lines are split on byte `0x0A` *before* decoding, never after, so the binary section is a run the reader counts through rather than scans.

Beyond that, three things keep the file to a size worth downloading, and they are worth knowing about because two of them are the difference between shipping a plan and not.

**Most of the geometry is not written at all.** `EdgeGeom.pts` was the file — 59% of Kubernetes' 87.9 MB and 51% of Linux's 266.3 MB — and it is the one section that is not really data. Every polyline is the return value of `routeCurve` or `routeAlongLane` applied to two node positions the file already carries in its node records. So an edge names its route instead of listing its points, and the reader runs the same two functions the layout ran; only a lane that bulges has to carry anything (half of it: the x positions come back from the generator, so only the y values travel). Nothing here is inferred and then trusted — the writer regenerates each candidate, compares it against the polyline the compiler actually produced bit for bit, and falls back to raw points the moment one disagrees. A constant that drifts out of step costs bytes. It cannot cost correctness. Rust's 43.6 MB dataset becomes a 2.3 MB plan; Kubernetes' plan is 30.3 MB on disk, where the earlier format — the one that wrote every polyline out in full — was 87.9 MB for the same show.

**What geometry is left is transformed before gzip sees it.** gzip is nearly useless on raw float32 — the mantissa bytes of a smooth curve look like noise. The block is delta-coded with stride two *on the IEEE-754 bit patterns as unsigned integers* (integer wrap-around is exactly reversible; floating-point subtraction is not), then byte-plane transposed so the near-constant exponent bytes sit together. React's geometry goes from 2.59 MB to 1.13 MB, and every value comes back bit for bit — negative zeroes, NaN payloads and denormals included, which is what `tests/unit/performance.test.ts` compares rather than checking that the numbers are close.

**Event subjects are named by index.** A forty-character hex string is close to incompressible, and 606,359 of Kubernetes' 746,289 subject ids are the SHA of a node listed further down the same file. Those become the node's index and are looked back up on load. `planHash` reads `subjectIds`, so a mistake in that substitution is not a subtle one: the fingerprint stops matching and the build refuses to keep the file.

### The honest cost

A precompiled plan is baked at one pace, one layout and one seed. Change the choreography — `SECONDS_PER_NODE`, the aggregation budget, the camera, anything that moves `ENGINE` — and every `.gtperf.gz` describes a show this build no longer produces. The engine version is written into the file and checked on load, so a stale plan is refused rather than played, but refusing it means the catalog falls back to compiling in the browser until the script is run again. **Rebuild the plans in the same CI step that builds the datasets**, and treat a choreography change as a catalog change.

The same applies at the viewer's end, and for the same reason: a plan is one plan. Someone who has pinned a duration, chosen a different length, or whose system asks for reduced motion is asking for a different show, and `performanceMatchesRequest` declines rather than playing this one and calling it theirs. Every way the shipped plan can be declined returns null instead of throwing, because none of them is an error — the entry opens either way; it just opens the way it used to.

One asymmetry is deliberate. A `.gtperf` is a build output, read only from the site's own origin, so its integrity checks are for corruption and truncation rather than for hostility. A `.gittimeline` artifact is untrusted input — anyone can paste one — and is re-normalized through `buildDataset` on import. A plan cannot be re-normalized that way, because a plan *is* the derivation, which is exactly why the file picker does not accept one.

A plan also carries no commit subjects, parent lists or GitHub links; those live in the dataset. So the loader fetches the dataset separately, in the background, once the performance is already playing, and only when it is small enough that the one synchronous pass through `buildDataset` is a hitch rather than a stall. On the shipped catalog that means the smaller histories fill in their commit rail and the six largest do not: everything on stage is exact for every entry, and the panel beside it is complete for the ones where completing it is free.

## Three quadratics, and the shape of the lesson

Opening a very large history was impossible for a while, and not because of anything subtle. Three loops were quadratic. Each was invisible on every history anyone had tried, and each was the entire cost of compiling on the first merge-heavy project that reached it. The pattern is the point: fine at twelve thousand nodes, fatal at a quarter of a million.

- **`src/choreography/events.ts`** ran `nodes.find(n => n.sha === …)` inside a loop over merges. Rust has 107,048 merges and 248,298 nodes: 26.6 billion comparisons, and this one function took twenty-eight minutes. Indexed into a `Map` once — 1,659 s → 10.4 s.
- **`src/layout/layout.ts`** asked "is this lane free here?" by scanning every interval placed so far, from inside a loop over every thread. CPython's 12,022 threads pass unnoticed; Rust has roughly one thread per merge and the layout stage simply never returned. Each lane now keeps its intervals ordered by start alongside a running maximum of the ends, so the question is one binary search and one comparison. Never-returned → 0.52 s, with identical answers.
- **`src/choreography/compile.ts`** measured merge salience by walking the side branch, bounded per merge at 2,000 ancestors but unbounded in aggregate — and the aggregate is what bites. CPython's 12,428 merges made that twenty-five million visits, forty of the forty-seven seconds the function spent. The budget now derives from the merge count so the total stays roughly constant: 40.7 s → 3.7 s. What it costs is precision on the largest merges in the largest histories, and that costs nothing visible, because the volume is consumed as a logarithm and lands on a stroke a few pixels wide.

Rust went from never finishing to about two minutes; Linux compiled for the first time. Every resulting plan was byte-identical, which is the only reason changing any of it was safe — the determinism tests passed untouched.

## Boundaries

- **Core packages are DOM-free.** `model`, `dag`, `analysis`, `layout`, `choreography` and `fixtures` import nothing from the browser; they run in the Worker, in Vitest under Node, and in the CI build scripts.
- **Rendering consumes immutable compiled buffers.** The renderer never decides Git semantics; it draws `NodeGeom`, `EdgeGeom`, `ThreadGeom`, events and camera cues.
- **The GitHub adapter never leaks provider records.** `ingest.ts` maps API JSON to `RawCommitRecord`s; `buildDataset` is the only path into the canonical model, shared with synthetic fixtures, artifact import and the clone builder, so every truth rule lives once.
- **`src/export` is the only place that knows a file format**, and the plan reader is allowed to import `layout/layout.ts` for exactly one reason: regenerating an edge's points has to run the generator the layout ran, not a copy of it.
- **UI contains no graph algorithms.** Components call `src/app/controller.ts`, which orchestrates runs, compilation, the frame loop, keyboard and export.
- **Audio and camera consume the same event plan as visuals.**

## State machine

`src/app/store.ts` holds the explicit phases from the specification: `IDLE → VALIDATING_URL → FETCHING_METADATA → FETCHING_TOPOLOGY → BUILDING_DAG → LAYING_OUT → CHOREOGRAPHING → READY → PLAYING ↔ PAUSED`, with side states `DEGRADED_READY`, `RATE_LIMITED`, `OFFLINE_CACHED`, `CANCELLED`, `ERROR_RECOVERABLE`, `ERROR_FATAL`. Every ingestion run has an id and an `AbortController`; late results from a cancelled run cannot mutate state. A shipped plan skips most of the middle of that sequence, which is the visible half of what precompiling bought.

## Frame loop

`requestAnimationFrame` → `player.advance(dt)` → `renderer.render(t, dt)` → `audio.schedule(t, rate, intensity)`. Preact signals are updated at most 15× per second from the loop; nothing framework-related runs per frame.

The music is the one thing in the loop that is not a function of *t*, so it is gated separately: `syncAudioToPlayback` resumes it only while the app is in the player, the clock is running, a plan is loaded and the phase is `PLAYING`. A synthesised score needed no such rule — there was nothing to hear between events — but a recording keeps playing until something stops it, which left the soundtrack running over a frozen picture on pause and over the form after a visitor navigated back.

## Determinism

The plan is a pure function of `(dataset.contentHash, ENGINE versions, preset, seed)`. There is no `Math.random` in `src/` — `no-restricted-properties` in `eslint.config.js` makes that an error, and points at `src/model/prng.ts` — and aesthetic variance uses that seeded PRNG. `planHash` (SHA-256 over layout, events and sampled camera cues) is exposed in the data panel and asserted equal across runs in tests. Layout is computed in natural time so geometry is identical for every target duration.

This is not a purity exercise. Determinism is what makes a shipped plan possible at all: the file is only a legitimate substitute for compiling because compiling would have produced it exactly.

## Rendering fallback ladder

1. Canvas2D, full effects (bloom pass on a half-resolution layer, trails, ripples).
2. Canvas2D, reduced/minimal quality (Settings → Render quality; also chosen by the device pixel ratio cap).
3. Static SVG poster + event list (`renderer/poster.ts`) when a 2D context cannot be created or `#renderer=poster` is set.
4. The textual transcript (Events panel, transcript export) always exists.

WebGL is intentionally not used in this version; see [ADR 0001](adr/0001-canvas2d-renderer.md).

## The two things that are not in the browser

**`worker/` is a Cloudflare Worker that performs one call.** GitHub's OAuth token endpoints send no CORS headers — measured, not assumed, and the device flow does not help because it is the same endpoint — and GitHub offers no PKCE for public clients, so a browser physically cannot exchange an authorization code for a token. That exchange is the whole of the Worker: it checks the return URL against an origin allowlist, compares state against an `HttpOnly` cookie in constant time, swaps the code for a token, and redirects with the token in the fragment. It never sees a repository, never proxies the API and stores nothing, so "fetched from GitHub, rendered on your device" stays literally true. It bundles to 2.02 KiB gzipped and has no process to sleep, which is why it replaced a Node service on Render that has since been deleted: that service took twelve seconds to wake and then answered 503, because no OAuth application had ever been registered against it. Deploying the Worker is optional. `AUTH_BASE` is empty until `VITE_AUTH_BASE` is set, and empty is the honest default — a button that sends somebody to a 503 after twelve seconds is worse than no button, so with nothing deployed the sign-in page says so plainly and the site is exactly as static as it was.

**`src/app/analytics.ts` is the only module in `src/` that touches `gtag`,** and the rule it enforces is an allowlist rather than a blocklist. Only repositories *this build already publishes* may be named, because naming one discloses nothing the page did not already say aloud; anything a visitor pasted or imported is reported as a shape — "a public repository", plus a coarse commit-count bucket — and never as `owner/name`. The direction is the whole argument: a blocklist fails open on every case nobody anticipated, an allowlist fails closed, and it fails closed hardest exactly where the risk is highest, since a catalog that did not load leaves the list empty. A matched name is even emitted using the *catalog's* spelling, so a string somebody typed is never transmitted.

The subtle half is the URL. GA4 fills `page_location` from `location.href` unless told otherwise, and on this site the fragment is the router — a share link is `#repo=owner/name` — so a default configuration would have shipped a pasted repository on the very first pageview, with no event parameter involved. Page views are sent by hand against an origin-and-path location, and `planEvent` re-sanitizes rather than trusting its caller. With no `VITE_GA_ID`, or under Do Not Track or Global Privacy Control, nothing is loaded and nothing is sent.

## Where to add things

- **A new event type:** `src/model/types.ts` (`ChoreographyEventType`), emit it in `choreography/events.ts`, react to it in `renderer/canvas.ts`, label it in `app/Panels.tsx`. Nothing goes in `audio/` — the soundtrack does not respond to events.
- **A new fixture:** `src/fixtures/corpus.ts` using the `Script` helper; it is automatically covered by `tests/unit/compile.test.ts`, `pacing.test.ts` and `score.test.ts`.
- **A new provider:** implement ingestion that yields `RawCommitRecord[]`/`RawRef[]` and call `buildDataset`. The clone builder is the worked example, and it is about forty lines of parsing around one `git log`.
- **A new shipped history:** a line in `SHIPPED` in `scripts/index-artifacts.mjs`, then the dataset build, the performance build and the index. The step is best-effort by design: if one fails, that deploy has one fewer history rather than no deploy.
- **Anything that changes the plan:** bump the relevant `ENGINE` version and rebuild the catalog's `.gtperf.gz` files. Skipping the rebuild is not a correctness bug — stale plans are refused — but it silently returns every large history to compiling in the browser, which is the thing that was impossible.
