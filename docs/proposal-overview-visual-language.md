# Proposal: the branch activity overview looks like a data panel

Status: **chosen and implemented, not published.** Drafted 2026-09-08, after
measuring the existing view and photographing it.

> "It's a bit unfair, because we can't zoom out like we do... and make it
> curvy and extravagant."

That complaint is precise, and it names two missing faculties rather than a
taste: the main graph has a **camera** and it draws **curves**. The overview
had neither. Everything below is about giving it both without touching what
makes it trustworthy.

The invariant numbers referenced throughout are the ones the view is trusted
for: **1** the count equals the number of drawn lines, **2** no invented
topology, **3** nothing drawn before it happens, **4** performance, **5**
MASTER stays prominent.

---

## 1. What is actually wrong

The view is correct. `docs/branch-activity-overview.md` is accurate, the count
matches the lines, and the numbers survive an independent sweep of the packed
index. Photographed at Linux's concurrency peak — 600 threads at 21,213.8 s,
`x/ovshots/before-torvalds-linux-panel.png` — it is two hard-edged rectangles
of near-uniform olive stripes split by a thin ivory rule, with a scatter of
pale dots drifting diagonally across each block.

It reads as a spectrogram. Named specifically:

1. **Every line is the same length.** Each stripe spanned the full canvas
   width regardless of how long its thread had been working, because x carried
   no units — the marker's x was a *fraction* of the thread's interval. The
   picture threw away the one continuous quantity it had, and what is left is a
   grid.
2. **The grid is uniform.** Rows were evenly spaced at `(height-52)/n`, which
   at 600 rows in ~500 px is 0.83 px apart, so the field was a solid tone with
   a hard top edge, a hard bottom edge, and hard left and right edges. Four
   straight boundaries is what makes a picture look like a chart.
3. **Nothing was curved.** 600 `moveTo`/`lineTo` pairs.
4. **Nothing had depth.** Two alternating tints at a flat 0.58 alpha. The
   renderer's own `laneFade` (`canvas.ts`, `NEAR 5 / SPREAD 70 / FLOOR 0.17`)
   exists precisely because 240 lines of equal weight all shout; the overview
   was drawing 600.
5. **There was no camera.** No zoom, no pan, no framing, no easing. The one
   moving thing was a 2×2 px `fillRect` per row.

The dots were the only part that already worked: they formed a diagonal
because progress correlates with start order, and that accident is the seed of
the chosen direction.

## 2. Treatments considered

### T1 — Wave the existing stripes

Displace each stripe with a per-thread sine. Two lines of code.

*Trade-off:* a wavy spectrogram is still a spectrogram. Defects 1 and 2 above
are the load-bearing ones — equal-length rows on a uniform grid — and this
fixes neither. **Rejected**, but worth writing down that it was the cheapest
thing available and would have been mistaken for progress.

### T2 — Convergent fan: curves that leave and land on MASTER

The graph's actual picture, and the best-looking thing on this list. Filaments
sweep out of the ivory spine at their start and swoop back into it at their
end, in the same beziers `drawSettledEdge` uses.

*Trade-off:* it is a lie. **Invariant 2** — the payload is
`{ id, label, start, end }`; there is no parent, no merge target, no branch
point. A curve leaving MASTER asserts "this diverged from main here" and a
curve landing on it asserts "and merged back there", and the second is
frequently false: `branchActivityOf` describes *work in progress*, and a
dormant thread's interval ends at its last commit whether or not it ever
merged. **Rejected on invariant 2**, and the temptation is the reason the
invariant is written down.

### T3 — Radial bloom

Threads as rays from a centre: angle from index, radius from elapsed time.
Maximally abstract, and it would photograph well.

*Trade-off:* a ring implies a cycle, which this data does not have; angular
position is meaningless yet reads as a claim; and **invariant 5** dies — MASTER
stops being a spine and becomes a circle, losing the one shape that ties this
view to the graph. Picking a thread by click also gets much worse.
**Rejected.**

