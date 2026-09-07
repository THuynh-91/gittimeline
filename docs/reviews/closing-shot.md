# The closing tableau at HEAD (`ddac384`)

**Verdict: PARTIALLY FIXED — the last commit is now on screen in all 12 packaged entries (24/24 measurements), but "frames the whole history" is false in all of them: the closing frame is 2,600–3,009 world units, i.e. 0.0073%–2.04% of the history, because the new guard falls back to the `MAX_FRAME_W` clamp that the comment block directly above it was written to remove.**

Two of the three things the claim asserts are true and measured. The headline one is not.

| claim | result |
|---|---|
| the last commit is on screen | **CONFIRMED FIXED** — on screen at 70.7% across in every entry, every viewport |
| the transition is a move, not a cut | **CONFIRMED FIXED** — 0.05x–3.54x the median dolly, no frozen run (was 4,336x plus 364 still frames) |
| the tableau frames the whole history | **CONFIRMED STILL BROKEN** — 2,600–3,009 units of 137,706–41,371,440 |
| the un-windowed case is unaffected | **CONFIRMED CLEAN** — demo and pasted URL still frame their whole bounds exactly |

---

## The twelve entries, t = duration, 1440x900, paused and settled

`source.slug` asserted on every row (printed in the table); `worldW`/`cx` from `window.__gittimeline.view`; history width and last-commit x computed **offline** from `.catalog-release/` and matched to the browser to the last decimal.

| entry (`source.slug`) | history width | closing frame `worldW` | % of its history | frame centre to last commit | in frame-widths | right edge to last commit | last commit on screen | at % across | nodes/frame | edges/frame |
|---|---|---|---|---|---|---|---|---|---|---|
| rust-lang/mdBook | 137,705.99 | **2,600** | **1.8881%** | 537.93 | 0.207 | 762.07 | yes | 70.69% | 18 | 26 |
| nodejs/node | 147,157.16 | **3,008.65** | **2.0445%** | 622.48 | 0.207 | 881.84 | yes | 70.69% | 14 | 18 |
| chromium/chromium | 249,125.24 | **2,600** | **1.0437%** | 537.93 | 0.207 | 762.07 | yes | 70.69% | 7 | 8 |
| public-apis/public-apis | 265,896.31 | **3,008.65** | **1.1315%** | 622.48 | 0.207 | 881.84 | yes | 70.69% | 20 | 34 |
| llvm/llvm-project | 269,529.39 | **2,600** | **0.9646%** | 537.93 | 0.207 | 762.07 | yes | 70.69% | 7 | 7 |
| facebook/react | 489,942.97 | **3,008.65** | **0.6141%** | 622.48 | 0.207 | 881.84 | yes | 70.69% | 18 | 19 |
| python/cpython | 2,670,445.25 | **3,008.65** | **0.1127%** | 622.48 | 0.207 | 881.84 | yes | 70.69% | 18 | 23 |
| tensorflow/tensorflow | 5,238,880.5 | **3,008.65** | **0.0574%** | 622.48 | 0.207 | 881.84 | yes | 70.69% | 18 | 32 |
| microsoft/vscode | 5,725,956 | **3,008.65** | **0.0525%** | 622.48 | 0.207 | 881.84 | yes | 70.69% | 16 | 22 |
| kubernetes/kubernetes | 14,028,401 | **3,008.65** | **0.0214%** | 622.48 | 0.207 | 881.84 | yes | 70.69% | 20 | 31 |
| rust-lang/rust | 27,114,742.22 | **3,008.65** | **0.0111%** | 622.48 | 0.207 | 881.84 | yes | 70.69% | 20 | 38 |
| torvalds/linux | 41,371,440 | **3,008.65** | **0.0073%** | 622.48 | 0.207 | 881.84 | yes | 70.69% | 21 | 41 |

Also on every row: `camera.state = "tableau"`, `camera.w = 2600` (the compiled cue, clamped), `camera.x` = the midpoint of the whole history (mdBook 68,956.29; kubernetes 7,211,157.17; linux 20,759,984.96), `manualCamera = false`, `zoomLocked = false`, `render.counts.rescuedCues = 0`, `buffering = false`.

**Nothing is capped at 16,000 any more at this size.** The two widths above are `MAX_FRAME_W = 2600` (width-bound entries) and the height clamp re-expressed as width (`safeH/MAX_FRAME_H` = `694/1500` → 3,008.65). The 16,000 floor is never reached — see §2.

Vertically the shot *is* complete: `worldH` is 1,296–1,500 against per-entry geometry heights of 261–1,308, so 115%–496% of the lane spread is in frame. The failure is entirely horizontal.

---

## 1. CONFIRMED — the fallback is the `MAX_FRAME_W` clamp, i.e. the bug the comment above it says it fixed

`applyCamera` (`src/renderer/canvas.ts:912`; the guard at `1008-1048`) computes the whole-bounds shot, rejects it when `wide < floor`, and then falls back to `fit = Math.min(safeW / cue.w, safeH / cue.h)`. `cue.w` in the tail is `2600` for all twelve entries — `camera.ts:341` clamps the zoom integrator's state to `log(MAX_FRAME_W)` *after* the tail sets `tw` to the full bounding box, which is the original defect. So the fallback shot is exactly the clamped shot:

- measured `worldW` = 2,600.00 (width-bound entries) / 3,008.65 (height-bound entries);
- the comment block at `canvas.ts:933-984` states the fixed behaviour as *"mdBook 137,222 units — 11.7% in frame — 151 nodes, 204 edges"*. Measured at HEAD: **1.89% in frame, 18 nodes, 26 edges**. That table no longer describes this build.
- the earlier bug it condemns is described as *"every history wider than 2,600 units has always ended on a shot of a small piece of itself"*. That is again true, of all twelve.

Relative to the previous QA pass at `38ce3c8`, history coverage went **down**: mdBook 11.6% → 1.89%, public-apis 6.0% → 1.13%, chromium 6.4% → 1.04%, kubernetes 0.11% → 0.0214%.

## 2. CONFIRMED — the `wide >= floor` branch is unreachable for every entry on the shelf

