# GitTimeline

**Paste a public GitHub repository URL and watch its real commit history perform itself.**

### → [thuynh-91.github.io/gittimeline](https://thuynh-91.github.io/gittimeline/)

No sign-up, no install. There is a **Play demo** button if you would rather not
paste anything, and a shelf of twelve large histories — Linux, Chromium, LLVM —
that open with no GitHub requests at all.

GitTimeline is a static, open-source web app. There is no backend. The browser
reads public history from GitHub's REST API, rebuilds the honest commit DAG,
compiles it into a performance — layout, beat map, choreography, camera plan —
inside a Web Worker, and plays it on a Canvas stage.

> The repository is the score, the DAG is the stage, contributors are the motion.

## What you are looking at

- **The bright ivory line** is the default branch's first-parent history, held
  dead straight so the main line is unmistakable at any zoom.
- **Slate paths** are real threads: ancestry that diverged where the graph
  diverges and merged where a merge commit says so. Nothing is invented.
- **Moving sparks are people.** A contributor's colour and glyph travel
  *through* the structure and never recolour it.
- **Merges are as big as the work they absorbed.** Two commits converging is a
  small ring; twelve is a wall of light with one spoke per incoming parent and
  the count written beside it. The beat before a heavy merge hangs; the beats
  after it race away.
- **Dashed grey is history that was not loaded.** It is labelled and never
  filled in.
- **A thick ribbon** is an exact aggregate of many known commits, with the
  count on it — "31 merged branches · 74 commits".
- **The calendar leads.** The repository's own month and year advance as the
  show plays: quiet years spin past in under a second, busy weeks slow down and
  fill the stage.
- **Threads carry their own names**, pinned to the newest commit each has
  landed. A thread whose branch no longer exists is labelled honestly as
  `thread 07` rather than given an invented name.

The camera is a director, not a follower: intimate on calm linear work, pulling
back for splits, tracking convergence, pushing in at impacts, and framing the
final tableau.

## Run it locally

```bash
npm ci
npm run dev        # http://localhost:5173
```

Everything lives in the URL hash, so static hosting needs no routing:

| Parameter | Meaning |
|---|---|
| `#repo=owner/name` | open a repository |
| `&tip=<sha>` | pin the tip so a shared link never drifts |
| `&t=12.5` | start position, in performance seconds |
| `&seed=…` | deterministic seed for aesthetic variance |
| `&autoplay=1`, `&gallery=1` | start playing / hide the chrome and loop |
| `#demo=1` | the built-in demo, no network required |
| `&rm=1`, `&renderer=poster` | reduced motion / force the static SVG fallback |

**Keyboard.** `Space` play/pause · `←/→` step a beat · `Shift+←/→` landmarks ·
`↑/↓` walk the active threads · `Home/End` · `M` sound · `C` camera (free look
→ follow at your zoom → auto) · `?` help · `Esc` close.

Zoom out with the wheel, then press `C`: the performance keeps playing and keeps
that wider view instead of springing back.

## Twelve histories ship, whole

GitHub gives an anonymous visitor about 60 requests an hour, and a large
repository needs hundreds. The obvious fix is to ship a token, and it does not
work: the browser has to send it as an `Authorization` header, so anyone who
opens the network tab can read it. **There is no way to hide a credential in a
static site.**

So the fetching happens once, ahead of time, and what ships is the *result*.
Opening one costs no token and no GitHub requests, which
`tests/e2e/catalog.spec.ts` asserts by blocking `api.github.com` outright.

It is not done through the API. `scripts/build-clone-dataset.mjs` clones:

```
git clone --bare --filter=tree:0    # commit objects only; no source code transferred
git log  --format=...               # the whole graph, in one pass
```

The difference is not incremental. Linux is 1,481,850 commits, which is 14,819
API requests — hours of waiting and three times an authenticated user's hourly
allowance. The clone takes about four minutes, `git log` reads the entire graph
out of it in fourteen seconds, and the git protocol has no REST rate limit to
spend. `--filter=tree:0` is what keeps it cheap: commit objects and nothing
else, so none of the repository's source is ever downloaded. The shape of the
history is all this project needed.

| | commits | | | commits |
|---|---:|---|---|---:|
| chromium/chromium | 1,817,062 | | python/cpython | 133,027 |
| torvalds/linux | 1,481,850 | | nodejs/node | 48,272 |
| llvm/llvm-project | 595,778 | | facebook/react | 21,678 |
| rust-lang/rust | 339,084 | | public-apis/public-apis | 5,272 |
| tensorflow/tensorflow | 198,583 | | rust-lang/mdBook | 3,293 |
| microsoft/vscode | 164,682 | | kubernetes/kubernetes | 140,858 |

Nearly five million commits, and not one API request to obtain them. The result
is normalized by `buildDataset` — the same function the browser calls on live
data, loaded through Vite so it cannot drift into a second implementation — so
nothing about the truth model is relaxed.

For your own large repository, supply a free **fine-grained token** with
read-only public access. It stays in memory for that tab only, goes solely to
`api.github.com`, and is never written to storage.

See **[docs/length-and-density.md](docs/length-and-density.md)** for how long a
show runs, why density rather than size decides whether a history can be shown
whole, and the measured ingestion costs.