### T4 — Real time axis, with the frontier clip (the plume)

Give x units: performance seconds. Draw each thread's filament from its own
`start` to `min(playhead, end)` — which for every *active* thread is exactly
the playhead. Tails of honest, differing lengths stream back into the past;
every head lands on a single vertical frontier.

*Trade-off, measured:* at whole-history zoom this is unreadable. At Linux's
peak the 600 active tails have a median length of 254 s and an 85th percentile
of 301 s inside a 43,200 s duration — 0.6% of the width. Without a camera all
600 collapse into a six-pixel wall. **So the camera is not decoration here, it
is what makes the time axis legible**, which is a happy coincidence with the
complaint that started this.

Brushes **invariant 3**: the honest reason to clip at the playhead is that the
rest of the interval has not happened. It also *retires* the progress-fraction
marker that `docs/branch-activity-overview.md` describes. That is a real loss
of one fact and a gain of a better one — tail length is elapsed time in
seconds, continuously, instead of a 2 px dot at a fraction. Encoding "how much
of its life is left" in colour was considered and dropped: it would be reading
out the future.

Brushes **invariant 1**: every active filament's head sits on the frontier, and
the camera clamp always keeps the frontier in frame, so every counted thread
always has ink on screen. The count still equals the lines. Long tails run off
the left edge; the *head* never can.

**Chosen.**

### T5 — Lane interleave with depth falloff

Stop splitting the field into a top block and a bottom block by start order.
Alternate threads above and below the spine, lane by lane, like the graph's
lanes, and space lanes on a curve so the first few are far apart and the far
field compresses. Then fade alpha with `|lane|`, a `laneFade` of this view's
own.

