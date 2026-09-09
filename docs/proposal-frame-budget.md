# Proposal: buy the frame back from one line of code

**Status:** step 1 implemented and measured 2026-09-08. Steps 2 to 4 open.
**Instruments:** `x/frame-budget.mjs`, `x/glow-cost.mjs`, `x/stage-metrics.mjs`,
`x/bloom-sweep.mjs`, `x/landing-pixels.mjs` (all gitignored).

## The complaint

"It also feels a tad bit laggy." That was reported against the live build and
was answered, correctly but uselessly, with a comparison: 36.6 ms/frame today
against 42.4 ms yesterday, therefore not a regression. Not a regression and not
acceptable are different claims, and only the first one was addressed.

## What the profiler was hiding

The renderer has its own profiler, and for weeks it has reported a comfortable
figure. On `torvalds/linux` at 55%, viewport 1600x900:

```
JS inside render()        5.04 ms
wall frame interval      49.0 ms   (20.4 fps)
unaccounted              43.9 ms   = 90% of the frame
```

`ctx.stroke()` and `ctx.fill()` queue work. They do not wait for a pixel. So a
profiler wrapped around `render()` measures the time spent *describing* the
frame and is blind to the time spent *rasterising* it, which here is nine
tenths of it. Every previous reading of "3.87 ms/frame" was that blind spot.
The number was accurate and answered a question nobody was asking.

`x/frame-budget.mjs` measures both, by taking frame intervals from
`requestAnimationFrame` timestamps alongside `renderProfile.ms.total`, and
reporting the difference as its own line.

### A count that was being read wrong

The figure "14,540 active edges" has appeared in this project's notes as a
per-frame density. It is not. `renderProfile.counts` accumulates across the
profiling window and is only meaningful divided by `frames`. The real density
at the same point is **363 active edges per frame**, with 25 settled edges and
19 nodes drawn. 363 x 40 frames is 14,520, which is where the figure came from.

This matters for the direction of the fix. Fourteen thousand objects per frame
is a problem of object count, and the answer would be culling or batching.
Three hundred and sixty-three objects taking 44 ms is a problem of *overdraw*:
too many pixels touched too many times, by too few objects. Those have
different solutions, and the project has been carrying the wrong one.

## The attribution

Four arms, same seek, same viewport, each in its own browser, from
`x/glow-cost.mjs`. Nothing in `src/` was edited; the arms are installed as init
scripts that redefine `CanvasRenderingContext2D.prototype` members, and quality
is moved by reporting four cores, which is the `chooseQuality()` threshold for
`reduced`.

| arm | ms/frame | fps | p95 | saved |
|---|---|---|---|---|
| ships | 49.0 | 20.4 | 66.7 | |
| `filter` forced to `none` | 28.1 | 35.6 | 33.4 | **20.9 ms (43%)** |
| glow never composited back | 20.4 | 49.0 | 33.4 | 28.6 ms (58%) |
| whole glow pipeline off | 18.5 | 54.0 | 33.3 | 30.4 ms (62%) |

Read down the column:

- **The blur filter alone costs 20.9 ms/frame.** That is `ctx.filter =
  'blur(6px)'` at `canvas.ts:2509`. One assignment, 43% of the frame.
- **The composite costs a further 7.7 ms.** One `drawImage` of a half
  resolution canvas under `lighter`.
- **Filling the glow layer costs at most 1.9 ms.** All those extra strokes into
  the offscreen buffer, the thing that looks expensive, are nearly free.

The cost is concentrated in the one place that had never been measured, and
absent from the places that had been optimised. `edgeDetail` and the comment
above it at `canvas.ts:2460` describe careful work reducing per-edge gradient
and stroke cost, on the reasoning that "this is where the time on the graphics
card goes". The measurement says it does not.

## Why blur() is this expensive

Canvas2D `filter` is not the GPU blur it looks like. In Chromium it resolves to
a Skia image filter applied to a bitmap the size of the draw, on the raster
thread, every frame. A 6 px Gaussian over a 1600x900 surface is millions of
weighted samples that no shader is helping with. It is charged per pixel per
frame and does not care that only 363 strokes went in.

The `blur(30px)` second pass at `canvas.ts:2525` is guarded by `shopWindow`, so
it is the landing page paying for it rather than a performance. It should be
measured separately before anything is claimed about it.

## Proposal

### 1. Replace the filter with a downsample-upsample bloom

This is how bloom is normally done and it uses no filter at all. Bilinear
upscaling *is* a blur, performed by the sampler for free:

1. Draw `this.glow` (already half resolution) into a second, much smaller
   canvas. The downsample is a box filter, done by the sampler.
2. Draw that small canvas back onto the stage at full size with
   `imageSmoothingEnabled = true`. The upscale is the blur.

Blur radius becomes a choice of downsample ratio rather than a filter argument.
Roughly, drawing back from 1/8 of stage size approximates `blur(6px)`; the
`shopWindow` pass wants something nearer 1/32. Two `drawImage` calls on small
surfaces replace a full-surface software convolution.

