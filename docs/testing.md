# Testing

```bash
npm run verify        # typecheck + lint + unit tests + production build
npm run test:e2e      # Playwright against the built output (npx playwright install chromium once)
```

## Unit and property tests (`tests/unit`, Vitest)

| File | Covers |
|---|---|
| `compile.test.ts` | the demo emits the full motion vocabulary; determinism (same input/seed → same `planHash`); geometry independent of target duration; reduced motion keeps structure; every fixture in the 23-fixture corpus satisfies `assertInvariants`; octopus, multiple roots, partial boundaries, unknown side history, aggregation round-trip, merge storms, empty repository, hostile metadata, clock skew, large synthetic history within budget; merge bubbles — one bubble, a run of them, and the shapes that must never collapse (a branch longer than `SIDE_MAX`, a tagged merge, an octopus, a criss-cross), each checked for enclosure, exact expansion and every commit accounted for once. |
| `dag.test.ts` | fast-check property tests over random DAGs with missing parents, skew and absent dates: graph index matches input, topological order, causal timestamps, thread cover is exact and first-parent, compiled invariants + determinism, aggregation preserves members and boundary edges. |
| `github.test.ts` | URL normalization/rejection; rate-limit and Link headers; mocked ingestion: happy path with branches and tags, page budget → partial, rate limit mid-way → partial with reset, rate limit before data, not-found, empty (409), cancellation, ETag conditional requests, offline from cache, 5xx retries. |
| `artifact.test.ts` | `.gittimeline` gzip/JSON round-trip reproducing the same plan, tamper/schema rejection, no raw e-mails or scripts, prototype-pollution stripping. This covers the single-document form, which is what the browser's own export writes. The line-delimited form (`src/export/stream.ts`) is what every shipped catalog artifact actually is, and it has no unit test of its own — it is exercised end to end, by the catalog build writing it and by `catalog.spec.ts` opening the result. That is the gap in this table. |
| `pacing.test.ts` | that the pace is watchable at every size — the failure being guarded against is not a crash but a large repository whose arrivals are individually correct and land faster than they can be seen, which has happened three times. Every fixture and the demo: the typical arrival holds the stage ≥ 0.125 s, the fastest tenth clears 0.06 s, arrivals stay under nine a second. Any show running past `LONG_PERFORMANCE_SECONDS` must have been predicted dense from the two probe requests, so nobody arrives at a long one unasked — and at least one fixture must actually run long, or the suite proves nothing. Also `predictVisible` against four real histories measured out of band, kept honest in one direction only: never below what survives. |
| `score.test.ts` | which soundtrack register each history in the corpus gets: `characterOf` inside its range everywhere, the pull-request treadmill on `frantic`, a sparse long-running history on `calm`, more than one register used across the corpus, and the corpus genuinely spanning the range rather than clustering — without which the thresholds would be tuned to one example. |
| `analytics.test.ts` | what is allowed to leave the browser. The failure that matters is not "analytics broke" but "analytics worked and carried somebody's repository name", so the load-bearing assertions are the negative ones: given anything the visitor supplied, nothing derived from it appears anywhere in the payload — including under `fast-check` over arbitrary off-catalog names. Plus the catalog's spelling being sent rather than the visitor's, failing closed on an unloaded catalog, fragment stripping inside the planner, commit-count buckets, DNT/GPC, and inertness with no measurement id. |
| `performance.test.ts` | `.gtperf` round-trip: every fixture in the corpus serialized and read back reproduces `planHashOf`, with the geometry compared bit for bit rather than numerically — negative zeroes, NaN payloads, denormals and the float32 extremes included, because the delta/byte-plane codec the polylines travel through is only worth having if it is exactly reversible. Also chunk boundaries falling mid-line and mid-float, gzip in and out the way the browser reads it, truncation and header tampering refused, and the preset/seed comparison that decides whether a shipped plan answers the question being asked. |
| `misc.test.ts` | sanitizer, identity keys and bot detection, colour separation, seeded PRNG, SHA-256 vectors, canonical JSON, share links, clock monotonicity and gap compression, poster SVG. |