*Trade-off:* the far field goes sub-pixel — 300 lanes a side in ~250 px means
the outer lanes sit 0.35 px apart. They become a wash. That is the point (it is
what `laneFade`'s comment argues for: "still *there* … without asking to be
traced individually") but it must be said plainly against **invariant 1**: all
600 lines are still stroked, and the old view was already at 0.83 px, so this
changes the character of the crowding, not whether the count is drawn.

What it buys is the death of all four hard edges and a legible core around the
spine. It also produced the picture's best feature by accident: because rows
arrive ordered by start and lanes are handed out in that order, the left
silhouette of the field is the sorted curve of thread ages — a scalloped nose,
which is the shape of the history's own concurrency.

**Chosen, combined with T4.** The reverse ordering — newest threads nearest the
spine — was built and photographed (`x/ovshots/e-rev1.png`) and **rejected by
eye**: it leaves a dark void either side of MASTER, which is the one place the
picture needs company.

### T6 — Colour carrying something

Contributor colour is impossible without changing the packaging script, which
is another agent's file: the payload has no contributor. Age is available.

*Trade-off, tried and dropped:* a ramp by age is redundant here. Rows are
ordered by start and lanes are handed out in that order, so **age is depth**,
and ramping on both muddied the picture rather than adding an axis.

What shipped instead is the renderer's own encoding: cool above the spine, warm
olive below, washing to a neutral grey with depth — `threadTint`'s "threads
above the spine drift cool, below drift warm". It carries no new information
and it is what makes the view recognisably the same application rather than a
chart of the same data. **Chosen.**

## 3. What was built

x is performance time under a camera that pins the frontier at 0.78 of the
width and eases its visible span towards 1.3× the 85th-percentile active tail,
so the framing opens and closes with the history's own crowding; opening the
view is a deliberate gesture, from 1.9× that span settling in over about a
second. The viewer overrides it with the wheel, a drag, `−`/`+` and **Fit**.

Each thread is one filament from its own start to the frontier, curved by a
per-thread wander with its own phase *and its own wavelength*, over a shared
low-frequency sheet whose amplitude grows with depth so the top and bottom
edges of the whole field breathe. Lanes alternate above and below MASTER on a
compressive lens with a depth falloff to a 0.14 floor. A thread younger than
eight performance-seconds flares, read off its age so a backward seek cannot
make six hundred branches appear to be born at once. MASTER is an ivory spine
with a three-pass bloom and a pulsing head, labelled at that head, drawn last.

y carries no meaning in this view; it is row order. That is what makes both the
wander and its animation free of any claim — **only x is time**. Filaments
cross each other freely for the same reason.

The vertical control is a **lens, not a zoom**: it redistributes the lanes
within the height available and always maps all of them onto it. A vertical
zoom with a pan would be closer to the graph's camera and would let the view
hide lines the header is still promising, which is invariant 1.

## 4. Frame cost

### The drawing core, in isolation

`x/bench/` replays the 600 real active rows from Linux's peak through the same
drawing, with knobs, unthrottled (`--disable-gpu-vsync`). This is where the
design was actually decided:

| | ms/frame |
|---|---|
| flat colour, every stroke width ≤ 1 | **7.0** |
| flat colour, widths 0.6–1.4 | 12.5 |
| flat colour, one single stroke at width 1.0 | 6.4 |
| one `CanvasGradient` per bucket as `strokeStyle` | **61.0** |
| flat colour + one `destination-in` alpha ramp | 17.5 |
| flat colour + one `source-over` scrim | 11.7 |

Two findings ran the design, and neither was the one expected:

- **Stroke count barely matters; stroke width does.** Twenty-four batched
  strokes at width 1.0 cost the same as one (6.4 ms), while the same
  twenty-four at widths spanning 0.6–1.4 cost 12.5 ms. Skia has a fast hairline
  path at or below one device pixel and a slow geometry-expanding path above
  it. So every width in this file is under 1 and depth is carried by alpha.
- **A gradient `strokeStyle` over a path with hundreds of subpaths is
  catastrophic** — nine times a flat colour. The head-to-tail falloff is
  therefore not painted at all. It comes from filament *density*, which
  genuinely thins towards the past, plus two CSS overlays that cost nothing per
  frame. The in-canvas alternatives were both built and both measured: 17.5 ms
  and 11.7 ms against a 7.0 ms floor, out of a 16.7 ms budget.

### The real application

240 real frames while playing, this machine, 1600×1000, Chromium, view open.
"Capped" is what a viewer gets; "free" removes the vsync ceiling so the number
is the actual cost of a frame and shows the headroom.

| | capped median | capped p95 | capped worst | free median |
|---|---|---|---|---|
| Linux, 600 lines — before | 16.5 ms (61 fps) | 26.8 ms | 50.9 ms | 6.6 ms |
| Linux, 600 lines — after | 16.8 ms (60 fps) | 35.5 ms | 66.0 ms | **9.1 ms** |
| Linux, 350 lines — before | 16.6 ms (60 fps) | 25.0 ms | 55.5 ms | 4.8 ms |
| Linux, 350 lines — after | 16.7 ms (60 fps) | 30.2 ms | 55.9 ms | **5.7 ms** |
| Kubernetes, 284 — before | 16.8 ms (60 fps) | 25.3 ms | 47.0 ms | 3.7 ms |
| Kubernetes, 284 — after | 16.6 ms (60 fps) | 22.9 ms | 43.5 ms | **4.3 ms** |

**Invariant 4's gate is ≥ 50 fps median at 350 lines. It is 60.** The extra
0.6–2.5 ms of real work is paid out of headroom and does not reach the median.

### What the tail costs, and it does cost something

The e2e spec measures the *mean* frame rate over 5 s (Kubernetes) and 15 s
(Linux) rather than the median, and that is where the change shows. Measured
like for like, tracing off, the same spec against the previous build and this
one:

| | before | after |
|---|---|---|
| Kubernetes, 284 | 60.1 fps · p99 16.8 ms · worst 16.8 ms | 56.9 / 59.4 / 56.7 fps · p99 33.4 ms |
| Linux, 600 | 59.7 fps · p99 16.8 ms · worst 49.9 ms | 56.4 / 58.5 fps · p99 33.4 ms |

The old view at 284 lines **never dropped a frame** — p99 and worst were both
one vsync interval. The new one drops roughly one frame in a hundred. That is
the honest price of six thousand antialiased hairline segments where there used
to be six hundred straight ones, and it is the curvature itself, not an
accident: in the bench, dropping the segment cap from nine to one saved only
2.3 ms of 12.5, so the cost is in rasterising the strokes, not in computing
them.

Under Playwright's trace recording — which screencasts the page and so loads
the machine the way a weak one would — the reduced headroom is much more
visible: 60.0 → 41.3 fps on Kubernetes and 45.7 → 40.4 on Linux. That number is
not what a viewer gets, but it is the best available proxy for how this will
behave on a slow device, and it is worse than before.

### Tried and measured, kept or dropped on the evidence

- `will-change: transform` on the overlay, to give it its own compositing
  layer: **no measurable change** (58.75 vs 59.2 fps). Reverted.
- Taking `store.time` out of the drawing effect's dependencies, which stops it
  tearing down and re-entering `draw` fifteen extra times a second: **no
  measurable change**, kept anyway because it is plainly correct.
- Not reassigning the canvas backing store unless the size changed, and moving
  the lit ground from the canvas to its wrapper so it is not re-rasterised with
  it: **no measurable change**, kept for the same reason. The old code was
  reallocating and clearing a 3072×1888 buffer fifteen times a second.

### Two process findings worth more than they look

- **Headless Chromium reports `prefers-reduced-transparency: reduce`.** The
  overlays were briefly behind that query, so the first round of screenshots
  showed the view with its falloff switched off, and nothing in the picture
  said why. The query is gone; the overlays are not decoration.
- **A `getImageData` probe placed before a frame measurement invalidates it.**
  The new frontier-clip check in the spec cost Kubernetes 5 fps and Linux 5 fps
  purely by reading the canvas back before the measurement ran — one readback
  is enough for Chromium to stop accelerating that canvas. It now runs after.

## 5. What this does not fix

- **At 600 threads the field is a texture, not six hundred countable lines.**
  300 lanes a side cannot each own a pixel in 250 px. Zoom and the lens open it
  up — that is what they are for — but the default frame of Linux's peak is
  honestly two brushed masses with fine striations in them. The header does not
  claim otherwise, and this is the same limit the old view had, differently
  dressed. Kubernetes at 284 is the density this design is actually good at.
- **The frontier is a hard vertical.** Every active head is at the same x by
  construction, so there is a lit vertical comb at 0.78 of the width. It is
  truthful and it reads as "now", but it is a straight line in a picture whose
  whole brief was fewer straight lines.
- **The tail regression above is real** and I did not get it back.
- **Grouped mode is much plainer than desktop, deliberately.** A group of 27
  threads gets one filament from the group's earliest start, the lens is off so
  the labels keep their 22 px budget, and the overlays are reduced to a light
  on the frontier because the vertical vignette was dimming the outermost two
  labels to unreadable. No amount of curvature makes ten labelled rows on a
  phone look like a performance.
- **No contributor colour.** The obvious next axis, and it needs the packaging
  script.

## 6. Decisions this needs, which are not measurements

1. **Is retiring the progress-fraction marker acceptable?** It is documented
   behaviour in `docs/branch-activity-overview.md`, which is not mine to edit,
   and that document now overstates what the marker does.
2. **Is 0.78 the right frontier position?** More room for tails means less
   empty stage on the right, and the empty stage is the visible statement that
   nothing after now is drawn.
3. **Should the auto-framing breathe at all**, or hold one span? It currently
   follows the crowd, which is the graph's behaviour; a viewer who wants it
   still has Fit and manual zoom.
4. **Is one dropped frame in a hundred worth the curvature?** That is the
   trade, stated plainly, and it is a taste call rather than a measurement.
