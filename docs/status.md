# Where GitTimeline stands, and what needs work

Last revised 2026-09-06. Everything here is either measured or read in the
source at the commit named beside it. Where something is inherited from an
earlier note and has not been re-checked, it says so — a stale list is worse
than a short one, because it spends attention on things already fixed.

This supersedes `x/ROADBLOCKS.md`, about a third of which had been fixed by the
time anyone read it again.

---

## 1. Blocked on a person, not on work

| | what | cost |
|---|---|---|
| **Credentials to rotate** | A GitHub PAT, a Cloudflare token, a Render key and a Codex setup token all reached a chat transcript. Separately, a classic `ghp_` PAT was found inside `x/sec4/probe1.mjs`, redacted without being read, and verified absent from every git ref — but a token that appeared in a working tree should be treated as disclosed. None are in the repository. | ~10 minutes |
| **Shelf pacing** | Chromium is 1.8M commits in 2.8 minutes; Linux is twelve hours. Node counts track *merges*, not commits, because the visible budget is per-thread — so a merge-light history sprints and a merge-heavy one crawls. Rebalancing means a `choreographyVersion` bump and a full republish: hours of CI, and a judgement about what these shows should feel like. | a decision |
| **The weakest three entries** | Chromium, LLVM and Node are each about 900 dots and under three minutes. They are the least representative things on the shelf and the most likely to be clicked first, because the names are famous. Retiring or recompiling them is the same republish as above. | a decision |
| **Dependabot ×6** | All six bump TypeScript to 7.0.2, and `typescript-eslint@8.69.0` does not support it. `main` is on 6.0.3 and unaffected. Nothing to do but wait. | none |

Sign-in and the Worker were on this list and are not now: the callback URL is
set, and the narrowed origin allowlist is deployed and verified (a request from
`/tri-huynh-portfolio/` on the shared origin gets a 400).

---

## 2. Open defects

Ranked by who they hurt. Each says whether it was measured today or carried
over unverified.

### Honesty — where the app says something that is not so

1. **The date readout and the timeline disagreed at the end of a run — cause
   found, and it was not the one on this list.** Measured on the deployed build:
   Node.js 14.00 years apart, CPython 12.67, React 11.25, Chromium 6.43, mdBook
   5.50; the built-in demo, the only plan on that list held whole, exactly 0.00.

   This list said "suspected: the mixed-resolution `timeMap` in a streamed
   assembly". **That is false and should not be investigated again.** Every
   published `time` page was downloaded and decoded to rebuild each entry's
   full-resolution map, then compared against the map the browser actually holds
   at 201 playhead positions per entry: **worst error 0.00 years** on all four
   entries tested. The page covering the playhead is always loaded and carries
   its own window at full resolution, so the coarse year marks only ever govern
   parts of the map nobody reads.

   The real mechanism: the closing tableau's zoom floor left `worldW` at 16,000
   against a history of 137,706 or more, so `ExploreBar` saw `visible ≈ 0.12`,
   fell through the `>= 0.995` guard written to prevent exactly this, and set
   `store.travelAt` **with no user input at all** — the caption said
   "Travelling the finished history". `DateBar` then dutifully reported the date
   wherever the camera was sitting, which on that build was the midpoint of the
   history. The readout was not miscalculating; it had quietly stopped answering
   the question it appears to answer. And the size of the error was whatever the
   tableau happened to settle on: the same measurement against a differently
   framed build gave 11.7 years on Node and 0.1 on mdBook, because there the
   guard happened to fire. A constant mechanism producing a coin-toss number is
   worse than a fixed error, not better.

   **This is almost certainly the viewer's original complaint** — "it doesn't
   make much sense to be in February and there are threads into the next year".
   At mdBook's untouched final frame the hero read March 2021 while the stage
   spanned about 1.1 calendar years. Threads into the next year, with a date
   naming one month of it. A bug in the readout, not a missing axis.

   *Status: believed fixed, on two independent grounds rather than a fresh
   five-entry measurement.* `27ee1a8` made the guard
   `!taken || visible >= 0.995`, where `taken` requires that somebody actually
   travelled or took the camera — so the spurious travel is unreachable
   regardless of how narrow the closing frame is, which is what made the old
   error entry-dependent. And the closing shot no longer parks at the midpoint
   (`8d79ded`). `catalog.spec.ts` asserts the date still describes the playhead
   at the end, and it fails when the guard is reverted, which was checked.

   The reviewer's numbers came from a deploy predating the first of those.
   Re-running their five-entry probe against HEAD was started and abandoned:
   it seeks a 53-minute history to its end over the remote shelf and had not
   finished in ten minutes. Worth doing when there is time to spare, but the
   guard being entry-independent is the reason this is not being carried as an
   open defect.
