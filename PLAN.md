# GitTimeline — where this could go

A companion to `TASKS.md`, not a replacement. `TASKS.md` is what is wrong and
what is owed. This is what the thing could become. Nothing here is scheduled;
everything here is argued for.

---

## The thesis

The instrument is finished and it is very good. It reads a real commit graph
with no API, compiles a deterministic performance, and plays it at sixty frames
a second for twelve hours without lying about anything.

And almost nobody will ever see that, because:

1. **It takes 15.7 seconds to start** the entry people most want — a blank
   screen with a progress bar, before anything moves.
2. **It runs for twelve hours.** Nobody watches twelve hours. The shelf's best
   material is its least watchable.
3. **It is abstract.** A viewer sees lines and sparks and cannot say what any of
   it means without opening a help panel.
4. **There is no reason to come back, and nothing to send anyone.**

Every idea below is downstream of one of those four. The craft work — UI, sound,
performance — matters, but it is polish on a thing people currently bounce off
in the first fifteen seconds.

---

## I. The fifteen-second wall

### I.1 Stream the plan and start playing immediately · **large, highest leverage**

`readCompiledPerformance` consumes the whole file before returning anything.
Linux is 152 MB, so the first frame is 15.7 seconds after the click, and the
viewer stares at a progress bar for the part of the experience that was supposed
to be instant.

But the format is *already a stream* — header, contributors, refs, nodes, edges,
events, camera, geometry — it just happens to be ordered by kind. If it were
ordered (or chunked) **by performance time**, the first thirty seconds of
choreography would arrive in the first megabyte and playback could begin at
about a second and a half, with the rest arriving underneath.

This changes the product more than anything else on this page. "Twelve hours,
152 MB, wait sixteen seconds" becomes "press play, it starts". It also makes
every large entry feel identical in cost to a small one, which is the thing the
shelf currently cannot promise.

Cost: a format version and a chunked writer/reader. The plan hash and the
verification pass already exist to prove nothing changed.

### I.2 The cold open · small
Nothing should ever start on an empty stage. Begin at the first moment with
something happening — the first divergence, or a few seconds before the first
merge — rather than at t=0 with one spark crawling. This is also most of the fix
for the demo problem in `TASKS.md` §4.

### I.3 Warm the first chunk on hover · small
The catalog knows what you are about to click. Once I.1 exists, prefetching the
first chunk on hover makes the click feel instantaneous.

---

## II. Twelve hours is not a length

The scope chooser solved "which years". It did not solve "I have four minutes".

### II.1 Cuts, not spans · **medium, highest product value**

Offer named lengths, not just year ranges:

| Cut | What it is |
| --- | --- |
| **Trailer** ~60 s | The six best moments, cut together |
| **Highlights** ~5 min | Every `MAJOR_MERGE` and `MERGE_STORM`, with breath between |
| **Chapter** | One era, or one release-to-release span |
| **Full** | What exists today |

The material is already in the plan and nothing surfaces it. CPython alone
carries 423 `MAJOR_MERGE`, 2 `MERGE_STORM`, 127 `PARALLEL_PHRASE`, 20
`QUIET_GAP` and 2,027 `COMMIT_CLUSTER` events. A cut is a playlist over an
existing plan — no new data, no recompile, and it costs the same download.

The hard part is editorial, not technical: what makes a moment worth keeping.
Merge volume is the obvious first ranking; contributor arrivals and the ends of
long quiet gaps are probably better than they sound.

### II.2 Releases as chapters · small
`tagLabels` and `refLabels` are on the nodes already and are used only for a
faint caption. Releases are the chapter markers a project wrote for itself. Put
them on the transport, let people jump between them, and title the section they
are in. "Watch 2.6 land" is a thing somebody would click.

### II.3 Natural time mode · small, delightful
A mode where the clock is real — one second is one day, or one week. You stop
watching a performance and start feeling a cadence: the weekends, the release
crunches, the August nobody committed. Same plan, different `timeMap` reading.

---

## III. Teach the eye

### III.1 A minimap · **medium, fixes a real defect**
A strip showing the whole history with the camera's viewport drawn on it. It
answers "where am I", it makes the twelve-hour scale comprehensible, and it
directly softens `TASKS.md` §3.1 — when you can see that the camera is one
window onto something much wider, the camera being behind the front stops
reading as a lie.

### III.2 Subtitles · small, already built
`buildTranscript` produces a plain-language line per event and it is only used
for the accessible transcript. Put it on screen as optional subtitles — *"March
2016 · twelve threads converge"*. Cinematic, and it teaches the vocabulary
without a help panel.

### III.3 A title card and a real finale · small
Open on the repository's name, its span, its commit count — like a film. Close
on the finished graph with the contributors who built it. Both moments are
currently the least designed parts of the whole piece, and both are exactly what
somebody would screenshot.

### III.4 Say what is happening, once · small
A one-time pass on first run that points at the three things that matter: this
is main, these are branches, this is a merge. Never shown again.

### III.5 Bots are not people · small, revelatory
`isBot` is already on every contributor. A toggle that separates automated
commits from human ones would change what a modern repository *looks like* —
Kubernetes especially. Nothing else in this space shows that, and the data is
sitting there.

