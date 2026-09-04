# GitTimeline

**Paste a public GitHub repository URL and watch its real Git history become a deterministic, rhythm-driven choreography of commits, parallel work, contributors and merges.**

GitTimeline is a static, open-source web application. There is no backend: the browser reads public history straight from GitHub's REST API, rebuilds the honest commit DAG, compiles it into a performance (layout, beat map, choreography events, camera plan, score) inside a Web Worker, and plays it on a Canvas stage with a procedural Web Audio soundtrack.

> The repository is the score, the DAG is the stage, contributors are the motion, and history performs itself.

## What you see

- **The bright ivory line** is the default branch's first-parent history, held dead straight so the main line is unmistakable at any zoom.
- **Slate paths** are real threads: ancestry that diverged where the graph diverges and merged where a merge commit says so. Nothing is invented.
- **Moving sparks** are people. A contributor's colour and glyph travel *through* the structure and never recolour it. Handoffs cross-fade one signature into the next.
- **Merges** have an approach (the incoming thread curves toward its destination while a dashed intent line shows where it will land), a synchronized hit with rings and a ripple through nearby geometry, and a release.
- **Merges are as big as the work they absorbed.** Two commits converging is a small ring; twelve is a wall of light with one spoke per incoming parent and the count written beside it. The pacing follows: the beat before a heavy merge hangs, and the beats after it race away.
- **Dashed grey** is history that was not loaded. It is labelled and never filled in.
- **A thick ribbon** is an exact aggregate of many known commits, with the count written on it.
- **The calendar leads.** The repository's own month and year fill the bottom of the screen and advance as the show plays; quiet years spin past in well under a second while busy weeks slow down and fill the stage. A slim scrub line underneath carries the playhead and the landmarks worth jumping to.
- **The commit ledger** across the top prints each commit as it lands: short SHA in the author's colour, subject and name. Click one to jump back to that moment, or drag the ledger to either side if you would rather keep the top clear.
- **Each thread has its own muted tint and carries its name**, pinned to the newest commit it has landed, so two branches running side by side are never a guess. Threads whose branch no longer exists are labelled honestly as `thread 07` rather than given an invented name.

The camera is a director, not a follower: intimate on calm linear work, pulling back for splits and ensembles, tracking convergence, pushing in at impacts, settling afterwards, and framing the final tableau.

## Try it

```bash
npm ci
npm run dev        # http://localhost:5173
```

Press **Play demo** on the landing page for the built-in deterministic performance (no network required), or paste a repository such as `github.com/BurntSushi/ripgrep`.

Useful URL parameters (everything lives in the hash so static hosting needs no routing):

| Parameter | Meaning |
|---|---|
| `#repo=owner/name` | open a repository |
| `&tip=<sha>` | pin the tip so a shared performance never drifts |
| `&t=12.5` | start position in performance seconds |
| `&dur=20\|30\|45\|60\|90` | target duration in seconds |
| `&seed=…` | deterministic seed for aesthetic variance |
| `&autoplay=1`, `&gallery=1` | start playing / hide the chrome and loop |
| `#demo=1`, `#fixture=07-octopus-merge` | built-in demo / synthetic fixture |
| `&rm=1`, `&renderer=poster` | reduced motion / force the static SVG fallback |

## Keyboard

`Space` play/pause · `←/→` step a beat · `Shift+←/→` landmarks · `↑/↓` walk the active threads · `Home/End` · `M` sound · `C` camera: free look → follow at your zoom → auto · `?` help · `Esc` close.

Zoom out with the wheel, then press `C`: the performance keeps playing and keeps that wider view instead of springing back.

## Large repositories and GitHub's rate limit

GitHub allows roughly **60 anonymous requests an hour per network** — its limit, not GitTimeline's, and not something any browser app can bypass. That is a few thousand commits. GitTimeline stretches it as far as it honestly can: 100 commits per request, ETag revalidation (an unchanged page returns 304 and **does not count** against the limit), an IndexedDB cache across visits, and a budget that stops before exhaustion and plays a truthful partial performance.

For a large open-source project, supply a **free fine-grained token** with read-only public access. That raises the ceiling to about **5,000 requests an hour** and lets GitTimeline read up to 600 pages instead of 40. Add it on the landing page ("Loading a large repository?") or in Settings. It stays in memory for that tab only, goes solely to `api.github.com`, and is never stored, logged or shared.

Measured end to end with a token:

When a repository turns out to be large, GitTimeline says how large **before spending anything** — the size probe costs two requests — and offers a single year, a recent span, or the whole thing. Anything already fetched is reused on the next visit with **no requests at all**, and Settings has a "fetch latest commits" action when you want fresh data.

**How long a show runs** is derived, not fixed. Each visible commit is given 0.26 seconds of stage time — enough for its arrival to read as its own beat — and the history is collapsed into counted ribbons until what remains fits. The automatic length is therefore the size of what survives aggregation, with a ceiling of **four minutes**; choosing an explicit length in Settings overrides that exactly. `tests/unit/pacing.test.ts` holds the floor: the typical arrival must hold the stage for at least a quarter of a second, and arrivals must stay under 4.5 a second, for every history in the corpus.

Ingestion cost, measured by driving the real interface (`scripts/usertest.mjs`) with a token:

| Repository | Commits | Requests | Load |
|---|---:|---:|---:|
| ripgrep | 2,299 | 34 | 9s |
| vite | 9,670 | 108 | 47s |
| React | 22,345 | 244 | ~2 min |

