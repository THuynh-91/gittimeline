# Travelling a finished performance changes zoom on WebKit

**Status:** CLOSED 2026-09-09, incidentally, by moving the head band to the
middle of the frame. Was pre-existing and WebKit only. Kept because the cause
was never actually identified and it could return.
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


---

# Closed, by accident, and the cause is still unknown

CI went green on `029d7cd`. The only application change between the last run
that actually executed tests with this red (`f0dc69d`) and the green one is the
head band:

```diff
-      const lo = Math.min(this.width * 0.62, ...);
-      const hi = Math.max(lo + 40, Math.min(this.width * 0.72, ...));
+      const lo = Math.min(this.width * 0.5,  ...);
+      const hi = Math.max(lo + 40, Math.min(this.width * 0.6,  ...));
```

That change was made for an unrelated reason -- the owner reported that holding
the eye at 60-70% across a whole performance is tiring -- and it happens to
have fixed this. Everything else in between was workflow YAML.

**So the defect is gone and the mechanism was never found.** That is worth
saying plainly rather than closing this quietly, because a bug fixed by a
number moving is a bug that can come back when the number moves again, and
this particular number has now been set four times: 0.6-0.7, 0.82-0.9,
0.62-0.72, 0.5-0.6.

The shape of it is at least consistent with what was seen. The failure was
`view.scale` reading 0.743 where it should have held 0.286, a factor of 2.6, on
a pan at the end of a performance. Both the old band edges (0.62, 0.72) sit
right of centre and the correction only ever pushes the head to the *near*
edge, so at 0.62 the camera was working harder against the frame than at 0.5.
A re-fit that had headroom at 0.5 and none at 0.62 would produce exactly this:
deterministic, engine-specific, and invisible on the engines with faster
frames.

Unverified. If the band ever moves right again, run `explore.spec.ts` on
WebKit in CI before assuming it is still fine.
