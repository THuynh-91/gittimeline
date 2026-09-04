# Testing

```bash
npm run verify        # typecheck + lint + unit tests + production build
npm run test:e2e      # Playwright against the built output (npx playwright install chromium once)
```

## Unit and property tests (`tests/unit`, Vitest)

| File | Covers |
|---|---|
| `compile.test.ts` | the demo emits the full motion vocabulary; determinism (same input/seed → same `planHash`); geometry independent of target duration; reduced motion keeps structure; every fixture in the 20-fixture corpus satisfies `assertInvariants`; octopus, multiple roots, partial boundaries, unknown side history, aggregation round-trip, merge storms, empty repository, hostile metadata, clock skew, large synthetic history within budget. |
| `dag.test.ts` | fast-check property tests over random DAGs with missing parents, skew and absent dates: graph index matches input, topological order, causal timestamps, thread cover is exact and first-parent, compiled invariants + determinism, aggregation preserves members and boundary edges. |
| `github.test.ts` | URL normalization/rejection; rate-limit and Link headers; mocked ingestion: happy path with branches and tags, page budget → partial, rate limit mid-way → partial with reset, rate limit before data, not-found, empty (409), cancellation, ETag conditional requests, offline from cache, 5xx retries. |
| `artifact.test.ts` | `.gitdance` gzip/JSON round-trip reproducing the same plan, tamper/schema rejection, no raw e-mails or scripts, prototype-pollution stripping. |
| `misc.test.ts` | sanitizer, identity keys and bot detection, colour separation, seeded PRNG, SHA-256 vectors, canonical JSON, share links, clock monotonicity and gap compression, poster SVG. |

`assertInvariants` (in `compile.test.ts`) is the executable form of the truth model: exact edges ↔ input relations (once each), octopus parents retained, no event references a missing subject, monotone time map, spine is a first-parent chain, boundaries are never roots, camera cues cover the duration with bounded rotation.

## Browser tests (`tests/e2e`, Playwright)

The app exposes a read-only `window.__gitdance` hook (time, phase, stats, plan hash, camera cue, travelling bodies with screen positions, events, seek/play/pause) so tests can assert motion rather than DOM.

- `demo.spec.ts` — landing (stage alive behind the form); pressing Play launches a continuously animated performance: required event types present, ≥2 performers on distinct threads moving at once, merge approach → push-in at impact → settle, divergence pull-back, frames keep changing, audio starts on the gesture; pause is an exact freeze and resume is continuous; keyboard/landmark/timeline seeking; mute/camera/reduced-motion shortcuts; panels; share links and fixtures from the hash.
- `github.spec.ts` — mocked `api.github.com` via route interception (with GitHub's real CORS-exposed headers): happy path, paste detection, invalid/not-found/empty, rate limit before and during, cancel, cache + offline, pinned share link reproducing the plan hash.
- `fallback.spec.ts` — poster renderer, reduced motion + no flashes, keyboard-only reachability and accessible names, mobile and ultrawide layouts, gallery mode, zero console errors over a full run.

The mock (`tests/fixtures/mock-github.ts`) paginates with Link headers, emits ETags/304, rate-limit headers, 403/404/409/5xx, and walks history like `git log` (tip first).

## Visual QA

`node scripts/inspect.mjs <dir>` captures frames of the demo from the preview server and reports console issues; `node scripts/live-smoke.mjs owner/repo` runs a read-only live smoke test (a handful of requests).

`scripts/usertest.mjs` is a **user test rather than a unit test**: it drives the real interface the way a person would — types a token into the landing page, enters a repository, presses Play, watches the stage for nine seconds and reports load time, request count, coverage, show length, how many distinct frames were drawn and how many notes the audio engine actually started.

```bash
GD_TOKEN=$(gh auth token) node scripts/usertest.mjs BurntSushi/ripgrep ./shots
```

It was used to verify the pacing and audio against real repositories rather than synthetic fixtures. Screenshots at birth, first divergence, maximum concurrency, merge approach/impact, the quiet gap, the tableau, reduced motion, poster and mobile were reviewed while tuning the motion language.

## Adding a fixture

Add an entry to `src/fixtures/corpus.ts` with the `Script` helper (`commit`, `branch`, `merge`, `tag`, `keep`, `missingParents`). It is compiled and invariant-checked automatically, and can be opened with `#fixture=<id>`.
