# ADR 0003 — Quantize and lay out in natural time, then scale to the target duration

**Status:** accepted · **Affects:** deterministic compilation (structure-preserving)

## Context

The specification asks for a user-selected target duration (30/60/90/180 s or natural), a bounded tempo model, beat quantization, and stable layout. Quantizing after scaling made geometry depend on the chosen duration, so the same repository would draw differently at 30 s and 90 s and a share link with a different `dur` would not look like the same performance.

## Decision

`src/choreography/clock.ts` computes natural step intervals, builds the tempo map and beat grid in natural seconds, quantizes there (honouring causal, thread-spacing and approach reserves), and only then scales every impact by one factor to fit the target duration. `src/layout/layout.ts` maps x from natural time, so node positions, lanes and curves are identical for every duration; only playback speed (and therefore perceived BPM) changes. The scale is bounded (never slower than 1.7× natural, non-gap steps ≤ 3.4 s, steps ≥ 70 ms, BPM ≤ 200) so tiny histories end early instead of crawling and huge ones stay readable.

## Consequences

- Share links with different `dur` values show the same shapes; `tests/unit/compile.test.ts` asserts identical node coordinates across durations.
- Perceived tempo can exceed the nominal region for very short targets; the tempo regions are presentation choices, not claims about repository speed.
- Reduced motion uses larger minimum steps and a lower tempo cap on the same natural timeline.