React's entire history loads with a token, at exact coverage. Aggregation collapses long linear runs into counted ribbons so the show stays watchable, and three things keep a very dense project legible rather than a smear: lanes are capped so thousands of short-lived pull-request branches share outer lanes instead of pushing the graph tens of thousands of units tall, the camera will not pull back past a fixed bound and instead stays with the front of the work, and thread names are budgeted so a named branch is labelled while thousands of anonymous ones are not.

## Truth model

Every displayed commit is a real commit or an explicitly labelled aggregate; every edge comes from a parent relation; divergences and merges happen only where ancestry says so; concurrent work is spatially concurrent; missing history is shown as unknown, never fabricated; historic branch names are never guessed. Coverage (exact / partial / unknown) is visible in the top bar and in the **What am I seeing?** panel. See [docs/data-truth.md](docs/data-truth.md).

## Project layout

```
src/
  model/         canonical types, hashing, seeded PRNG, sanitization, dataset normalizer, colour math
  github/        URL parsing, REST adapter (ETag, rate limits, retries), IndexedDB cache, staged ingestion
  dag/           graph index, causal timestamps, primary spine, thread decomposition
  analysis/      contributors, activity/intensity/eras, exact aggregation
  layout/        lanes, splines, arc-length sampling
  choreography/  performance clock, event grammar, camera director, compile pipeline
  renderer/      Canvas2D stage renderer, SVG poster fallback, palette
  audio/         procedural Web Audio score
  player/        playback clock, worker client
  export/        share links, .gittimeline artifacts
  fixtures/      synthetic history builder, the demo, the 20-fixture corpus
  workers/       compile worker
  app/           Preact UI (store, controller, stage, timeline, panels)
tests/unit       Vitest (invariants, property tests, mocked GitHub, artifacts)
tests/e2e        Playwright (demo motion, keyboard, mocked GitHub flows, fallbacks)
docs/            architecture, data truth, choreography, testing, deployment, accessibility, ADRs
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run verify` | type-check, lint, unit tests, production build |
| `npm test` / `npm run test:e2e` | unit tests / browser tests (needs `npx playwright install chromium`) |
| `npm run build` / `npm run preview` | static build to `dist/` / serve it on :4173 |
| `node scripts/inspect.mjs <dir>` | capture frames of the demo from the preview server (visual QA) |
| `node scripts/live-smoke.mjs owner/repo` | read-only smoke test against the real GitHub API (few requests) |

## Settings

Deliberately few: length, sound, loop, no-flashes, high contrast, and an optional GitHub token. Everything with one right answer is baked in — label density, contributor glyphs, effect budgets, branch discovery, captions, keyboard granularity, dynamic range, and render quality, which is chosen from the device. Reduced motion has no switch because it follows your operating system preference.

The length follows the history rather than a fixed target: a handful of commits plays in about half a minute, tens of thousands in a couple of minutes, and *Brief* or *Extended* nudges that either way.

## Sound

Every repository gets its own piece, chosen to fit rather than at random. Three things are measured from the history — how much lands per second, how bursty and contested it is, and how much each merge absorbs — and they decide the mode, the harmonic rhythm and how heavily the piano is written. The plan hash then picks which piece within that character, so a project always sounds like itself.

**It follows the timeline.** Harmony turns over in bars rather than seconds, counted on the performance's own beat grid, so a busy stretch changes chord faster and a dormant one holds. The writing moves with the activity curve too: the deep doubled left hand lifts and the ring shortens when things get busy, the rolling figure fills in, and it drops to half-time when the tempo outruns the ear. A repository is not one mood for its whole life.

The melody walks the scale and resolves onto chord tones on the downbeat — never the voiced chord, whose adjacent notes are a third apart and which turned every step into a leap. Nothing is sampled and nothing drones.

| Section | Carries |
|---|---|
| Piano | the piece itself: a low doubled left hand, a rolling figure, a melody on the strong beats |
| Strings | the harmony, swelling in on each chord change and receding before the next |
| Basses | one deep root per chord, giving the harmony a floor |
| Harp | a touch of light on each commit, brighter on the main line |
| Woodwind | a rising pair where a branch diverges |
| Timpani | the impact under a merge, pitched to the chord root |
| Brass | merges that genuinely absorbed something, and the closing tutti |
| Cymbal | tags and the final cadence only |

**The score adjusts itself to the repository.** How much air an accent needs, how often a merge is played at full force, and how wide the pacing's dynamic range can be are all derived from the plan's own measured shape — never from anything about a particular project. A history that produces two events a second keeps the minimum spacing; one that merges a pull request every other commit spaces them out until they can be heard as separate things happening, and its routine merges join the harmony instead of each taking a downbeat. Nothing is silenced: an unfeatured merge still sounds, it just stops being an event.

Measured across the corpus in a real browser, attacks land between 0.8 and 3.5 per second with median gaps from 292 ms to 1.3 s. These rules are pure functions in `src/audio/score.ts`, asserted against every history in the corpus at once, which is what stops them being tuned to one example.
## Documentation

- [Architecture](docs/architecture.md) — pipeline from API record to rendered frame, module boundaries, worker split.
- [Data truth](docs/data-truth.md) — provenance classes, what Git can and cannot prove, partial history, aggregation rules.
- [Choreography](docs/choreography.md) — clocks, tempo, event grammar, effect budget, camera states, sound.
- [Testing](docs/testing.md) — invariants, fixtures, property tests, browser suites, visual QA.
- [Deployment](docs/deployment.md) — how the site is built and published.
- [Accessibility](docs/accessibility.md) — keyboard, reduced motion, no flashes, screen readers, contrast.
- [ADRs](docs/adr/) — material deviations from the original specification and why.

## License

MIT — see [LICENSE](LICENSE). Visual and audio design are original; the rhythmic path-reading idea takes only conceptual inspiration from rhythm games.
