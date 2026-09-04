# GitDance

**Paste a public GitHub repository URL and watch its real Git history become a deterministic, rhythm-driven choreography of commits, parallel work, contributors and merges.**

GitDance is a static, open-source web application. There is no backend: the browser reads public history straight from GitHub's REST API, rebuilds the honest commit DAG, compiles it into a performance (layout, beat map, choreography events, camera plan, score) inside a Web Worker, and plays it on a Canvas stage with a procedural Web Audio soundtrack.

> The repository is the score, the DAG is the stage, contributors are the motion, and history performs itself.

## What you see

- **The bright ivory line** is the default branch's first-parent history, held dead straight so the main line is unmistakable at any zoom.
- **Slate paths** are real threads: ancestry that diverged where the graph diverges and merged where a merge commit says so. Nothing is invented.
- **Moving sparks** are people. A contributor's colour and glyph travel *through* the structure and never recolour it. Handoffs cross-fade one signature into the next.
- **Merges** have an approach (the incoming thread curves toward its destination while a dashed intent line shows where it will land), a synchronized hit with rings and a ripple through nearby geometry, and a release.
- **Rings** are merge commits; a double ring has more than two parents (octopus).
- **Dashed grey** is history that was not loaded. It is labelled and never filled in.
- **A thick ribbon** is an exact aggregate of many known commits, with the count written on it.
- **The calendar leads.** The repository's own month and year fill the bottom of the screen and advance as the show plays; quiet years spin past in well under a second while busy weeks slow down and fill the stage. A slim scrub line underneath carries the playhead and the landmarks worth jumping to.
- **The commit ledger** down the right-hand side prints each commit as it lands: short SHA in the author's signature colour, subject, and name. Click one to jump back to that moment.

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

`Space` play/pause · `←/→` step by beat (or commit / second) · `Shift+←/→` landmarks · `↑/↓` walk active threads · `Home/End` · `M` sound on/off (off by default) · `C` camera: free look → follow at your zoom → auto · `R` reduced motion · `E` events · `I` what am I seeing? · `?` help · `Esc` close.

Zoom out with the wheel, then press `C`: the performance keeps playing and keeps that wider view instead of springing back.

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
  export/        share links, .gitdance artifacts
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