2. **A streamed entry's closing shot cannot show the whole history**, because
   only a window is resident, and nothing on screen says so. The shot is now
   honest about what it is (the resident span, ending at the newest commit)
   rather than pretending to be the whole picture — but "the whole shape at
   once" is still a thing the app cannot do for twelve of its histories. See
   the packaged-overview idea below.

### Accessibility — where people are excluded

Nothing left on this list that has been measured. The three items that were
here — the scope dialog at 320px, the coverage badge disappearing at 200% zoom,
and the contrast of the quiet furniture — are in section 3 below, along with
five more that a review found while checking them.

### Playback

3. **Node.js spends 86% of its show on 2011–2014 and 2.4% on the decade
   after.** Each year from 2017 to 2026 gets **0.007 seconds** — four tenths of
   a frame. Not a general pacing fault: Chromium, LLVM and Kubernetes give
   67%, 71% and 85% of their runtime to 2016 onward. The cause is that runtime
   is allocated per *visible arrival*, so a stretch of history is paid for how
   badly it aggregates rather than how much work it holds — and Node's 327
   threads are concentrated in the io.js era while its later years are one long
   collapsible run. Measured, diagnosed and three options written up in
   `docs/pacing.md`; needs a republish, so it needs a decision first.
4. **A weak device is choppy, though no longer slow.** The clock holds real
   time now — see the device matrix below — but a configuration that needs both
   rungs of the quality ladder is watching two to six frames a second. Measured
   worst cases: Chromium at 20x CPU throttling and 2x device pixels, 2.43 fps;
   WebKit on an iPhone 12 descriptor, 3.55 fps; WebKit at 1280x720 and dpr 2,
   5.65 fps. Nothing stalls and nothing drifts, but nobody would call it an
   animation. The only lever left is drawing at a fraction of the CSS
   resolution and upscaling, which no setting currently permits.
5. **Following a contributor: diagnosed, improved, and the improvement is
   unverified.** Reported as "select a contributor isn't too accurate to
   follow". The Help panel offers a list under "select one to follow their work
   through the structure", and focusing one dims the stage to 28% and keeps
   that person's work bright — except that it only ever tested a node's own
   `contributorIdx`, and nearly all commits are inside aggregated runs. The
   arithmetic, from the published manifests:

   | entry | commits | individually drawn | contributors | drawn per contributor |
   |---|---|---|---|---|
   | chromium | 1,817,062 | 923 | 15,832 | **0.058** |
   | llvm-llvm-project | 595,778 | 894 | 9,746 | **0.092** |
   | nodejs/node | 48,272 | 1,013 | 4,727 | **0.214** |
   | kubernetes | 140,858 | 125,973 | 6,048 | 20.8 |
   | rust-lang/mdBook | 3,293 | 1,220 | 405 | 3.0 |

   So on the three biggest entries most contributors cannot have a single node
   of their own on the stage. `AggregateSpan.contributorIds` has always listed
   everyone inside a run and was never consulted for focus, so their work was
   in the picture and only missing from the attribution. Focus now keeps the
   runs holding their commits bright, which needs no rebuild — the data is in
   the published plans.

   **What is not established is that this is what the complaint was about.**
   Three attempts to measure the visual effect all passed with the fix
   reverted and so tested nothing: lit-pixel counts cannot work because focus
   dims rather than removes; bright-pixel counts at a downsampled resolution
   cannot work because averaging destroys one-pixel lines; and bright-pixel
   counts at native resolution on a real entry cannot work either, because the
   ivory main line is never dimmed by contributor focus and puts a large floor
   under the count. Closing it needs the ability to pick a contributor who
   appears in some aggregate's `contributorIds` and on no node's own
   `contributorIdx`, which is not on the test surface today. The other two
   candidates from the original report — the 14-pixel hit test on landed dots,
   and moving sparks not being selectable at all — remain untested.