`floor = safeW / 16000`; `wide = min(safeW / w, safeH / h)` with `w >= (maxX-minX) * 1.06 + 80`. `wide >= floor` therefore requires `w <= 16000`, i.e. a history no wider than `(16000 - 80) / 1.06 = 15,018` units. The narrowest published history is mdBook at 137,706 units — 9.2x too wide. The widest is Linux at 41,371,440 — 2,754x too wide.

So on a streamed plan the guard is not a decision, it is a constant `false`: `bounds` is never taken, and 24/24 measurements confirm it (`view.cx` is never the bounds midpoint; it is always `lastCommitX - 288/scale`, the head-band position). The only code path that can take `bounds` on a windowed plan is one no packaged entry can reach.

## 3. CONFIRMED — the premise ("the floor refuses more than the 16,000 units that are resident") is wrong twice over

**(a) A 16,000-unit closing frame is full, not empty.** At `t = duration`, taking the camera by hand and pulling back to the floor the streamed plan allows (`x/qa6/manualzoom.mjs`, same settled protocol):

| entry | director's shot | manual pull-back to the floor |
|---|---|---|
| rust-lang/mdBook | `worldW` 2,600 → 18 nodes, 26 edges | `worldW` **16,000 → 86 nodes, 120 edges** |
| torvalds/linux | `worldW` 3,008.65 → 21 nodes, 41 edges | `worldW` **16,000 → 71 nodes, 109 edges** |

4.8x and 3.4x the geometry, from pages that were already resident (`nodeX.length` 404, and 747 → 930) after the fetch band refit to ±16,000. The shot the guard rejects as unshowable is showable and populated; the shot it falls back to is 6.2x narrower than that.

**(b) 16,000 is not the residency limit.** The fetch band is `[x-width, x+width]` with `width = min(MAX_FETCH_WIDTH = 48000, …)`, and the worker clamps to `min(48000, …)`. Measured resident band at the closing frame: 35,193–62,294 units wide, of which 5,958–5,960 units is real history behind the newest commit (the rest lies past the end of the history). The frame shows 43.6%–54.4% of that loaded history at 1440x900. `MAX_VIEW_WIDTH = 16000` is a display constant, not a statement about what is loaded — and `controller.ts:282` still says the worker clamps width to `[6000, 16000]`, which is stale by 3x.

## 4. CONFIRMED — 29% of the closing frame is empty stage to the right of the newest commit

The head-band exemption is written as `const head = bounds ? null : this.spineTip(t)` — it applies only when the bounds framing was taken, which on a streamed plan is never (§2). So the 60–70% band runs *during* the tableau, which is the composition the comment at `canvas.ts:1077-1080` says must be avoided ("Two rules composing into a shot neither of them asked for").

Measured consequence: `right edge → last commit` is 762–882 units of a 2,600–3,009 unit frame = **29.3%** of the closing frame's width at 1440x900 (29.6% at 2400x700 and 2400x420, 28.9% at 900x600), and there is no geometry there — the plan's `bounds.maxX` is 40 units past the last commit. Independent pixel confirmation (`drawImage` → `OffscreenCanvas` → `getImageData`, 240x120, lit pixels per column, summed into 12 buckets):

- rust-lang/mdBook streamed: `28 35 34 33 31 27 23 21 15 5 0 0` — ink ends at column 182/240 (75.8%), last two buckets exactly zero.
- kubernetes streamed: `36 33 29 33 30 37 25 29 16 2 0 0`; torvalds/linux: `64 51 44 59 43 33 33 30 14 3 0 0`.
- the un-windowed control of the same repository fills the frame instead: `8 18 20 19 19 16 20 20 20 18 17 11`, ink from column 11 to 234.

## 5. CONFIRMED — the tableau is not a distinct shot; it is the previous frame, held

From the per-frame recordings (`x/qa6/transition.mjs`, 1440x900, 16–20 fps headless):

| entry | `worldW` on the frame `state` turns tableau | `worldW` at t = duration | widening | total &#124;dcx&#124; over the whole tableau |
|---|---|---|---|---|
| rust-lang/mdBook | 2,525.9 | 2,600 | +2.9% | 15.1 units over 111 frames |
| chromium/chromium | 2,360.7 | 2,600 | +10.1% | 48.5 over 120 |
| public-apis | 2,694.8 | 3,008.6 | +11.6% | 70.2 over 106 |
| torvalds/linux | 2,661.0 | 3,008.6 | +13.1% | 67.3 over 101 |
| kubernetes | 2,425.8 | 3,008.6 | +24.0% | 188.2 over 112 |

The camera neither pulls back nor moves: the "closing tableau" is the preceding tracking shot plus a 3–24% widen, held still for 3.2 s. Meanwhile the compiled cue travels 68,000 (mdBook) to 20.6M (Linux) units toward the midpoint underneath it — mdBook's `camera.x` goes 137,498 → 136,154 → 132,818 → … → 68,956 while `view.cx` moves 0.5 units a frame. The head-band correction absorbs the entire compiled tail.

### The transition itself: a move, not a cut (this part is fixed)

Per-frame `|dcx|` across the frame where `state` becomes `tableau`, against the median of the preceding frames of the same run:

| entry | frames in the "preceding" window | median &#124;dcx&#124; | &#124;dcx&#124; on the switch frame | **ratio** | max &#124;dcx&#124; within ±5 frames | `camera.x` jump on the same frame | zero-run after |
|---|---|---|---|---|---|---|---|
| chromium/chromium | 200 | 77.43 | 22.20 | **0.29x** | 62.6 | −2,463 | 0 frames |
| kubernetes/kubernetes | 182 | 50.58 | 2.35 | **0.05x** | 217.6 | −780,946 | 0 |
| public-apis/public-apis | 161 | 57.39 | 126.05 | **2.20x** | 126.0 | −2,907 | 0 |
| rust-lang/mdBook | 183 | 50.45 | 178.38 | **3.54x** | 178.4 | −1,344 | 0 |
| torvalds/linux | 165 | 66.16 | 90.05 | **1.36x** | 179.1 | −1,751,123 | 0 |

