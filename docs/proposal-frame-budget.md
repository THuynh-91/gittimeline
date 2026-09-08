# Proposal: buy the frame back from one line of code

**Status:** proposed, not implemented. Measured 2026-09-08.
**Instruments:** `x/frame-budget.mjs`, `x/glow-cost.mjs` (both gitignored).

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
