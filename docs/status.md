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

1. **The date readout and the timeline disagree at the end of a run.** Read as
   fourteen years apart at the final frame, and on Node.js the last eleven
   seconds covered twelve years. *Carried over; not re-measured since the
   playhead-vs-travel fix in `27ee1a8`, which addressed a different cause.*
   Suspected: the mixed-resolution `timeMap` in a streamed assembly.
2. **A streamed entry's closing shot cannot show the whole history**, because
   only a window is resident, and nothing on screen says so. The shot is now
   honest about what it is (the resident span, ending at the newest commit)
   rather than pretending to be the whole picture — but "the whole shape at
   once" is still a thing the app cannot do for twelve of its histories. See
   the packaged-overview idea below.

### Accessibility — where people are excluded

3. **The scope dialog is unreachable at 320px** — title above the viewport,
   close button below, and both `html` and `body` at `overflow: hidden`.
   *Carried over, unverified.*
4. **At 200% zoom the player drops** the coverage badge, the commit rail, Auto
   camera and Help rather than reflowing them. *Carried over, unverified.*
5. **Contrast of the quiet furniture** — `.dim` paragraphs and relative
   timestamps have not been measured off rendered pixels since the palette
   changed. The one that was measured (`.view-toggles` at 2.13:1) is fixed.
   *Being measured now.*

### Playback

6. **Contributor selection is imprecise.** Reported by the user, still
   unexplained. The hit test is a flat 14px screen radius scanned over every
   node with no preference for the main line or for what is already focused. A
   deferral fix was built, A/B'd (13,191 vs 13,327 lit pixels — noise) and
   reverted, so the cause is something else and I do not yet know what.
7. **Two frames a second is still two frames a second.** The clock keeps real
   time down to that now and the quality ladder gives up the bloom and the dust
   before it — but a device that needs both steps is watching a slideshow. The
   remaining lever would be drawing at a fraction of the CSS resolution and
   upscaling, which no setting currently permits.

---

## 3. Fixed today, with the measurement that proved it

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
- **The unit suite stopped failing for being busy.** Three tests compile whole
  histories and were losing to Vitest's five-second default whenever anything
  else was running. Three times today a green suite and a red suite differed
  only in what else was on the machine.

---

## 4. Ideas worth deciding on

**A packaged whole-history overview.** A streamed entry can never show its real
shape, because only a window is resident. A decimated skeleton of the whole
history — about 16KB, written at packaging time — would let the closing shot be
the shot it claims to be. Costs a republish, and raises a real question this
project has to answer rather than dodge: is a decimated shape still "honest
topology", or is it a picture of something that never existed?

**Background time ticks.** The stage's central claim is that horizontal
position is time, and that claim is made nowhere on it — it is a chart with no
axis, which is why "we are in February and there are threads into next year"
reads as a contradiction rather than as parallel work. Faint calendar marks at
a zoom-chosen interval would supply the missing reference. Proposal written at
`x/proposal-ticks.md`. The open question a reviewer has to settle: should a
tick be drawn for a date the show has not reached yet?

**Speculative prefetch.** The worker cancels its previous request on every
message, so the next window cannot be warmed while the current one plays. A
separate speculative channel would remove the remaining stalls rather than
making them rarer. A second worker was investigated and is not the answer: a
warmed page answers in 100ms and a cold one also in 100ms, because the cost is
plan assembly and structured clone rather than fetching, so a second worker
would duplicate the cache and help nothing.

**Precomputed demo artifacts**, so a visitor can watch a large repository
without a token at all.

---

## 5. How to test this without lying to yourself

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
- **Six-second samples test densities, not accumulation.** Twenty of them at
  twenty depths says nothing about what twelve hours does to the heap or to the
  1,440 page boundaries a full run crosses.