Against the previous pass's 68,251 units in one frame (4,336x median) followed by 364 consecutive frames at `|dcx| = 0.00`, this is a different mechanism entirely: the largest single-frame move anywhere near the switch is 217.6 units, 8.6% of the frame's width, and no frame is frozen. Note the two figures side by side — the *cue* jumps by up to 1.75 million units on the switch frame while the *view* moves 90; the head band is what makes it a move.

## 6. CONFIRMED — the frame width is set by the window's shape, not by the history

Same entry, four viewports (all `t = duration`, settled, slug asserted):

| entry | 1440x900 | 2400x700 | 900x600 | 2400x420 |
|---|---|---|---|---|
| rust-lang/mdBook | 2,600 (1.89%) | 6,071.5 (4.41%) | 2,757.6 (2.00%) | 14,015.6 (**10.18%**) |
| kubernetes | 3,008.65 (0.0214%) | 7,141.7 (0.0509%) | 3,243.7 (0.0231%) | **16,000** (0.114%) |
| torvalds/linux | 3,008.65 (0.0073%) | 7,141.7 (0.0173%) | 3,243.7 (0.0078%) | — |
| chromium | 2,600 (1.04%) | 4,818.6 (1.93%) | 2,600 (1.04%) | — |
| public-apis | 3,008.65 (1.13%) | 7,141.7 (2.69%) | 3,243.7 (1.22%) | — |

mdBook's coverage of its own history varies **5.4x** with window shape (1.89% → 10.18%) while the history is identical. And the 16,000 cap *is* still live: it binds once the safe area's aspect exceeds `16000/MAX_FRAME_H = 10.67:1` (kubernetes at 2400x420: `safeW/safeH = 2352/214 = 11.0`, `worldW = 16,000.00` exactly). At that one shape the answer is the `38ce3c8` answer again — 16,000 units — except that it is now aimed at the ending rather than at the midpoint (last commit at 70.6% across, 96 nodes/frame). Nodes per frame track the width, as they should: 7–21 at 1440x900, 41–45 at 2400x700, 96 at 2400x420.

## 7. CONFIRMED — comments that no longer describe the code

Read as asked; three of these are load-bearing for the claim.

- `canvas.ts:933-984` — the measured table it presents as the fixed state ("11.7% in frame", "16,000 world units whatever the history is", "151 nodes, 204 edges") describes neither `38ce3c8` behaviour nor HEAD behaviour. HEAD is 1.89% / 2,600 / 18 nodes on the same entry.
- `controller.ts:1950-1958` — "When the performance ends the director frames the whole history at once" is false for all twelve packaged entries.
- `controller.ts:282` — "the worker clamps it to [6000, 16000]": the worker clamps to `[6000, 48000]`, and `MAX_FETCH_WIDTH` is 48,000.
- `MAX_VIEW_WIDTH = 16000` (`src/export/catalogPackage.ts:6`) is exported and referenced **only inside comments**; `canvas.ts` hardcodes the literal `16000` three times (lines 917, 1009, 1048). Changing the constant would silently not change the renderer.

## SUSPECTED (reasoned, not measured)

- A closing shot of ~16,000 units aimed at the ending needs no new packaging: the fetch band is already fitted to the live viewport (`windowRequest`) and refits within one round trip, which is what the manual pull-back in §3 demonstrated — but I demonstrated it with the *manual* camera, not with the director's. The measurable risk is a frame or two of missing geometry on the frame the widening lands.
- A genuinely whole-history closing frame would need a decimated overview page, as the comment says. Nothing here contradicts that; the measurements argue against the 2,600-unit fallback, not against that diagnosis.
- The head band is the right rule for the tableau while the shot is narrow and the wrong one as it widens: the void it leaves is a fixed 29% of the frame, so a wider honest shot wants the head nearer the right edge. Not measured — no build exists with both.

## Checked and found clean

1. **The un-windowed path is not broken by the guard.** `floor = 0`, `wide >= 0`, bounds taken, exactly as before.
   - `#demo=1` (177 commits, `gittimeline/A generated history`, no `perf.window`): `worldW = 17,056.80` = `(bounds width) * 1.06 + 80` to the digit, `cx = 7,967.93` = bounds midpoint exactly (`cx − midpoint = 0.00`), **177/177 nodes and 201 edges drawn per frame**. Note it exceeds 16,000 — proof the floor is not applied without a window.
   - Pasted URL, `#repo=acme/widget` against the app's own mock (`tests/fixtures/mock-github.ts`, loaded through vite SSR; 1,400 generated commits → 1,631 loaded, 61,476 units of geometry): `worldW = 65,329.13` = `bounds * 1.06 + 80`, `cx = 30,766.69` = midpoint exactly, all 410 plan nodes and 410 edges drawn.
   - Un-windowed **control on a real 137,706-unit history**: mdBook opened with its `.pages` package withheld, so the app falls back to the monolithic precompiled plan. `worldW = 146,048.35` = `137,705.99 * 1.06 + 80`, `cx = 68,812.99` = bounds midpoint, **1,220 nodes and 1,653 edges per frame** — 68x the streamed closing frame of the same repository at the same viewport. The guard's rejection is the only difference between those two rows.