Expected: the 20.9 ms goes, most of it. The `no-blur` arm already measured
where that lands: **35.6 fps, p95 33.4 ms**. The remaining composite is
unchanged, so this does not reach the 49.0 fps of the `no-comp` arm.

**Risk: the picture changes.** A box-then-bilinear spread is not a Gaussian. It
is softer at the centre and squarer at the edges, and at aggressive ratios it
can show blockiness on a bright isolated stroke. The bloom is not incidental
decoration here, it is most of how the stage looks, and one change to it has
already been rejected. So this is not shippable on a frame-time argument alone.

**Acceptance:** a side-by-side of the same seek on the same repo, plus the
lit-pixel and band-brightness measurements already established for this
(the earlier taper work recorded "brightest branch band", "stage mean", and
"lit pixels from 6.13% to 4.01%"). Same instrument, same thresholds. If the
numbers move more than a few percent, tune the ratio rather than shipping it.

### 2. Only rebuild the bloom when it changed

Untested, and second because it needs the first to be worth having. The glow
layer is cleared and refilled every frame. Its contents are a function of the
active edges and the camera, both of which change every frame during playback,
so there is probably nothing to reuse. But while **paused**, which is where a
viewer reads the stage and where a seek leaves them, nothing changes at all and
the whole pipeline could be skipped in favour of the last composite.

Cheap to try, and it makes the paused stage free rather than 49 ms a frame.

### 3. Persist the earned quality

`Renderer.qualityEarned` steps down when the device cannot sustain the current
level, and it is renderer-local. Every reload starts optimistically at whatever
`chooseQuality()` says and rediscovers the same limit, which means the first
seconds after every load are the worst seconds. Storing it, or storing a
measured frame time to seed it, removes that.

Note this is *not* a lost user preference. There is no quality control in
Settings, by the deliberate choice recorded at `Panels.tsx:303`, so `boot()`
overwriting the stored `quality` at `controller.ts:2969` is a redundant write
and not a bug.

### 4. Then re-measure, and only then look at the strokes

With the glow pipeline entirely off the frame is still 18.5 ms, against a
16.7 ms budget at 60 Hz. So there is a second problem behind this one, and it
is worth roughly a tenth of what the first one is worth. Do not start here.

The open question for that pass is whether cost tracks the active edge count or
the pixels they cover, which the current data cannot answer because it was all
taken at one seek. **Next experiment:** the `ships` and `reduced` arms at a
sparse point and a dense one, so cost can be plotted against
`edgesActive/frame`. Until that exists, any claim about the strokes is a guess.

## What this does not touch

No topology, no timing, no clock, no layout. The proposal changes how light is
spread over strokes that are already drawn where they are already drawn.
"Nothing is drawn before it happens" is unaffected, and so is determinism: the
downsample ratio is a constant, not a sample of anything.

## Order

1. Measurement is already in the tree (`x/frame-budget.mjs`, `x/glow-cost.mjs`).
   Keep them, because the profiler on its own is misleading and has misled.
2. Downsample-upsample bloom behind the existing look tests, with the pixel
   comparison as the gate. Expected 20.4 to 35.6 fps.
3. Skip the pipeline while paused.
4. Persist earned quality.
5. Re-measure. Plot cost against active edges at two seeks before proposing
   anything about the strokes.


---

# Results of step 1

Implemented as a four-level mip chain at 1/4, 1/8, 1/16 and 1/32 of the stage,
halving at each step, with the bloom read back from 1/8 and 1/16 under
`lighter`. No `ctx.filter` remains in the renderer.

## Pacing, `torvalds/linux`, 1600x900

| | before | after | |
|---|---|---|---|
| **dense, 55%** | | | |
| fps | 25.6 | **32.7** | +28% |
| mean frame | 39.1 ms | 30.6 ms | |
| p95 frame | 50.0 ms | **33.4 ms** | one whole vsync |
| frames over 33.4 ms | 43% | **10%** | |
| **sparse, 10%** | | | |
| fps | 22.8 | **26.7** | +17% |
| frames over 33.4 ms | 67% | **37%** | |

The share of frames missing two vsyncs is the number that matters for the
complaint. "Laggy" is not a mean, it is variance, and 43% to 10% is the
difference between a stage that hitches every other frame and one that mostly
holds 30.

Note the sparse case: 101 active edges ran *slower* than 363 did, before and
after. A per-pixel cost does not care how few strokes went in, which is the
overdraw diagnosis confirmed from the other direction.

## The picture, on paused frames at fixed clocks

| where | lit % | stage mean | brightest band | p99 luma |
|---|---|---|---|---|
| dense 55% | +0.5% | +0.3% | +0.6% | |
| landing 2 s | 0.0% | 0.0% | 0.0% | 0.0% |
| landing 6 s | +1.0% | +0.8% | +3.8% | +2.1% |
| landing 12 s | +0.9% | +0.7% | +1.9% | +1.7% |
| sparse 10% | +5.7% | +2.9% | +2.4% | |