---

## 3. Is it smooth on other devices?

Yes, in the sense that mattered: **the show runs at the speed it says it does
everywhere it was measured.** 38 cells, one continuous run of at least 60
seconds each, sampled across three engines, seven viewports, device pixel
ratios 1 and 2, CPU throttling at 4x/8x/20x, spoofed 2-core and 2GB hardware,
the Pixel 5 and iPhone 12 device descriptors with touch, and four different
histories including a five-minute continuous run into the middle of Linux.

| | |
|---|---|
| Clock rate against real time | **0.96x to 1.00x in every cell** |
| Worst cell | Chromium, 2x device pixels, 20x CPU throttling: 0.9601x at 2.43 fps |
| Frames over one second | **0, anywhere** |
| Console errors | **0, anywhere** |
| Five-minute continuous Linux run, mid-history | 0.9929x, 17.9 fps, one buffering period |
| kubernetes, all three engines | 1.00x, 22 to 26 fps |

For comparison, the same conditions before the frame-clamp fix read 0.41x on
WebKit and 0.49x on Firefox — a history whose card said 2 min 43 taking 6 min
37. That is gone.

What is *not* fixed is the frame rate itself on the weakest configurations,
which is item 3 above. Real time holding at 2.4 fps means the show is honest
and choppy rather than dishonest and smooth, which is the better of the two but
is not the same as good.

Two caveats, because this is a partial run: the matrix was stopped early to
save usage, so the 300%-zoom cells and the memory-growth series were never
collected, and no reduced-motion or camera-still cell was measured. The raw
data is `x/dev1/results/main.jsonl`; the harness is beside it.

---

## 4. Fixed today, with the measurement that proved it

- **A private history is no longer written to the device.** `RepoProbe.isPrivate`
  had been declared, documented and carried out of the probe for exactly this
  purpose and never once read — so a private history was cached like any other
  and its slug went into the recents list the landing page paints in plain
  sight. `tests/e2e/private.spec.ts` reads IndexedDB and localStorage back and
  looks for the owner, the name, and every commit message, author and sha. It
  fails on the previous build.
- **The probe caches from the moment privacy is known**, rather than never.
  Only the first of its three calls — the one that answers the question — is
  uncached.
- **Signing in leads somewhere.** `#your-repositories` is a page, not a section
  at the foot of a consent document 406 pixels down a 1,400 pixel page with the
  demo legible through the rows.
- **The show no longer runs in slow motion.** The frame loop capped one frame's
  elapsed time at a tenth of a second, which is also ten frames a second, so
  below that the clock fell behind the wall: 0.41x on headless WebKit, and a
  history whose card said 2 min 43 took 6 min 37. Measured 0.28x at 2.8 fps
  before, 1.0x after. The background-tab jump the cap really existed for is
  handled on `visibilitychange`.
- **A 1x display can adapt.** `watchFrameRate` returned immediately unless
  `dpr > 1`, so a slow device reporting one device pixel — most desktops —
  could not adapt at all however badly it was doing. It steps resolution, then
  the bloom, then the dust.
- **The closing shot frames the ending.** Third attempt; the first two were
  measured on one entry at one size and were both wrong. See `8330fbe`.
- **The Inspector no longer calls every packaged commit a root.** `parentShas`
  comes from the ingested dataset and a streamed entry has none, so the absence
  was read as "no parents" and merges rendered as `none (root) · merge` —
  twelve histories, every commit.