2. **No wrong frame is ever drawn during the seek.** Recording every frame from before the seek through settled (`x/qa6/flash.mjs`): while `buffering = 1` the stage holds the *previous* frame (`cx = 133.16`, `state = convergence`, render skipped by design), and the first frame drawn after the page lands is already the final `cx = 137,088.06`. No midpoint flash, no empty frame.
3. **The frame never shows unloaded geometry.** `frameLeft − window.minX` is positive in all 24 measurements (+1,685 to +4,123 units), and the fetch band refits to the frame width.
4. **Browser and offline agree exactly.** For all twelve: the compiled tail cue `camera.x` matches `sampleCamera` run offline over `.catalog-release` to `0.0e+0`, `camera.w = 2600` both ways, and `max(nodeX)` matches the last commit's x decoded from the published node page (e.g. linux 41,371,358.39 both ways).
5. **The bytes measured are the published bytes.** Every page was served verbatim from `.catalog-release` and the worker's own SHA-256 check against the manifest index passed for all twelve entries — it throws otherwise — including the index resource itself.
6. **No rescued cues, no manual camera, no zoom lock, no span** in any director measurement: the tableau path was reached as written.
7. **Reproducible.** mdBook 1440x900 re-run cold: `worldW = 2600`, `cx = 137088.05896551724`, 108 nodes / 156 edges over 6 frames — identical to the first run, digit for digit.
8. **The only console error in any run** is `net::ERR_FAILED` on `music/index.json`, caused by my own audio gag. No page errors from the app anywhere, in 30 browser sessions.
9. **Silence.** `--mute-audio`; `HTMLMediaElement.prototype.play` verified in-page as `function () { return Promise.resolve(); }`; `**/music/**` aborted (the single attempt was recorded and failed); no `<audio>`/`<video>` element present; `music = null`. Nothing could have made a sound.

## Killed on re-measurement (kept, per instruction)

- **"The landing demo's closing shot is 807 units wide and 83,023 units from the midpoint of its own history."** True as a number and worthless as a finding: on the landing route `renderer.shopWindow` is true (`controller.ts:556`) and `applyShopWindow` returns from `applyCamera` *before* any tableau code runs (`canvas.ts:932`). The landing demo cannot exercise this claim at all, in either direction. Re-measured on the real stage via `#demo=1`, where it is clean (above). Any probe that measures "the demo" from the landing page is measuring the shop window.
- **Pixel ink profiles are only diagnostic on the streamed frames.** The lit-pixel threshold is relative (`min + max(6, (max−min) * 0.12)`), and on the very wide un-windowed frames the topology is a hairline that falls under it while a bright label does not: `#demo=1` reads as "ink in columns 229–233" despite drawing all 177 nodes. Node and edge draw counts are the reliable measure there, and no un-windowed conclusion above rests on pixels.

## Method

- Build and server: `npx vite build`, then `npx vite preview --port 4181 --strictPort` from the repo root; everything measured against `http://localhost:4181`. Port 4173 untouched; the project's Playwright suite was never run. Nothing written outside `x/qa6/` (plus the sanctioned `dist/` build output).
- Streamed shelf, offline and byte-exact: `page.route('**/catalog/*.pages/*')` serves `.catalog-release/<slug>.pages/<file>` verbatim — `application/json` for the manifest, `application/octet-stream` otherwise, no content-encoding, so the worker's SHA-256 check stays meaningful. `api.github.com` aborted everywhere except the pasted-URL probe, which routes it to `mockGitHub`.
- Silence, three independent gags: Chromium launched with `--mute-audio`; an init script replacing `HTMLMediaElement.prototype.play` with a resolved promise; `**/music/**` aborted. Verified in-page (clean §9).
- Every geometry number comes from a **paused, settled** frame: `pause()`, wait for `buffering === false`, 1,000 ms of wall clock, re-check `buffering`, then three `requestAnimationFrame`s. Counts come from `render.enabled = true; render.reset()`, three more frames, divided by `render.frames`.
- Every measurement re-asserts what is loaded: `x/openentry.mjs` for the click-through, a second `source.slug` assertion inside the measurement payload, and a third against the card id afterwards. Every row above carries its own `source.slug`.
- Pixels only ever via `drawImage` into an `OffscreenCanvas` and `getImageData` (240x120). No `page.screenshot` and no `toDataURL`, anywhere.
- Offline truth: `x/qa6/offline.mjs` reads each `.catalog-release/*.pages/manifest.json`, gunzips the resource index, and decodes the published node pages and the final time page through `src/export/performance.ts` (loaded in Node via vite SSR, the way `scripts/profile-static-plan.mjs` does it), reporting whole-history bounds, the last commit's x, and the tail cues sampled with the app's own `sampleCamera`. Results in `x/qa6/offline.json`.
- Caveats: the headless frame rate was 16–20 fps, so per-frame dolly magnitudes are frame-time dependent — the transition figures are therefore reported as ratios against the median of the same run. The published *remote* shelf could not be compared: `gitdance-data.cruxpack.io` answers 404 (HTML) for both `index.json` and a manifest, and the live base URL is a deploy-time repository variable, so `.catalog-release/` is the authority here, as instructed.
- Build provenance, checked because the tree moved under me. `git status` at the start of this session showed no modified tracked files, and my build ran at 21:34:30, so **the bundle measured is HEAD exactly**. Between 21:47:51 and 21:53:45 another process edited five files (`src/renderer/canvas.ts`, `src/app/Panels.tsx`, `src/app/SignIn.tsx`, `tests/e2e/clock.spec.ts`, `tests/e2e/helpers.ts` — an unrelated frame-rate/quality-degradation feature plus UI and type-declaration changes) and rebuilt `dist/` at 21:54:47, which is **after my last measurement at 21:53:04** and produced a different bundle (`index-a8JbI4yt.js` against my `index-DTJU30qG.js`). Even had that build been served mid-window it would not matter here: `git diff -U0 src/renderer/canvas.ts` puts every hunk at HEAD lines 18, 102, 236, 564, 573–583, 1355, 1704 and 2206, while `applyCamera` occupies 912–1105 and `usableCue` (871), `rescueCue` (890), `spineTip` (1107), `spineHead` (1157) and `applyShopWindow` (735) are all outside every hunk — nothing the claim concerns differs by a byte. The mdBook 1440x900 measurement taken at 21:38:09 and repeated at 21:53:04 agreed digit for digit, which is the empirical form of the same statement. All line numbers cited in this report are HEAD's; `camera.ts`, `controller.ts`, `catalogPackage.ts` and `catalog.worker.ts` were untouched throughout.
- Files: `x/qa6/lib.mjs` (rig, settle, measure), `x/qa6/tableau.mjs` (per entry and viewport), `x/qa6/transition.mjs` (per-frame play-in), `x/qa6/unwindowed.mjs` (demo, pasted URL), `x/qa6/manualzoom.mjs` (§3), `x/qa6/flash.mjs` (seek transient and audio evidence), `x/qa6/offline.mjs` with `offline.json`, `x/qa6/table.mjs` with `table.json`, raw payloads in `x/qa6/results/`.

