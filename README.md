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
- **A thick ribbon** is an exact aggregate of many known commits, with the count written on it — "31 merged branches · 74 commits" when what it stands for is a run of pull requests.
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

**How long a show runs** is derived, not fixed. Each visible commit is given 0.26 seconds of stage time — enough for its arrival to read as its own beat — and the history is collapsed into counted ribbons until what remains fits. The automatic length is therefore the size of what survives aggregation. There is **no cap**, because a cap can only be met by making arrivals invisible — a show nobody can follow is not a shorter show, it is a broken one. Choosing an explicit length in Settings overrides the pace exactly.

**Density, not size, decides whether a history can be shown whole.** A routine pull request — a branch that left the main line, carried a commit or two and was merged back — collapses into one counted ribbon much as a linear run does, provided the ribbon can hide the branch point along with the branch. What cannot collapse is a branch with a story of its own, a stale branch merged long after it left, or two long-lived lines that integrate into each other: those are branch points, and hiding one hides what happened. Measured on the real histories in the shipped catalog, before and after:

| History | commits | merges | visible before | visible now | before | now |
|---|---:|---:|---:|---:|---:|---:|
| ripgrep | 2,299 | 3% | 335 | 335 | 97 s | 97 s |
| Svelte 2023 | 860 | 3% | 235 | 235 | 86 s | 86 s |
| public-apis 2021 | 1,796 | 44% | 1,587 | 1,171 | 6.9 min | 5.1 min |
| mdBook | 3,293 | 32% | 2,581 | 1,207 | 11.3 min | 5.3 min |

and on the corpus, where the shape is the clean one:

| Fixture | commits | merges | visible before | visible now | before | now |
|---|---:|---:|---:|---:|---:|---:|
| `21-pull-request-treadmill` | 561 | 43% | 561 | 164 | 150 s | 82 s |
| `22-merge-dense-decade` | 2,401 | 50% | 2,401 | 303 | 10.5 min | 97 s |
| `23-back-merge-decade` | 1,921 | 50% | 1,921 | 1,921 | 8.4 min | 8.4 min |

ripgrep and Svelte are collapsed to the budget either way — a nearly linear history was never the problem — and were not re-measured. The other two land well short of the corpus because a third of their pull requests left the main line long before they were merged back — public-apis' median is sixteen commits and its worst is 888 — and that branch point cannot be hidden unless the ribbon reaches back to cover it. Both are under six minutes now, but the size probe still treats them as dense and **offers a shorter span before anything is fetched**, with the length on the button as an upper bound: sampling the merge ratio of the most recent hundred commits costs one request and separates "large" from "long", but it cannot tell a bubble from a real branch, so it stays pessimistic. Whatever you then pick plays at the legible pace however long it takes, because you picked it. Before any of this, mdBook was silently truncated to four minutes and played at 0.10 s a commit.

`tests/unit/pacing.test.ts` holds it with no exceptions: for every history in the corpus the typical arrival holds the stage for at least a quarter of a second, the fastest tenth stays above the flicker threshold, and arrivals stay under 4.5 a second — and any show that runs past six minutes must have been predicted dense, so nobody arrives at a long one unasked. Fixture `23-back-merge-decade` is the history that cannot be collapsed: 960 merges, none of them a bubble, 8.4 minutes at 0.262 s a commit. Without one that dense the suite only ever tests the comfortable path, which is how the old cap degraded real repositories unnoticed.

Ingestion cost, measured by driving the real interface (`scripts/usertest.mjs`) with a token:

| Repository | Commits | Requests | Load |
|---|---:|---:|---:|
| ripgrep | 2,299 | 34 | 9s |
| vite | 9,670 | 108 | 47s |
| React | 22,345 | 244 | ~2 min |

React's entire history loads with a token, at exact coverage. Aggregation collapses long linear runs and runs of pull requests into counted ribbons so the show stays watchable, and three things keep a very dense project legible rather than a smear: lanes are capped so thousands of short-lived pull-request branches share outer lanes instead of pushing the graph tens of thousands of units tall, the camera will not pull back past a fixed bound and instead stays with the front of the work, and thread names are budgeted so a named branch is labelled while thousands of anonymous ones are not.

## Pre-fetched histories

GitHub gives an anonymous visitor about **60 requests an hour** — a few thousand commits — and a large repository needs hundreds. The obvious fix is to ship a token, and it does not work: the browser has to send it as an `Authorization` header, so anyone who opens the network tab can read it. There is no way to hide a credential in a static site.

So the fetching happens once, in CI, with the token GitHub Actions issues to the job and which never leaves it, and what ships is the **result**. `catalog.json` lists the histories; `scripts/build-catalog.mjs` drives the real interface to produce each one — the same ingestion and the same normalizer as live data, so nothing about the truth model is relaxed — and the landing page offers them as a shelf. Opening one costs **no token and no GitHub requests at all**, which `tests/e2e/catalog.spec.ts` asserts by blocking `api.github.com` outright.

The current shelf is four histories in 1.4 MB, including a year of `public-apis` at 1,796 commits and 781 merges. Adding one is a line in `catalog.json`. The step is best-effort: if a fetch fails, that build simply has no shelf.

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
  fixtures/      synthetic history builder, the demo, the 23-fixture corpus
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

The soundtrack is **real recorded music**, and there are no sound effects at all — nothing is triggered by a commit, a merge or a tag.

It used to be synthesised: a piano piece derived from the repository's own hash, with a small orchestra answering individual events — harp on every commit, woodwind at a branch point, timpani and brass on every merge. Every voice was tied to something true about the history, all of it was measured and spaced against the corpus, and it was still hard to listen to. That is the only test a soundtrack has to pass.

There is no public-domain rock — the genre is entirely inside copyright, composition and recording both — but there is a great deal of freely licensed instrumental music. Three tracks ship, chosen for range:

| Register | Track | For |
|---|---|---|
| frantic | *Volatile Reaction* | a history that never stops moving |
| driving | *Exit the Premises* | steady, sustained work |
| calm | *Chill Wave* | a long, quiet history |

Music by [Kevin MacLeod](https://incompetech.com/), licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). The credit appears in the app's help panel, which is the condition the licence attaches to using it at all.

**The repository picks the register.** `characterOf` measures how much lands per second and how bursty and contested it is; those add, so either can reach the top on its own. A pull-request treadmill lands on *frantic*; a sparse, long-running history lands on *calm*. `tests/unit/score.test.ts` asserts that over every history in the corpus.

**The honest cost.** A recording cannot follow the timeline. It does not accelerate through a busy year and it does not land a cymbal on a merge, because a fixed recording has its own tempo and time-stretching one in a browser sounds worse than the problem it solves. It is a soundtrack over the performance rather than a score of it. The music holds while you scrub and picks up where it left off, rather than being dragged through at pointer speed.

The tracks are fetched at build time rather than committed — twenty megabytes of audio does not belong in a git history — by `scripts/build-music.mjs`, the same way the catalog is built. A build without music is quiet, not broken.
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