Deterministic: a second run of the landing measurement was identical to the
digit, so these are signal rather than noise.

Shipped at that. The deltas are small, they are all in the brightening
direction, and the one prior objection to a change here was to a version that
*dimmed* the brightest band 32%. The trend -- larger where the stage is sparser
-- is the mip taps holding peaks better than a Gaussian on isolated strokes.

## Two measurement errors worth keeping

**The pixel comparison was confounded by the thing it was gating.** The first
version of `x/stage-metrics.mjs` read pixels after its 240-frame pacing run, so
the two builds were photographed 9.6 s and 7.5 s into the history and the
difference in content was reported as a 46% brightening of the bloom. What
exposed it was `x/bloom-sweep.mjs` scaling the bloom alpha to **zero** and
still seeing the "brighter" frame. Pixels are now read on a paused frame at an
exact clock, before playback.

**A conclusion drawn with the broken instrument is still void.** Moving the
taps from 1/4 and 1/8 down to 1/8 and 1/16 was measured as "no change" and
kept anyway on the sigma argument. That measurement was confounded, so whether
the deeper pair is better remains **untested**. It is the first thing to
re-measure if the brightening ever matters.

## Two tests were wrong, and not because of this change

Running the render-sensitive specs turned up four failures in
`tests/e2e/present.spec.ts` that reproduce on `eef06d6` without any of this.
Both encode behaviour the owner deliberately reversed in `655909d`, and neither
was re-run at the time:

- *ink reaches past three quarters of the width* -- asserts the 0.82 head band.
  The band is 0.62 by request. Measured after the revert: 62.3%, 67.8%, 62.7%.
  Rewritten to assert the head clears 0.58 and the eighth twelfth carries ink,
  with the decision recorded in the file so it is not "fixed" again.
- *the MAIN chip stays on screen* -- asserts a plate floor. `PLATE_FLOOR` is 0
  by request, twice given. Rewritten to assert the chip is on the line for its
  window (present 1-4 s, gap to ink 16-20 px) **and absent afterwards**, since
  a floor is a one-character change and has twice been restored by reviewers.

55 of 55 chromium specs pass across `demo stage present clock fallback muted
explore narrow`, plus lint and 193 unit tests.

---

# The ladder's dead space does not prevent oscillation

Written down on review of my own change, before any test reported, because the
argument in `6151584`'s message is wrong and the commit is not pushed yet.

That message claims the gap between the descent threshold (`frameEma >= 0.06`)
and the climb threshold (`frameEma <= 0.02`) is "dead space, so a device at the
boundary settles rather than flickering". The two conditions are indeed
mutually exclusive **at any one instant** — that part is fine, and it does stop
a single frame from satisfying both.

It does not stop oscillation, because a rung change moves the frame time
*discontinuously across the dead space*. Stepping `dpr` from 2 to 1 quarters
the pixel count, and the cost here is per-pixel — that is the whole finding of
this document. So a device sitting at 65 ms with two device pixels can land at
18 ms with one. 65 ms satisfies the descent test; 18 ms satisfies the climb
test. Nothing in the dead space was ever visited.

The sequence, concretely:

1. Sustained 65 ms frames, `slowShare` climbs past 0.7, EMA over 0.06. Step
   down. `dpr` 2 to 1.
2. Frames are now 18 ms. `fastShare` climbs past 0.9, EMA under 0.02.
3. 120 frames later the climb fires. `dpr` back to 2.
4. Frames are 65 ms again. 30 frames later, back to step 1.

Period is at least 150 frames, so about two and a half seconds at 60 fps and
longer when the slow half is genuinely slow. That is not a subtle wobble; it is
the picture visibly changing resolution every few seconds, forever, on exactly
the mid-range device the ladder exists to help.

The dead space is the right idea applied to the wrong quantity. It guards
against noise in the *measurement*; it cannot guard against a real
discontinuity in the *thing measured*.

## What actually closes it

Make each climb cost more evidence than the last, and stop climbing after a
few. A device that genuinely improved — plugged in, other tabs closed — climbs
on its first or second attempt and stays. A device whose two rungs straddle the
thresholds spends its budget in the first minute and then holds the lower rung,
which is the old one-way behaviour and therefore no worse than before this
change.

Concretely: `sinceStep >= 120 << climbsSpent` (120, 240, 480 frames) with a cap
of three climbs per page load. Persistence still means a returning visitor
starts at the rung the device earned, and a fresh load grants a fresh budget,
so nothing is permanently stuck on the strength of one bad minute.

Untested as written. A subagent is attacking the current version for exactly
this, and its answer should be read before this is treated as settled — the
sequence above is reasoning, not a measurement, and this project has a
documented habit of reasoning that survived until someone measured it.
