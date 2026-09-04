# ADR 0002 — One package with enforced module boundaries instead of a monorepo

**Status:** accepted · **Affects:** repository structure only

## Context

The specification sketches a monorepo (`apps/web`, `packages/model`, `packages/dag`, …). For a first release maintained by a small team, workspace tooling adds friction without adding safety.

## Decision

Keep a single Vite/TypeScript package whose `src/` directories mirror the proposed packages one-to-one (`model`, `github`, `dag`, `analysis`, `layout`, `choreography`, `renderer`, `audio`, `player`, `export`, `fixtures`, `workers`, `app`). The boundary rules from the specification are kept as conventions and verified by tests: core modules import no DOM APIs (they run in the Worker and in Node), the renderer only reads compiled buffers, the UI contains no graph code, and the GitHub adapter is the only place that knows GitHub's JSON.

Preact + `@preact/signals` replaces React for the shell (same component model, ~4 KB), keeping the bundle at about 60 KB gzipped.

## Consequences

- Extracting real packages later is a mechanical move of directories plus `package.json` files; import paths already use `@/…` aliases per area.
- No Storybook app in this version; the synthetic fixture corpus and `scripts/inspect.mjs` serve as the visual lab.
