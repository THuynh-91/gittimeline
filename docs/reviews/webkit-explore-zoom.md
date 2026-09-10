# Travelling a finished performance changes zoom on WebKit

**Status:** CLOSED 2026-09-10. It was never a WebKit camera fault. It was a
`waitForTimeout(120)` in the test racing the zoom it had just requested. Two
earlier conclusions in this document are wrong; the last section is the answer.
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


---

# Correction: it is flaky, and "closed by the band move" was a bad inference

The section above concluded that moving the head band from 0.62-0.72 to 0.5-0.6
fixed this, on the grounds that CI went green immediately afterwards and the
band was the only application change in between. That reasoning was wrong, and
wrong in a way this document already warns about twice.

It failed again on `9baef5a`, a **documentation-only commit**. `git diff --stat
029d7cd 9baef5a -- src tests` is empty: the application code and the tests are
byte-identical between the run that passed and the run that failed.

And the run list settles it outright. `64e200b` appears twice, **once
`success` and once `failure`, on the same SHA**:

```
9baef5a  failure
e986780  success
64e200b  failure     <-- same commit
64e200b  success     <-- same commit
605cd3c  failure
81c34e5  success
```

So the test is intermittent on Linux WebKit and always was. One green run after
a change is not evidence that the change fixed anything; it is one sample of a
coin that lands green sometimes. Attributing it to the band was the same error
as the three confounded bloom measurements recorded in
`docs/notes/proposal-frame-budget.md` -- a single observation read as a cause.

**What this does and does not mean.** The failure is real when it happens:
`view.scale` reads 0.743 where it should hold 0.286 on a pan at the end of a
performance. It is not a test that is merely slow or racing on a selector. So
there is a genuine intermittent camera fault on WebKit, and the intermittency
is a clue rather than an excuse -- something time-dependent decides whether the
scale is recomputed, which points at `tableauEase`, whose ease runs on real
elapsed time and would therefore land differently depending on how fast the
frames were.

That is the thread to pull, and it is now the strongest lead this document has.

**Not quarantined.** A skipped test on the engine every iPhone and iPad uses
would hide a real fault. Main will show red on some runs until this is fixed,
and the reason is written here.


---

# It was a sleep in the test, and the ratio said so all along

Closed. The application was never at fault, and the number that identified it
had been sitting at the top of this document since it was written:

```
expected  0.2858685046399136
received  0.7432581120637753
```

0.2858685046399136 x 2.6 = 0.7432581120637753, to thirteen significant
figures. **2.6 is the zoom factor the test itself applies**, three lines above
the assertion that failed:

```ts
await page.evaluate(() => window.__gittimeline.zoom(2.6));
await page.waitForTimeout(120);
const zoomed = await page.evaluate(() => window.__gittimeline.viewport!.scale);
```

`zoom` sets the manual camera; `view.scale` picks it up on a subsequent
rendered frame. 120 ms is several frames on a quiet machine and sometimes
fewer than one on a loaded CI runner. When it was fewer, `zoomed` captured the
scale from *before* the zoom, the pans read the scale from after it, and the
assertion failed by exactly one zoom factor.

Which explains all three things this document could not:

| observation | explanation |
|---|---|
| intermittent | it is a race |
| WebKit only | slowest engine in this suite, so the frame the read needed was likeliest to be late |
| never reproduced locally | a quiet Windows machine renders several frames in 120 ms |

Fixed by polling for a scale that has stopped moving instead of sleeping, and
the same treatment applied to the two pans below it, which shared the pattern.
Correct whatever the frame rate, so it cannot return on a slower machine.

## Three wrong conclusions, in order

Worth listing, because the errors were more instructive than the bug:

1. **"A regression from the CI change."** It appeared on the first run that
   could execute WebKit tests at all, so the change that installed WebKit
   looked responsible. Disproved by a branch carrying pre-change source, which
   failed identically.
2. **"Closed by the head-band move."** CI went green right after it and the
   band was the only application change in between. One sample read as a
   cause. Disproved when it failed again on a documentation-only commit.
3. **"A genuine intermittent camera fault, and the intermittency is the clue."**
   Right that it was intermittent, wrong about where; the reasoning went looking
   for time-dependence in `tableauEase` when the time-dependence was in the
   test harness.

Each conclusion was drawn from real evidence and each was wrong, and what
finally settled it was arithmetic on two numbers that had been printed in every
single failure report. The ratio was the whole answer and nobody divided.