`assertInvariants` (in `compile.test.ts`) is the executable form of the truth model: exact edges ↔ input relations (once each), octopus parents retained, no event references a missing subject, monotone time map, spine is a first-parent chain, boundaries are never roots, camera cues cover the duration with bounded rotation.

## Browser tests (`tests/e2e`, Playwright)

The app exposes a read-only `window.__gittimeline` hook (time, phase, stats, plan hash, camera cue, travelling bodies with screen positions, events, seek/play/pause) so tests can assert motion rather than DOM.

- `demo.spec.ts` — landing (stage alive behind the form); pressing Play launches a continuously animated performance: required event types present, ≥2 performers on distinct threads moving at once, merge approach → push-in at impact → settle, divergence pull-back, frames keep changing, audio starts on the gesture; pause is an exact freeze and resume is continuous; keyboard/landmark/timeline seeking; mute/camera/reduced-motion shortcuts; panels; share links and fixtures from the hash.
- `github.spec.ts` — mocked `api.github.com` via route interception (with GitHub's real CORS-exposed headers): happy path, paste detection, invalid/not-found/empty, rate limit before and during, cancel, cache + offline, pinned share link reproducing the plan hash.
- `fallback.spec.ts` — poster renderer, reduced motion + no flashes, keyboard-only reachability and accessible names, mobile and ultrawide layouts, gallery mode, zero console errors over a full run.
- `catalog.spec.ts` — the pre-fetched histories. The property that matters is not that one loads but that it loads **having asked GitHub for nothing at all**, so the spec blocks `api.github.com` outright and fails on any request to it. It opens the smallest entry on the shelf rather than a named one, because naming an entry tests the build script's contents instead of the property; a build with no catalog simply skips. The second test walks every entry and checks it is real, reachable and honestly described.
- `explore.spec.ts` — what happens after the last commit: the travel slider appears only once the performance has ended, pans without changing the magnification the viewer chose, is keyboard operable, cannot travel past either end, and hands the camera back when playback restarts from the beginning. Also that the date follows what is on screen while travelling rather than where the clock stopped, and that leaving the landing page starts a performance rather than joining the one running behind the form.
- `analytics.spec.ts` — the redaction rule, checked against the wire rather than against the module. `analytics.test.ts` proves the rule; this proves it is the rule the running application applies, and it watches the one channel a unit test cannot see. Every Google-owned host is intercepted and every request body searched for the repository in each spelling it could carry, with the repository arriving both in the URL fragment and typed into the box, because GA4's default `page_location` would have leaked it through a parameter nobody wrote.

The mock (`tests/fixtures/mock-github.ts`) paginates with Link headers, emits ETags/304, rate-limit headers, 403/404/409/5xx, and walks history like `git log` (tip first).

## Visual QA

`node scripts/inspect.mjs <dir>` captures frames of the demo from the preview server and reports console issues; `node scripts/live-smoke.mjs owner/repo` runs a read-only live smoke test (a handful of requests).

`scripts/usertest.mjs` is a **user test rather than a unit test**: it drives the real interface the way a person would — types a token into the landing page, enters a repository, presses Play, watches the stage for nine seconds and reports load time, request count, coverage, show length and how many of its ten samples were distinct frames.

```bash
GD_TOKEN=$(gh auth token) node scripts/usertest.mjs BurntSushi/ripgrep ./shots
```

It was used to verify the pacing against real repositories rather than synthetic fixtures — the ingestion figures in `README.md` come from it — and screenshots at birth, first divergence, maximum concurrency, merge approach/impact, the quiet gap, the tableau, reduced motion, poster and mobile were reviewed while tuning the motion language.

It also still instruments `AudioContext` and counts oscillator starts, attributing each to a voice and reporting the spacing between attacks. That was the measurement that showed the synthesised score was crowded, and it measures nothing now: the soundtrack is a recording played through an `HTMLAudioElement`, so the count is always zero and the spacing line never prints. Read it as a fossil rather than as a result.

## Adding a fixture

Add an entry to `src/fixtures/corpus.ts` with the `Script` helper (`commit`, `branch`, `merge`, `tag`, `keep`, `missingParents`). It is compiled and invariant-checked automatically, and can be opened with `#fixture=<id>`.