- **The Events panel exists.** The canvas's alternative text has told every
  screen-reader user to "use the Events panel (E)" since the stage was written,
  and there was no panel and no key.
- **The e2e suite builds its own bundle.** `vite preview` serves whatever is in
  `dist` and `reuseExistingServer` skipped the build, so a green suite could be
  green against a build made hours earlier from a different commit. It was: a
  test for an API added minutes before failed with "not a function" while tsc
  and eslint were clean.
- **Two limits stopped being conflated in a comment.** `controller.ts` said the
  fetch width clamped to `[6000, 16000]`; it has been 48,000 since the stutter
  work. `MAX_VIEW_WIDTH` is how wide a frame may be and `MAX_FETCH_WIDTH` is
  how much may be held around it, and reasoning about the closing shot as
  though only 16,000 units were resident sent that fix the wrong way twice.
- **The suite stopped making noise.** Chromium and Firefox have launch
  switches; WebKit has none and was covered by a helper each spec had to
  remember to call, which two of fifteen did. That held until a spec that plays
  something was added to the WebKit project. Measured on the element the app
  actually uses: the track plays at volume 0.354 on all three engines
  regardless, and only two of them decline to pass it to the speakers. It is a
  fixture now, on every page on every engine, verified silent.
- **The repositories list stopped describing its own failures as facts about
  the reader.** A non-array answer rendered as "you have no public ones"; a
  list holding one `null` put "Cannot read properties of null" on screen; a 401
  asked for a token there is no box for while the app went on claiming to be
  connected; a 403 blamed the anonymous per-network limit on a page about the
  viewer's own allowance. Each has a sentence and, where there is something to
  press, a button.
- **And it stopped hiding things.** 300 repositories became "200", of which 60
  were drawn, with no sentence admitting either bound. `size: 0` — disk usage
  in kilobytes, rounded down — was being read as "no commits", so a new
  repository with a README silently did not exist.
- **The privacy promise is legible.** `--text-faint` measured 2.62–3.24:1 and
  was carrying the one sentence the page exists to make.
- **A repository that becomes private comes off the device.** The guarantee was
  evaluated once, at fetch time, so one watched while public and then made
  private kept its dataset, its cached pages, its name on the landing page, and
  replayed with no token at all. A network failure is deliberately not an
  answer.
- **A private repository stopped transmitting its size**, labelled "a public
  repository". `analytics.ts` declares the branch that withholds it and
  documents why; nothing passed it.
- **The scope dialog at 320px, the coverage badge at 200% zoom, and the other
  scope dialog** — which had no `aria-modal`, no focus trap and no way out but
  one specific button, on the private-repository path.
- **The unit suite stopped failing for being busy.** Three tests compile whole
  histories and were losing to Vitest's five-second default whenever anything
  else was running. Three times today a green suite and a red suite differed
  only in what else was on the machine.

---

## 5. Ideas worth deciding on

**A packaged whole-history overview.** A streamed entry can never show its real
shape, because only a window is resident. A decimated skeleton of the whole
history — about 16KB, written at packaging time — would let the closing shot be
the shot it claims to be. Costs a republish, and raises a real question this
project has to answer rather than dodge: is a decimated shape still "honest
topology", or is it a picture of something that never existed?

**Background time ticks — proposed, reviewed, and rejected.** The idea was
faint calendar marks behind the stage, at a zoom-chosen interval, to supply the
time reference a chart with no axis is missing. A reviewer built it exactly as
specified, ran it against the real shelf, and rejected it on four measured
grounds. Full report: `x/ticks-review/VERDICT.md`.

- **x is proportional to runtime, not to the calendar**, and ticks are a claim
  about proportion. Per-year width across one history varies by up to
  **213,610 : 1** (CPython), and 22 of its 36 years occupy under 0.05 s of
  runtime. CPython's 1990–2005 are 5.5 world units each — sixteen years inside
  56 px at playback zoom. "The largest unit whose spacing is at least 120 px"
  has no well-defined input when spacing varies by thousands *within a single
  frame*.
