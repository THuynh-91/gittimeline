# Accessibility

Accessibility is part of the visual language, not a cleanup pass.

## Keyboard

Every function is reachable without a pointer. `Space` play/pause (outside text fields), `←/→` step by beat / commit / second (Settings), `Shift+←/→` previous/next landmark, `↑/↓` walk the threads active at the playhead (announced), `Home/End`, `PageUp/PageDown` on the timeline, `M` mute, `C` auto/manual camera, `R` reduced motion, `E` events, `I` what am I seeing?, `?` help, `Esc` close/clear. Focus rings are always visible (`:focus-visible`), including when the chrome auto-hides in gallery mode (hover/focus reveals it). The browser test `fallback.spec.ts` tabs through the player and asserts every button has an accessible name.

## Non-canvas equivalence

- The stage `<canvas>` has an `aria-label` summarizing the repository (commits, threads, merges, coverage) and points to the Events panel.
- The **Events** panel is a synchronized semantic stream (type, historical date, provenance, caption) with the current event marked `aria-current`; each entry seeks on activation. A "show every commit" switch expands it to all steps.
- A polite live region announces significant events (birth, divergences, merges, tags, eras, present) and thread selection; commit-by-commit steps are not announced to avoid noise.
- The timeline is a `role="slider"` with `aria-valuetext` giving both clocks; hovering/focusing shows a bucket tooltip with honest measures (unavailable measures are omitted, never shown as zero).
- The transcript export (Markdown) is a complete textual account of the performance.

## Motion, flashes, sound

- `prefers-reduced-motion` is honoured on first visit and can be toggled with `R` or in Settings. Reduced motion keeps every event but replaces comets with steady reveals and markers, removes pops, ripples, breathing, dust drift, camera push-ins and roll, slows the camera spring and caps the tempo.
- **No flashes** removes the impact flash and lowers bloom; the remaining transitions are luminance-bounded rings.
- **High contrast** switches the spine to pure white, brightens thread paths and UI text.
- Sound is optional: full mute (`M`), separate effects/ambience levels, three dynamic-range presets, a limiter. Audio starts only after a user gesture. Nothing is conveyed only by sound; captions name significant cues.

## Colour

Structure is encoded by weight, continuity and luminance (ivory spine, slate threads, dashed unknown), not hue. Contributor signatures combine an OKLCH hue pushed apart from neighbours **and** a glyph shape (orb, diamond, triangle, square, ring, star, hex, cross) — the shape can be disabled for a plain look but is on by default. Bots use a grey square with a dotted trail. UI text meets WCAG contrast on the ink background; the high-contrast theme raises it further.

## Touch and motor

Hit targets are 34–44 px; pan/zoom use drag and pinch but nothing is drag-only (buttons and keys cover every action); the timeline supports tap-to-seek and Shift-drag ranges; `touch-action: none` on the stage prevents accidental page scrolls while seeking.
