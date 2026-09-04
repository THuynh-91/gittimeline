# Contributing to GitTimeline

Thanks for helping history perform itself. Start with [docs/architecture.md](docs/architecture.md) for the pipeline map and [docs/data-truth.md](docs/data-truth.md) for the rules that never bend.

## Setup

```bash
npm ci
npm run dev                      # http://localhost:5173
npx playwright install chromium  # once, for browser tests
npm run verify && npm run test:e2e
```

## Ground rules (from the specification's decision checklist)

Before opening a pull request, ask:

- Does it preserve every known parent relationship?
- Does it distinguish exact, derived, aggregate, estimated and unknown data?
- Does it keep the primary spine findable?
- Does it represent parallel work as parallel, never serialized for convenience?
- Does it remain deterministic (no `Math.random`, no wall-clock in compiled paths — lint enforces the first)?
- Can it seek without replaying irreversible state?
- Does it have a reduced-motion and a muted equivalent?
- Does it work with partial history and keep the architecture backend-free?
- Is untrusted repository text still rendered as text?
- Is it testable with a small synthetic fixture?
- Does it make the performance clearer, more truthful or more emotionally effective — and create movement beyond paths appearing?

Truth-affecting changes (anything under `src/dag`, `src/analysis`, `src/model/dataset.ts`, the event grammar) need a test and, when they change interpretation, an ADR in `docs/adr/`. Bump the relevant `ENGINE` version in `src/model/types.ts` when compiled output changes.

## Where things live

| Want to… | Look at |
|---|---|
| add a synthetic history | `src/fixtures/corpus.ts` (`Script` helper) |
| change how threads/lanes are chosen | `src/dag/threads.ts`, `src/layout/layout.ts` |
| add or tune an event | `src/choreography/events.ts`, then `renderer/canvas.ts`, `audio/engine.ts`, `app/Panels.tsx` |
| change the camera | `src/choreography/camera.ts` |
| change ingestion or rate-limit behaviour | `src/github/ingest.ts`, `src/github/adapter.ts` (+ `tests/fixtures/mock-github.ts`) |
| change the visual identity | `src/renderer/palette.ts`, `src/renderer/canvas.ts`, `src/app/styles.css` |

## Style

TypeScript strict, ESLint clean with zero warnings, no new runtime dependencies without discussion. Keep repository text hostile: sanitize at the boundary, render as text, cap sizes.

## Pull requests

Describe the visible change, the truth impact (none / derived / structural), and attach a frame or two from `node scripts/inspect.mjs` for visual changes. CI runs lint, types, unit and browser tests.
