# ADR 0001 — Canvas2D is the primary renderer (no WebGL in v0.1)

**Status:** accepted · **Affects:** presentation only (not factual interpretation or deterministic compilation)

## Context

The specification recommends WebGL2 (PixiJS or a custom layer) with a Canvas2D fallback. This build had to deliver a polished, verified end-to-end performance first, and anonymous GitHub ingestion realistically yields a few thousand commits at most.

## Decision

Implement one carefully authored Canvas2D renderer (`src/renderer/canvas.ts`) with quality tiers (full: bloom pass on a half-resolution layer, comet trails, ripples; reduced; minimal), viewport culling, per-edge bounds, and a static SVG poster fallback (`src/renderer/poster.ts`). The renderer consumes only immutable compiled buffers, so a WebGL backend can be added later behind the same `CompiledPerformance` contract without touching Git semantics.

## Consequences

- Legible, restrained visuals at 60 FPS for the histories the anonymous API can deliver; measured on the demo and a ~2 000-commit synthetic fixture.
- Very large precomputed artifacts (hundreds of thousands of nodes) would need the WebGL path; today they are aggregated (`aggregateAbove`) and culled instead.
- The fallback ladder is: Canvas2D full → reduced → minimal → SVG poster + event list → transcript.