---

# Re-measurement at `8330fbe` — "Frame the closing shot on the history that is actually in hand"

**Verdict: PARTIALLY FIXED. The shot is right — 16,000 world units, hung off the ending, the newest commit at exactly 95.00% across in all 48 measurements, 50–143 nodes a frame against 18 before — and the transition into it is now a cut: 87x–176x the median dolly in one frame, plus a 5.4x–6.6x one-frame zoom step, followed by 97–127 frames at `|dcx| = 0.00`. The shot has been traded for the cut.**

Measured on a clean tree at `8330fbe` (`git status` showed only the three stray PNGs), rebuilt at 22:19:16 into bundle `index-XP88mhLg.js`, served by my own `vite preview` on 4181. Same harness, same muting, same paused-and-settled protocol. 48 settled measurements (twelve entries × four viewport shapes) plus 2400x300, six per-frame transition recordings, five un-windowed cases, two cache probes.

## 1. Closing frame `worldW`, `cx`, per cent of history — 1440x900

`worldW` is **16,000.00 for all twelve**, and `cx` is **`lastCommitX − 7,200` to the last decimal in every case** — exactly `maxX − width/2` with `maxX = headX + 800`. The formula does precisely what it says.

| entry | history width | closing `worldW` | % of its history | `cx` | frame centre to last | right edge to last | last commit at | nodes/frame | edges/frame | prev n/f |
|---|---|---|---|---|---|---|---|---|---|---|
| rust-lang/mdBook | 137,705.99 | **16,000** | **11.619%** | 130,425.99 | 7,200 | 800 | 95.00% | 140 | 195 | 18/26 |
| nodejs/node | 147,157.16 | **16,000** | **10.8727%** | 139,877.15 | 7,200 | 800 | 95.00% | 109 | 146 | 14/18 |
| chromium/chromium | 249,125.24 | **16,000** | **6.4225%** | 241,845.24 | 7,200 | 800 | 95.00% | 50 | 51 | 7/8 |
| public-apis/public-apis | 265,896.31 | **16,000** | **6.0174%** | 258,616.31 | 7,200 | 800 | 95.00% | 142 | 224 | 20/34 |
| llvm/llvm-project | 269,529.39 | **16,000** | **5.9363%** | 262,249.39 | 7,200 | 800 | 95.00% | 50 | 50 | 7/7 |
| facebook/react | 489,942.97 | **16,000** | **3.2657%** | 482,662.97 | 7,200 | 800 | 95.00% | 116 | 151 | 18/19 |
| python/cpython | 2,670,445.25 | **16,000** | **0.5992%** | 2,663,165.25 | 7,200 | 800 | 95.00% | 129 | 183 | 18/23 |
| tensorflow/tensorflow | 5,238,880.5 | **16,000** | **0.3054%** | 5,231,600.29 | 7,200 | 800 | 95.00% | 124 | 185 | 18/32 |
| microsoft/vscode | 5,725,956 | **16,000** | **0.2794%** | 5,718,675.75 | 7,200 | 800 | 95.00% | 116 | 159 | 16/22 |
| kubernetes/kubernetes | 14,028,401 | **16,000** | **0.1141%** | 14,021,120.56 | 7,200 | 800 | 95.00% | 131 | 203 | 20/31 |
| rust-lang/rust | 27,114,742.22 | **16,000** | **0.059%** | 27,107,462.22 | 7,200 | 800 | 95.00% | 143 | 226 | 20/38 |
| torvalds/linux | 41,371,440 | **16,000** | **0.0387%** | 41,364,158.39 | 7,200 | 800 | 95.00% | 127 | 185 | 21/41 |

Larger than both previous attempts, and for the first time larger *and* aimed at the ending: attempt 1 (`38ce3c8`) was 16,000 centred on the midpoint of the whole history; attempt 2 (`ddac384`) was 2,600–3,009 at the ending; this is 16,000 at the ending. Coverage recovered from 1.89% to 11.62% on mdBook and from 0.0073% to 0.0387% on Linux.

Worth knowing: `worldW` is decided by the **cap**, not by the resident span, for every entry on the shelf. The narrowest `wanted` of the twelve is llvm's (resident span 39,621 → 42,078 units); the widest is Linux's (524,322 → 555,842). All are 2.6x–35x the cap, so the only inputs that survive into the horizontal shot are `headX` and `MAX_VIEW_WIDTH`. The resident-span logic decides the width only for un-windowed plans.

## 2. Where the newest commit sits, and the empty stage to its right

**95.00% across, with 800 units — 5.0% of the frame — beyond it.** Identical in all 48 settled measurements, at every viewport shape, on every entry. Pixels agree: lit-pixel columns now run to 233–237 of 240 (97–99%) where they stopped at 182–184 (76%) before the change, so the dark right margin fell from ~24% of the canvas to ~2%.

One fragility, narrow but real. `smoothedPunch` multiplies the *scale* and not the *box*, so during the punchy first second of the tableau the frame is `16,000 / punch` wide while its centre stays at the box midpoint. That puts the head at

    headFrac = 0.5 + 0.45 * smoothedPunch

which leaves the frame as soon as the smoothed punch exceeds **1.1111**. Measured maxima over 663 recorded tableau frames: react **0.9992** (11 world units of margin, about one screen pixel), kubernetes **0.9989**, chromium 0.9964, linux 0.9905, public-apis 0.9771, mdBook 0.9631. Nothing went off screen. But the compiled tableau cues carry punch up to **1.1178** (kubernetes), 1.1065 (react) and 1.0956 (chromium) — kubernetes is *above* the threshold, and the only reason its head stayed in frame is that the punch smoothing (`k = 1 − exp(−dtReal · 14)`) lags the cue at the 16–20 fps this harness runs at. A machine tracking the cue more closely would put kubernetes's newest commit off the right edge for a few frames. CONFIRMED as measured (on screen in every frame recorded); SUSPECTED as a failure at higher frame rates.