---

## IV. Something to send someone

### IV.1 "Your commits" · **medium, the emotional hook**
Sign in, open a repository you contributed to, and your own commits light up.
Where you arrived, what you touched, the day you merged the big one. Everything
needed exists: `focusContributor`, contributor identity, and an OAuth flow that
already asks for zero scopes.

This is the feature people send to their friends. Everything else here is a
better version of an existing thing; this is a different reason to visit.

### IV.2 Deep link and poster · **small, both halves already exist**
The share hash carries `repo`, `t`, `focus` and `seed`. `renderPosterSvg` draws
exact geometry. Neither is reachable from the UI. "Copy a link to this moment"
and "save this frame" are wiring, not building.

### IV.3 Clip export · medium
`MediaRecorder` capture exists and is barely exercised. A thirty-second clip
with the score under it, sized for social, is the difference between a link
people open and a thing people post.

### IV.4 A local CLI · medium, strategically interesting
`npx gittimeline .` — build an artifact from the repository you are standing in
and open it. No upload, no token, no network, works on private code by
construction. It answers the private-repository question without any of the
OAuth machinery, and it makes the project useful to people who would never paste
a URL into a stranger's website.

---

## V. Craft: the interface

The stage is good. The frame around it grew one control at a time and was never
designed together. Beyond `TASKS.md` §6:

- **A real design system.** One type scale, one spacing scale, one motion
  language. Today there are three easings and a lot of individually chosen
  greys.
- **Colour modes.** Colour currently means "who". It could optionally mean
  "when" (recency), "how hot" (merge density), or "human vs machine". One switch,
  four readings of the same picture.
- **A transport grouped by how often things are used**, rather than by when they
  were added.
- **The ledger should point at the stage.** A row and a mark on screen are the
  same commit and nothing draws that relationship.
- **Mobile as a design, not a survival.** It currently does not overflow, which
  is not the same as being good.

---

## VI. Craft: the score

Three tracks from one artist, chosen once at load and never revisited across
twelve hours. Beyond `TASKS.md` §7:

- **Follow the eras.** `ERA_TRANSITION` events already mark where a project
  changes character. Crossfade there. A history that starts as one person and
  becomes a thousand should not sound the same at both ends.
- **Duck for the big ones.** `MAJOR_MERGE` and `MERGE_STORM` are the moments the
  score should get out of the way of, or land on.
- **Let quiet be quiet.** `QUIET_GAP` is in the plan. Twenty of them in CPython.
  Thinning the music there would make the busy parts feel busy.
- **Widen the library, and vary the source.** Three tracks across every
  repository ever written means the whole shelf sounds like one album. A second
  artist matters more than a fourth track by the first.
- **A deterministic per-repo signature**, so the same project always sounds like
  itself.
- **Credits that do the licence justice.** CC-BY deserves better than one line
  in a help panel.

---

## VII. Platform and performance

Mostly already argued in `TASKS.md` §5 and §8; the ones that change the ceiling
rather than the constant:

- **A WebGL stage.** Sparks become one instanced draw call instead of ~35 canvas
  operations each. Makes the weak-machine problem disappear rather than get
  mitigated. Keep Canvas2D as the fallback, which already exists and is tested.
- **OffscreenCanvas in a worker**, so a heavy frame cannot block input.
- **Incremental dataset updates.** `git log <last-tip>..HEAD` against the cached
  clones turns the weekly job from an hour into minutes, and makes adding
  entries cheap enough to have fifty.
- **Beyond GitHub.** Ingestion is `git clone`; it never needed GitHub. GitLab,
  Codeberg, or any clonable URL.

---

## A sequence, if one is wanted

**First — make it start.** I.1 streaming, I.2 cold open. Nothing else matters if
people leave during the progress bar.

**Second — make it watchable.** II.1 cuts, II.2 releases as chapters. This turns
the shelf's biggest entries from a dare into an offer.

**Third — make it legible.** III.1 minimap, III.2 subtitles, III.3 title and
finale. Cheap, and they compound with the first two.

**Fourth — make it spread.** IV.2 first because both halves exist, then IV.1
"your commits", which is the only idea here that gives somebody a reason to come
back.

**Then craft and platform**, continuously, as `TASKS.md` describes.

---

## What I would not do

- **A frame-time governor that changes what the picture looks like per machine.**
  Detail thresholds are deliberately in objects, not milliseconds, so the same
  repository looks the same everywhere. Dynamic resolution is the one acceptable
  exception and should be visible and reversible.
- **Generated audio.** It was tried, it was disliked, and recorded music is
  better. Layering stems is a different idea and might be fine; oscillators are
  not.
- **File and directory colouring.** It is the most requested-sounding feature and
  the clone is `--filter=tree:0`, which means there are no trees. Getting paths
  means a different clone, far more data, and a slower weekly job. Worth it only
  if it becomes the point of the product rather than a garnish.
- **Anything that shows the future.** The rule is that nothing is drawn before it
  happens; it was violated twice and both were reported by a viewer within
  minutes. It is load-bearing for trust.