## Truth model

Every displayed commit is a real commit or an explicitly labelled aggregate.
Every edge comes from a parent relation. Divergences and merges happen only
where ancestry says so. Concurrent work is spatially concurrent. Missing
history is shown as unknown, never fabricated. Historic branch names are never
guessed.

Coverage — exact, partial or unknown — is visible in the top bar and in the
**What am I seeing?** panel. See [docs/data-truth.md](docs/data-truth.md).

## Sound

The soundtrack is **real recorded music**, and there are no sound effects at
all — nothing is triggered by a commit, a merge or a tag.

It used to be synthesised: a piano piece derived from the repository's own
hash, with a small orchestra answering individual events. Every voice was tied
to something true about the history, all of it was measured against the corpus,
and it was still hard to listen to. That is the only test a soundtrack has to
pass.

Three of Kevin MacLeod's Creative Commons rock tracks ship, chosen for range:
*Ready Aim Fire* (172 bpm) for a history that never stops moving, *Riptide*
(128 bpm) for steady work, *Cold Funk* (112 bpm) for a long quiet one. The
repository picks the register: `characterOf` measures how much lands per second
and how bursty and contested it is, and `tests/unit/score.test.ts` asserts the
choice over every history in the corpus.

`scripts/build-music.mjs` checks each pick against the catalog's own genre
metadata and **fails the build** if a track is not actually rock. The first
attempt shipped by title alone and got it badly wrong: *Volatile Reaction* is
filed under Soundtrack and described by its own composer as "blasting brass,
pounding percussion... suitable for fights, evil". It sounded like a war film
because it was one.

**The honest cost.** A recording cannot follow the timeline. It does not
accelerate through a busy year and it does not land a cymbal on a merge,
because a fixed recording has its own tempo and time-stretching one in a
browser sounds worse than the problem it solves. It is a soundtrack over the
performance rather than a score of it.

Music by [Kevin MacLeod](https://incompetech.com/), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The credit appears
in the app's help panel, which is the condition the licence attaches to using
it at all. The tracks are fetched at build time rather than committed — twenty
megabytes of audio does not belong in a git history. A build without music is
quiet, not broken.

## Privacy

The deployed site counts page views with Google Analytics. It is configured
without Google Signals or ad personalisation, and it refuses to load at all if
your browser sends Global Privacy Control or Do Not Track. A build with no
measurement ID configured loads no analytics script and sets no cookie, and the
sign-in page prints which of the two it is rather than describing an intent —
`tests/e2e/readouts.spec.ts` asserts the page and the build agree.

A GitHub token you supply is never written to storage. `localStorage` holds
exactly two keys: your settings, and the render quality the device earned.

## Layout

```
src/
  model/         canonical types, hashing, seeded PRNG, sanitization, dataset normalizer
  github/        URL parsing, REST adapter (ETag, rate limits, retries), IndexedDB cache
  dag/           graph index, causal timestamps, primary spine, thread decomposition
  analysis/      contributors, activity and eras, exact aggregation
  layout/        lanes, splines, arc-length sampling
  choreography/  performance clock, event grammar, camera director, compile pipeline
  renderer/      Canvas2D stage renderer, SVG poster fallback, palette
  audio/         playback of the recorded score
  player/        playback clock, worker client
  export/        share links, .gittimeline artifacts
  fixtures/      synthetic history builder, the demo, the 23-fixture corpus
  app/           Preact UI (store, controller, stage, timeline, panels)
tests/unit       Vitest — invariants, property tests, mocked GitHub, artifacts
tests/e2e        Playwright — motion, keyboard, mocked GitHub flows, fallbacks
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run verify` | type-check, lint, unit tests, production build |
| `npm test` | unit tests |
| `npm run test:e2e` | browser tests (needs `npx playwright install`) |
| `npm run build` / `npm run preview` | static build to `dist/` / serve it |
| `node scripts/build-clone-dataset.mjs owner/repo` | clone a repository and build its artifact, no API requests |
| `node scripts/index-artifacts.mjs` | assemble the catalog index and a card frame per history |

CI runs lint, type-check, unit tests and the browser suites on **Chromium,
Firefox and WebKit**.

## Documentation

- [Architecture](docs/architecture.md) — API record to rendered frame, module boundaries, worker split
- [Data truth](docs/data-truth.md) — provenance classes, what Git can and cannot prove, aggregation rules
- [Choreography](docs/choreography.md) — clocks, tempo, event grammar, effect budget, camera states
- [Length and density](docs/length-and-density.md) — how long a show runs and why
- [Reading the stage](docs/reading-the-stage.md) — what every mark on screen means
- [Testing](docs/testing.md) — invariants, fixtures, property tests, browser suites
- [Accessibility](docs/accessibility.md) — keyboard, reduced motion, no flashes, screen readers, contrast
- [Deployment](docs/deployment.md) — how the site is built and published
- [ADRs](docs/adr/) — material deviations from the original specification, and why

Contributions are welcome as pull requests — see
[CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through
[SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). Visual design is original; the rhythmic
path-reading idea takes only conceptual inspiration from rhythm games.