## 3. Nodes and edges drawn on the closing frame

50/50 to 143/226 per frame, against **18/26** at the previous HEAD and **86/120** for the hand pull-back to the same 16,000 units. The hand pull-back drew fewer than the director now does because it kept the old centre — head at 70% — so a third of that frame lay past the end of the history; hanging the box off the ending buys another 60% of geometry at the same width.

| entry | 1440x900 n/f | 2400x700 n/f | 900x600 n/f | 2400x420 n/f | worldW (all four) | lastAt (all four) |
|---|---|---|---|---|---|---|
| rust-lang/mdBook | 140/195 | 140/194 | 142/196 | 140/194 | 16,000 | 95.00% |
| nodejs/node | 109/146 | 108/144 | 110/147 | 108/144 | 16,000 | 95.00% |
| chromium/chromium | 50/51 | 50/51 | 50/51 | 50/51 | 16,000 | 95.00% |
| public-apis/public-apis | 142/224 | 141/223 | 144/226 | 141/223 | 16,000 | 95.00% |
| llvm/llvm-project | 50/50 | 49/49 | 50/50 | 49/49 | 16,000 | 95.00% |
| facebook/react | 116/151 | 116/149 | 117/152 | 116/149 | 16,000 | 95.00% |
| python/cpython | 129/183 | 128/182 | 130/185 | 128/182 | 16,000 | 95.00% |
| tensorflow/tensorflow | 124/185 | 123/184 | 125/186 | 123/184 | 16,000 | 95.00% |
| microsoft/vscode | 116/159 | 115/158 | 117/160 | 115/158 | 16,000 | 95.00% |
| kubernetes/kubernetes | 131/203 | 130/201 | 132/205 | 130/201 | 16,000 | 95.00% |
| rust-lang/rust | 143/226 | 142/226 | 145/230 | 142/226 | 16,000 | 95.00% |
| torvalds/linux | 127/185 | 126/183 | 128/189 | 126/183 | 16,000 | 95.00% |

Node counts are within 1.5% across all four viewport shapes for every entry, which is the signature of a world-space box: the same geometry is in frame whatever the window looks like.

## 4. The transition — CONFIRMED REGRESSION: it is a cut

Per-frame recordings, playing into the tail at 1440x900. `|dcx|` on the frame `state` becomes `tableau`, against the median of the preceding frames of the same run:

| entry | frames in the preceding window | median &#124;dcx&#124; | &#124;dcx&#124; on the switch frame | **ratio** | `worldW` before → after | zoom step | frames at &#124;dcx&#124; = 0.00 after |
|---|---|---|---|---|---|---|---|
| rust-lang/mdBook | 200 | 38.97 | **6,874.02** | **176.4x** | 2,527.2 → 15,546.7 | 6.15x | 114 |
| kubernetes/kubernetes | 194 | 48.01 | **6,666.21** | **138.9x** | 2,413.1 → 14,928.5 | 6.19x | 117 |
| torvalds/linux | 200 | 52.71 | **6,566.14** | **124.6x** | 2,640.6 → 14,983.7 | 5.67x | 106 |
| public-apis/public-apis | 159 | 57.27 | **6,831.23** | **119.3x** | 2,726.8 → 15,193.0 | 5.57x | 97 |
| chromium/chromium | 200 | 77.29 | **6,732.93** | **87.1x** | 2,349.7 → 14,503.6 | 6.17x | 126 |
| facebook/react | 190 | 0.45 | **2,451.77** | **5,396.1x** | 2,170.8 → 14,422.6 | 6.64x | 97 |

It is one frame in every case, and it is both a dolly and a zoom: mdBook `f239 → f240` moves `cx` 137,300.0 → 130,426.0 and `worldW` 2,527.2 → 15,546.7, against `dcx` of 38.5 and 52.3 on the two frames before it. After it, `cx` is *exactly* constant for the rest of the performance — that is the run of zeros; the shot is genuinely held and only the punch decay moves `worldW`, 14,504 → 16,000 across the tableau.

Structurally this is the `38ce3c8` signature again — one large jump into a static hold — at one tenth the distance (6,874 units against 68,251) and toward the right place. The previous HEAD had 0.05x–3.54x and no cut, because the head-band correction moved the camera by half a unit a frame and absorbed the cue's own jump. Nothing smooths `bounds`: it is written straight into `this.view.cx/cy`.

React's 5,396x is the same cut measured against a nearly frozen 190-frame baseline (median 0.45 units) — its camera was already parked before the tail, so the ratio is arithmetically large rather than forty times worse than the others; the absolute jump, 2,452 units, is the smallest of the six.

SUSPECTED remedy, not measured: `rescueCue` already has the right shape a few lines above — an exponential approach with `k = 1 − exp(−dtReal · 2.4)` that collapses to a cut when `dtReal` is zero, which is what a seek looks like. Running the tableau box through the same filter would glide into the closing shot in about half a second and keep the instant snap on a seek, which §"clean" item 3 below shows is what is wanted there.

## 5. The un-windowed paths — CLEAN in substance, slightly different in the numbers

All three still frame their whole history, with every node in the plan drawn:

| case | commits | node span | `worldW` | check | `cx` | last node at | nodes/frame | edges/frame |
|---|---|---|---|---|---|---|---|---|
| `#demo=1` | 177 | 15,935.85 | 16,972.00 | `= span·1.06+80` | 8,298.45 | 95.00% | 177 (all) | 201 |
| pasted URL `#repo=acme/widget` (mock) | 1,631 | 61,475.78 | 65,244.33 | `= span·1.06+80` | 32,144.63 | 95.00% | 410 (all) | 410 |
| mdBook with its `.pages` withheld (monolithic plan) | 3,293 | 137,625.99 | 145,963.55 | `= span·1.06+80` | 71,942.39 | 95.00% | 1,220 | 1,653 |

No `perf.window`, so no cap: the demo's 16,972-unit frame is deliberately *wider* than `MAX_VIEW_WIDTH`, which is the proof the floor is not being applied to a whole plan.