- **It would be a third disagreeing time scale, not a reference.** At Node's
  final frame the scrubber's rightmost label read 2015, the prototype's only
  stage tick read 2020, and the date hero read September 2026 — three readouts,
  three answers, each correct by its own rule. CPython's scrubber paints two
  year labels for a history the top bar calls "1990–2026 · ENTIRE REPO".
- **Built and looked at, it is invisible.** Differencing tick/bare frame pairs
  column by column: never more than **two pixel columns** changed on a 1600 px
  stage, peak added luminance **1 to 8 levels out of 255** on a near-black field
  with bloom over it. On CPython, at all four depths tested, the ladder found no
  qualifying interval and **nothing was drawn at all**.
- **And the calibration argument was arithmetically backwards** — the proposal
  described `0.055` as "about half the weight" of an existing `0.05`.

The goal is still worth keeping; this specification is not buildable as written,
and building it first would have been building on top of the date bug above,
which is what the complaint that motivated it actually was.

**Speculative prefetch.** The worker cancels its previous request on every
message, so the next window cannot be warmed while the current one plays. A
separate speculative channel would remove the remaining stalls rather than
making them rarer. A second worker was investigated and is not the answer: a
warmed page answers in 100ms and a cold one also in 100ms, because the cost is
plan assembly and structured clone rather than fetching, so a second worker
would duplicate the cache and help nothing.

**Precomputed demo artifacts**, so a visitor can watch a large repository
without a token at all.

**Two costs nobody is paying attention to.** The repositories list is
re-fetched on every visit — three visits, three calls, and the spinner replays
each time — with no memoisation. And a public repository's metadata is fetched
twice per visit: the probe's first call is deliberately uncached, for a reason
that is sound, while the ingest client writes the same URL into the cache and
then the probe ignores it next time. Neither is a defect; both are waste with a
known cause.

---

## 6. How to test this without lying to yourself

Written down because every wrong claim in this project's history came from one
of these, and most came from the first two.

- **One entry is not the shelf, and one viewport is not a screen.** The closing
  shot was called fixed twice from a single entry at a single size, and was
  wrong both times in a different way. Twelve entries, four shapes.
- **"Not blank" is not "correct".** The second wrong closing shot drew 151
  nodes a frame. It was a healthy-looking picture of the middle of the
  repository with the ending off screen.
- **A test that cannot fail proves nothing.** Revert the fix and watch the test
  go red before believing it. Two tests in this repository were passing against
  behaviour they did not exercise.
- **Never `page.screenshot` or `canvas.toDataURL`** on the stage: it is
  `desynchronized: true` and both hang above about 40k nodes. Use `drawImage`
  into an `OffscreenCanvas` and `getImageData`, from a frame that is paused and
  settled — `pause()`, wait for `buffering` to clear, wait 700-1400ms, then
  three `requestAnimationFrame`s.
- **Assert what you loaded.** `window.__gittimeline.source` beside every
  measurement. One probe measured the demo for an hour while labelling it
  Linux.
- **Never measure timing next to another browser.** Five separate false
  failures in this project were another process on the machine.
- **Do not read a number through the thing you are testing.** The mute fixture
  faked the `volume` getter to 0 and refused the setter, so the element played
  at 1.0 while answering 0 to the probe that was verifying it. A fresh realm is
  no escape either: `addInitScript` runs in child frames, so the fake follows
  you. Assert the accessor is native code before trusting what it says.
- **Headless WebKit dies under sustained main-thread blocking.** "Target
  crashed", reproduced four times, in any test that busy-waits inside
  `page.evaluate` for tens of seconds. Not an app fault, but it means that
  technique covers two engines and not three.
- **Six-second samples test densities, not accumulation.** Twenty of them at
  twenty depths says nothing about what twelve hours does to the heap or to the
  1,440 page boundaries a full run crosses.
