# Travelling a finished performance changes zoom on WebKit

**Status:** open, pre-existing, WebKit only. Dated 2026-09-09.
**Test:** `tests/e2e/explore.spec.ts:12` — "a slider appears when the
performance ends and pans without changing zoom".

## What happens

Panning with the travel slider after a performance ends changes the
magnification, which is the one thing that test exists to forbid. Linux WebKit
in CI:

```
expect(right.scale).toBeCloseTo(zoomed, 5)
  Expected: 0.2858685046399136
  Received: 0.7432581120637753
```

A factor of 2.6. Bit-identical across three separate CI runs, so it is
deterministic rather than a timing flake.

## It is not new, and that took a deliberate experiment to establish

This spec is pinned to `chromium`, `firefox` and `webkit`, and until
2026-09-09 `ci.yml` installed **only Chromium** while running all three
projects — so every Firefox and WebKit test failed in three or four
milliseconds on a missing executable and nothing on WebKit had ever actually
run. The first CI run that could reach this test found it red, which looks
exactly like a regression from the change that fixed the installer.

It is not one. A throwaway branch carrying application source from `8673504`
(before any of that day's work) together with the fixed `ci.yml` fails the same
test with the same numbers. That branch fails *more*: `explore.spec.ts:41`,
"the slider is keyboard operable and reports where it is", also fails on the
baseline and passes on `main`.

So the sequence of that day's changes left WebKit's explore behaviour better
than it found it, and this one remains.

It also does not reproduce on this machine. The same spec passes on WebKit
locally on Windows and in CI on Chromium and Firefox. Linux WebKit in CI is
the only place it has been seen, which is a real audience — WebKit is Safari,
and Apple requires every browser on iOS and iPadOS to use it.

## What is known and what is not

Known: deterministic, WebKit only, predates 2026-09-09, and the scale ends up
about 2.6x the value it should hold.

Not known: whether the camera is re-fitting or the pan handler is recomputing
scale from a stale viewport, and whether 2.6 is meaningful or coincidence. The
`safe` insets were briefly suspected because the travel slider is added to
`.band` and the band grows to hold it; that turned out to be a different and
real defect (a `ResizeObserver` feedback loop, fixed in `f0dc69d`) whose
removal left these numbers bit-identical. So the insets are ruled out.

## Where to start

The trace is the fastest route and CI keeps it:

```
npx playwright show-trace test-results/explore-travelling-the-fin-3826f--pans-without-changing-zoom-webkit/trace.zip
```

Read `explore.spec.ts:12` first — `zoomed` is captured before the pan, so the
question is what writes `view.scale` between capture and assertion. Suspects,
in order: the tableau ease (`tableauEase`, which holds `cx`/`cy`/`fit` and runs
on real elapsed time), and `zoomLocked` not being honoured on the WebKit path.

Until then `main` is red on this one test, deliberately and with this note
rather than by being quarantined, because a skipped test on the engine every
iPhone uses is worse than a red tick that says what is wrong.