Two honest differences from before, both consequences of the rewrite rather than faults: the shot is now hung off the right-hand end rather than centred (last node at 95.00% instead of 96.7–97.2%, so `cx` moved +330 on the demo, +1,378 on the pasted repository and +3,129 on the monolithic mdBook), and the width comes from the node span instead of the padded bounds, which makes it 0.1–0.5% narrower (mdBook 146,048.35 → 145,963.55). The whole history is in frame in all three.

## 6. `tableauBox`'s cache key — sound, with one hole that is unreachable in practice

**Answer: no, a window swap cannot leave a stale box.** `perf.window.key` is `` `${id}:${planHash}` `` where `id` comes from `++this.serial` in `CatalogSource`, which increments for every `prepare` *and* every `warm`. So within one opened entry any change of resident set necessarily arrives with a key that has never been seen, and the other four components are belt and braces.

Measured (`x/qa6/cachekey.mjs`, one browser session, no reload):

| visit | resident nodes | firstX | headX | `cx` | `cy` | `worldW` |
|---|---|---|---|---|---|---|
| mdBook, first visit to t = duration | 430 | 0 | 137,625.99 | 130,425.99 | 1.825 | 16,000 |
| mdBook, t = 0.4·duration (window swapped, not a tableau) | 750 | 0 | 137,222.08 | 55,355.94 | 0 | 2,528.6 |
| mdBook, back to t = duration | 430 | 0 | 137,625.99 | 130,425.99 | 1.825 | 16,000 |
| resized to 900x600 in place | 430 | 0 | 137,625.99 | 130,425.99 | 1.825 | 16,000 |
| resized to 2400x420 in place | 430 | 0 | 137,625.99 | 130,425.99 | 1.825 | 16,000 |

Kubernetes behaves identically (872 → 2,326 → 872 resident nodes; `cx` 14,021,120.56 and `cy` 30.13 reproduced exactly). Resizing three times in place changes only `worldH` (7,977.01 → 7,399.06 → 1,455.78) and leaves the box alone, which is right — the box is world-space and the fit is recomputed every frame, so there is nothing viewport-shaped to invalidate.

The hole, for completeness: a *new* `CatalogSource` restarts the serial, so re-opening the same entry can mint the key `1:planHash` a second time. To go stale it would then also need `n`, `firstX` and `headX` all to match while the node set differed — and since `prepare` is deterministic in `(t, view)`, reopening at the same `t` reproduces the same set, so a collision implies an identical set. Even if one were engineered, the horizontal shot depends only on `headX` and the cap; only the y-extent could be wrong, and the y-extent never binds (§9). SUSPECTED-benign. If you want it airtight for nothing, clear `tableauShot` in `setPerformance`: one line, and the box costs a single pass over `nodesByX` to rebuild.

## 7. Break attempt — the tie case in the vertical scan: UNFOUNDED, twice over

**(a) The scan cannot stop early even with ties.** `nodesByX` is built as `byX.sort((a, b) => p.nodes[a].x - p.nodes[b].x || a - b)` — a total comparator, so `x` is non-decreasing along the array and equal values are *contiguous*. A backward walk that breaks at the first `x < minX` therefore cannot skip a node with `x >= minX`: everything at a higher index has an `x` at least as large.

**(b) Ties do not occur at all.** Every resident set measured has strictly distinct x: mdBook 430 nodes / 430 distinct, mdBook mid-performance 750/750, kubernetes 872/872 and 2,326/2,326, longest run of equal x = 1 in all four, and plan order is non-decreasing in x. They are not merely absent from the shelf — I built a repository designed to force them: 60 pairs of sibling commits, each pair committed at the *identical* timestamp, with the merge at the same instant too (`tiedRepo` in `x/qa6/unwindowed.mjs`). Result: 181 nodes, **181 distinct x values**, longest tie run 1. The clock gives every commit its own slot before layout multiplies it out, so `x = impact · xScale` is strictly increasing by construction.

Note also that on all twelve published entries the scan's result cannot reach the picture at all — see §9.

## 8. Break attempt — resident span narrower than 2,600: the width IS protected, the composition is not

`Math.max(cue.w, …)` does what you intended. Measured on a nine-commit repository pasted through the mock (`x/qa6/unwindowed.mjs tiny`; un-windowed, so the box is the whole span):

- box width `wanted` = 883.2 × 1.06 + 80 = **1,016.19**
- `cue.w` at its tableau = **1,159.73**
- measured `worldW` = **1,159.73** — the cue's width, not the box's. The frame is not narrower than the cue. CONFIRMED.

But the centre still comes from the box while the width comes from the cue, and the whole of the difference lands on the right-hand margin:

- measured `cx` = 425.91 = the box's midpoint (`maxX − wanted/2`, with `maxX = 934.01`)
- frame = [−153.96, 1,005.78]; last commit at x = 883.2
- **last commit at 89.4% across, with 10.6% of empty stage to its right** instead of the intended 5.0%

In general `headFrac = 0.5 + 0.45 · boxW / max(cue.w, boxW)`, so the margin doubles at `boxW/cue.w = 0.88` and tends toward a half-empty frame as the box narrows further. Not reachable on the shelf — the fetch band guarantees at least 6,000 units either side of the playhead, and the narrowest resident span measured anywhere was 39,621 — but reachable by anyone who pastes a repository whose whole history is under about 2,400 units, which is what a new repository looks like. CONFIRMED, minor.

## 9. New CONFIRMED problem — the shot is now letterboxed, worst on flat histories

`fit` takes the smaller of its two terms, and the height term can only bind if `max(cue.h, boxH)` exceeds `safeH · MAX_VIEW_WIDTH / safeW` — 7,977 units at 1440x900. No entry's lanes come close (the tallest history on the shelf is 1,308 units), so **the width always binds and the closing frame's height is the viewport's aspect ratio times 16,000**:

| viewport | closing `worldH` | tallest content in frame | vertical fill, best → worst entry |
|---|---|---|---|
| 1440x900 | 7,977.01 | ≤ 1,308.25 | 16.4% (linux) → **3.3% (llvm)** |
| 900x600 | 7,399.06 | ≤ 1,308.25 | 17.7% → 3.5% |
| 2400x700 | 3,360.54 | ≤ 1,308.25 | 38.9% → 7.8% |
| 2400x420 | 1,455.78 | ≤ 1,308.25 | 89.9% → 18.0% |

Before this change the same frames were 1,296–1,500 units tall, so the fill was 20%–87%. The picture is 6.1x flatter at 1440x900 now, and on the flattest history it is close to nothing: **llvm at 1440x900 measures a lit-pixel fraction of 0.00014 with ink confined to columns 229–234 of 240** — 50 nodes and 50 edges are drawn into a band about 23 screen pixels tall in a 900-pixel window, and the only pixels bright enough to pass a relative threshold are the nameplate at the right-hand end. The same entry at 2400x420 measures 0.01663 with ink across columns 0–234. So the closing shot's quality is now strongly dependent on window shape: composed on a short wide window, letterboxed on a tall one. chromium is the second case (747-unit history: 9.4% fill at 1440x900, 51.3% at 2400x420); for comparison llvm measured 0.01413 lit with ink across columns 0–182 at the previous HEAD.

This is the mirror of the bug just fixed — the previous shot wasted 29% of its width to the right of the ending; this one wastes 84%–97% of its height above and below it — and it is why the vertical scan is inert: `boxH` never reaches the threshold, so what the scan computes only ever moves `cy`, never the zoom. (`cy` does follow it sensibly: 0 on llvm, +1.83 mdBook, +30.13 kubernetes, −243.56 cpython, +135.21 node — the in-shot lane midpoint rather than the whole plan's.)

At the extreme, 2400x300 on Linux: `worldW` stays exactly 16,000 (the scale floor pins it) and `worldH` is 639.46, which crops a 1,308-unit lane spread to 49% — the honest trade of a very short window, and the one shape where the height genuinely runs out.

## Checked and found clean at `8330fbe`

1. **`worldW` never exceeds the cap and never falls below it except under punch.** 16,000.00 in all 48 settled measurements and at 2400x300; the floor `safeW / MAX_VIEW_WIDTH` pins it whenever the height term would otherwise have made the shot wider.
2. **No stale box, no viewport coupling** (§6), and the box is reproduced exactly after a window swap.
3. **No wrong frame during the seek.** While `buffering = 1` the previous frame is held (`cx = 41.28`, `state = convergence`, render skipped by design); the first frame drawn after the page lands is already the final `cx = 130,425.99`, `worldW = 16,000`. No intermediate frame, no midpoint flash — and note this is the one place the instant snap is right.
4. **Browser matches the offline computation** from `.catalog-release/` exactly, again: the compiled tail cue `camera.x` to `0.0e+0` and `max(nodeX)` equal to the last commit's x decoded from the published node page, for all twelve.
5. **`cue.w` is still 2,600 at the tail on all twelve**, so the `max(cue.w, boxW)` term is inert on the shelf (box 16,000 ≫ 2,600) — which is why §8 needed a synthetic repository to exercise it.
6. **Reproducible.** mdBook 1440x900 measured twice, cold, minutes apart: `worldW = 16000.000000000002`, `cx = 130425.98999999999`, 840 nodes / 1,170 edges over 6 frames, identical both times.
7. **Silence.** Same triple gag, verified in-page on this build: `HTMLMediaElement.prototype.play` is `function () { return Promise.resolve(); }`, `music = null`, no media elements, the single `music/index.json` request aborted, `--mute-audio` on the process.
8. **One flake, retried, not a finding:** cpython at 2400x700 timed out waiting for the shelf to become visible (60 s) on the first attempt and passed on the second with numbers identical to its other three viewports. The catalog list is fetched per page load; nothing in the run before it failed.

## Method delta

Same rig as the first pass (`x/qa6/lib.mjs`, `.catalog-release` served verbatim through `page.route` with the app's SHA-256 integrity checks passing, paused-and-settled protocol, `drawImage` → `OffscreenCanvas` → `getImageData` for pixels, `openEntry` plus two further slug assertions per measurement). Changes for this pass:

- All twelve entries at all four viewport shapes rather than a subset: 48 settled measurements, plus 2400x300 as a fifth shape on Linux.
- The per-frame recorder now also captures `view.geomMaxX`, `view.cy` and `camera.punch`, which is what makes §2's `headFrac` and the punch analysis measured rather than inferred.
- New probes: `x/qa6/cachekey.mjs` (§6 and the tie statistics) and two generators in `x/qa6/unwindowed.mjs` — `tiny` (nine commits, §8) and `ties` (60 same-instant sibling pairs, §7).
- The previous pass's raw payloads are preserved in `x/qa6/results-ddac384/` with its derived table in `x/qa6/table-ddac384.json`; this pass's are in `x/qa6/results/` and `x/qa6/table-8330fbe.json`.
- `x/qa6/offline.json` is unchanged and still valid: `8330fbe` touches only `src/renderer/canvas.ts`, so every published plan, cue and bound is byte-identical to the previous pass.
- Not re-examined, as agreed: the stale `controller.ts:282` comment (residency described as 16,000 where the fetch width is 48,000). It was still present at `8330fbe`; checking afterwards, `909d103` ("Write down where this actually stands, and stop conflating two limits") has since corrected it to `[6000, MAX_FETCH_WIDTH]` = 48,000. Nothing to report there.
- Build provenance, checked again. My build ran at 22:19:16 from a tree `git rev-parse HEAD` confirmed as `8330fbe` with `git status` showing only the three stray PNGs; every measurement finished by 22:33:34, and the `dist/` I was serving was next rebuilt by another process at 22:37:54. Three commits did land while I was measuring — `fd15122` (22:26:12), `097e124` (22:29:55) and `909d103` (22:31:50) — so if that other process rebuilt inside my window I cannot prove which bundle late runs were served. It makes no difference to any number here: `git diff 8330fbe..909d103 --name-only` does not include `src/renderer/canvas.ts`, so the camera is byte-identical across every bundle that could have been in play, and the mdBook 1440x900 measurement taken at the start of the window and repeated at 22:33:34 agreed digit for digit.
