import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { askCatalogScope } from './controller';
import { trackCatalogOpen } from './analytics';
import { hash01 } from '@/model/prng';
import { FRAME_SECONDS, SECONDS_PER_NODE } from '@/choreography/pace';
import { catalogUrl, externalCatalog } from './catalogLocation';

/**
 * Histories fetched ahead of time and shipped with the site.
 *
 * GitHub gives an anonymous visitor about sixty requests an hour — a few
 * thousand commits — and a large repository needs hundreds. The tempting fix
 * is to ship a token, and it does not work: the browser has to send it as an
 * `Authorization` header, so anyone can lift it straight out of the network
 * tab. So the fetching happens once, in CI, with a token that never leaves the
 * build, and what ships is the result. Opening one of these costs no token and
 * no GitHub requests at all.
 *
 * ## The picture is the project's mark, not a frame of its performance
 *
 * Each card used to lead with a real frame of that history, captured at build
 * time. The argument for it was that the *shape* of a history is the thing
 * worth choosing between — and at card size that argument does not survive
 * contact with the pictures. A commit graph is a wide, mostly horizontal
 * texture; eleven of them ranged down a page are eleven grey smears, and no
 * amount of re-framing changes what they are made of. Nothing on that shelf
 * told you at a glance which card was Kubernetes.
 *
 * The owner's mark does, instantly, and it is already downloaded — it was the
 * twenty-pixel glyph beside the title. So it becomes the picture: large,
 * centred, on a field tinted from the slug so the shelf is not a column of
 * identical dark rectangles.
 *
 * It sits on a light plate, which is not decoration. These marks arrive in two
 * incompatible kinds: Rust's gear and Python's logo are dark-on-transparent and
 * vanish on a dark panel outright, while Kubernetes and Chromium come on white
 * already. One plate makes both read the same way, and turns a photograph
 * (Linus, BurntSushi) into the same rounded square as a logo rather than a
 * portrait floating in a void. It is served from this origin like everything
 * else: the page allows no remote images at all, which is the catalog's promise
 * written somewhere a browser enforces it.
 *
 * ## What a card says it costs
 *
 * Three figures at the same size: how long the performance runs, how many
 * commits are in it, and how fast they arrive. The last is new and it is the
 * one that says whether a history can be *followed* rather than merely
 * watched — a number that was catastrophically wrong for as long as a
 * thirty-five minute ceiling existed, because Linux's 332,279 arrivals were
 * being delivered inside it at a hundred and fifty-eight a second. There is no
 * ceiling now. Linux is twelve hours and every commit gets its beat, and a card
 * that says twelve hours is telling the truth for the first time.
 *
 * ## And a year of it, for people who do not have twelve hours
 *
 * Under the figures every card offers a single calendar year of its own
 * history. That is not a remedy for density — nothing here is dense any more —
 * it is a way to watch the part you care about: React's 2016, Node's last year.
 *
 * A span costs nothing to produce. The plan already shipped contains every
 * commit with the moment it lands, and `timeMap` turns a date into that moment,
 * so picking a year is telling the clock where to start and where to stop. No
 * second download, no compile, no new artifact. The years and their lengths
 * come off the plan at index time, because a year's share of the running time
 * is its share of the *commits* and not its share of the calendar — Node's 2015
 * and its 2024 are the same length of year and nowhere near the same length of
 * show.
 *
 * The whole history stays the default and the headline: the card itself is the
 * button for it, and the year selector sits underneath as an alternative.
 *
 * That is why the first entry is given the full width. Four equal rows of
 * picture-and-caption reads as a table with illustrations however large the
 * illustrations are; one big frame with the rest ranged beneath it reads as a
 * gallery.
 *
 * The list is absent, not broken, when no catalog has been built: this renders
 * nothing rather than an empty shelf.
 */
export interface CatalogEntry {
  slug: string;
  title: string;
  blurb: string;
  scope: string | null;
  file: string;
  /**
   * The owner's avatar, downloaded at build time and served from this origin.
   * Null where that download failed; the card then sets the owner's initial in
   * the plate instead, which is a card whose mark is missing rather than a
   * broken image.
   */
  logo: string | null;
  /**
   * The precompiled plan the click arrives through, and what it weighs.
   *
   * Null means this entry is still composed in the tab, which is the case the
   * card has to warn about — everything else here opens in about the time the
   * download takes. Recorded by the build from the open it timed anyway, and
   * only after the app said it had used one: a plan that ships and is then
   * declined for being a version behind is not a plan the card may quote.
   *
   * Nothing loads from this. `loadPrecompiledPlan` works the filename out from
   * the dataset, so what is here describes the click rather than performing it.
   */
  plan: string | null;
  planBytes: number | null;
  /**
   * The dataset — the history itself, before anything was composed from it.
   *
   * This is no longer what a click costs, and has not been since plans began
   * shipping; `planBytes` is. It stays because it is the one size that is a
   * fact about the repository rather than about a particular build's pacing,
   * and the shelf orders and compares by it.
   */
  bytes: number;
  /** Null where the build wrote no sidecar; the card then says nothing rather than guessing. */
  commits: number | null;
  merges: number | null;
  contributors: number | null;
  /**
   * Seconds from click to first frame, timed at build time on the same machine
   * that captured the measurement. Null when that pass never got a reading.
   */
  openSeconds: number | null;
  /**
   * How long the performance itself runs, in seconds — not how long it takes to
   * arrive. Read off the loaded plan at build time, because nothing before the
   * plan exists knows it: length comes out of the pacing, and the pacing comes
   * out of the shape of the history.
   *
   * Null only for an entry indexed before this was recorded, and the card then
   * leads with its commit count alone rather than inventing a number.
   */
  durationSeconds: number | null;
  /**
   * Arrivals in the plan — visible commits, after routine pull requests have
   * collapsed into ribbons. Against `durationSeconds` it gives the pace, which
   * is the only number on the card that says whether the history can be
   * followed at all.
   */
  nodes: number | null;
  /**
   * Each calendar year the plan covers and how many seconds of stage time it
   * occupies, in order. Null for an entry indexed before spans existed, and
   * that card simply offers no year.
   */
  years: Array<[number, number]> | null;
}

/**
 * Above this many seconds, the card says how long it will take *before* it is
 * clicked, rather than after.
 *
 * A card that looks as instant as ripgrep's and then holds the page is the
 * worst thing this list could do, so where there is a wait it goes on the face
 * of the card, next to the picture, and not behind the click.
 *
 * It used to be a warning about *composition*, and about most of the shelf:
 * Kubernetes' 141,000 commits, 41% of them merges, were threaded, laid out and
 * choreographed in the tab before there was a first frame, and that took two
 * and a half minutes. Shipping the plans took it out of the tab. The same
 * entry now opens in five seconds, CPython in one and a half, and the whole
 * shelf but one is under eleven.
 *
 * Fifteen sits in a gap in the measurements rather than on top of one, which
 * is the only property a threshold like this needs. Under Rust's ten seconds
 * there is nothing until Linux at eighteen, so anything in between separates
 * the same two entries from the same ten — and fifteen has room on both sides
 * for a machine having a slower afternoon than the one that measured this. A
 * card that gains and loses its warning between builds is not describing
 * anything real.
 */
/*
 * Fifteen seconds was a threshold no entry could reach, so every warning
 * behind it was dead code: the slowest thing on the shelf records 14.2 and the
 * next is 9.2, and nothing on any card or in any dialog mentioned the wait at
 * all. Measured from the click to the first frame — which is the wait a
 * visitor actually experiences — Linux is 21.0-26.9s against its recorded
 * 14.2, Rust 15.1 against 9.2, Kubernetes 9.1 against 4.7. The figures are
 * two to three times optimistic because they time the fetch and not the parse.
 * Five is the level at which a wait is worth mentioning.
 */
const SLOW_SECONDS = 5;

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * How many commits this show actually draws, one at a time.
 *
 * ## Why the card needs this number
 *
 * A first-time visitor read the shelf side by side and concluded, correctly
 * from what it said, that the numbers on it mean nothing:
 *
 * | entry | commits | runs |
 * | --- | --- | --- |
 * | Chromium | 1,817,062 | 2 min 45 s |
 * | Linux | 1,481,850 | 12 h |
 * | LLVM | 595,778 | 2 min 35 s |
 * | Rust | 339,084 | 8 h 58 min |
 *
 * Chromium's own blurb says "larger than Linux", the card headlines COMMITS,
 * and the page above insists nothing is shortened by playing it faster than it
 * can be followed. All three are true and together they are unintelligible: a
 * 1.8-million-commit history in under three minutes, beside one where 1.4
 * million takes twelve hours.
 *
 * The missing quantity is the one the pacing is actually built on. `compile.ts`
 * gives every *visible* arrival the same beat — `SECONDS_PER_NODE` — and
 * collapses routine pull requests into counted ribbons until what is left fits
 * the budget. So the length follows the arrivals and not the commits, and the
 * collapse rate is what differs by four orders of magnitude across this shelf:
 * Kubernetes keeps 89.4% of its commits as arrivals, Chromium keeps 0.07%.
 * Chromium is a million and a half commits on one straight line with 64 merges
 * in the whole repository; Linux has 111,926, and a merge of a branch with a
 * story of its own cannot be collapsed without hiding what happened.
 *
 * ## Why it is derived here rather than read off the index
 *
 * The index does carry a `nodes` field, and it is not this. It is written from
 * `window.__gittimeline.pace.nodes`, which is `perf.nodes.length` — the nodes
 * resident in the *streamed window* around the playhead at the moment the
 * indexer read it. Measured: Linux 533, Chromium 291, mdBook 327, against
 * plans of 332,275, 1,237 and 1,221 arrivals. Those numbers describe the
 * buffer, not the show, and putting one on a card would be a fourth wrong
 * figure for a history rather than a first right one.
 *
 * The length, on the other hand, is exact and shipped: `duration = FRAME_SECONDS
 * + arrivals x SECONDS_PER_NODE`, so the arrivals come back out of it. Checked
 * against the two figures the codebase records independently — 332,279 arrivals
 * for Linux (`compile.ts`) and 10.6% of Kubernetes collapsed away — this
 * inversion reproduces both to within a rounding step.
 *
 * It is reported to two significant figures for exactly that reason. The index
 * stores `Math.round(duration)`, so the last arrival or two is not recoverable,
 * and "1,237" would be claiming a precision this arithmetic does not have.
 * "1,200" is the same fact without the false decimals.
 */
function arrivalsOf(durationSeconds: number): number {
  const exact = Math.max(0, (durationSeconds - FRAME_SECONDS) / SECONDS_PER_NODE);
  if (exact < 100) return Math.round(exact);
  const step = Math.pow(10, Math.floor(Math.log10(exact)) - 1);
  return Math.round(exact / step) * step;
}

/** One decimal below ten megabytes, whole numbers above: 0.4 MB, 18 MB, 222 MB. */
const size = (bytes: number) => (bytes >= 1e7 ? `${Math.round(bytes / 1e6)} MB` : `${(bytes / 1e6).toFixed(1)} MB`);

/** Rounded *up* into minutes, because a wait that runs past its own estimate is the one that feels broken. */
const wait = (seconds: number) => (seconds < 90 ? `${Math.round(seconds)} seconds` : `${Math.ceil(seconds / 60)} minutes`);

/** The same wait, short enough for the pill on the picture: `26 s`, `3 min`. */
const waitShort = (seconds: number) => (seconds < 90 ? `${Math.round(seconds)} s` : `${Math.ceil(seconds / 60)} min`);

/**
 * How long the performance runs, read as a length rather than a clock.
 *
 * `12:43` is how a video player labels a position you are already inside; on a
 * card nobody has clicked yet the question is "how much of my evening is this",
 * and the answer to that is words. Seconds stay in below the minute. The hour
 * branch is no longer theoretical: with no cap on length, Linux's 332,279
 * arrivals at a beat each come to twelve hours, and a card that rounded that to
 * "720 min" would be hiding the number it most needs to give you.
 */
const runtime = (seconds: number) => {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
};

/**
 * A hue for this entry's panel, the same one every time.
 *
 * Deterministic from the slug — `hash01` is FNV-1a over the string — because a
 * shelf whose colours moved between loads would read as decoration rather than
 * as identity, and because there is no randomness in `src` to reach for anyway.
 * Only the hue is taken: saturation and lightness are fixed in the stylesheet
 * so that no entry can draw a brighter panel than its neighbours.
 */
const tintOf = (slug: string) => Math.round(hash01(slug) * 360);

/**
 * Per-year running time as a row of columns.
 *
 * Heights are square-rooted rather than linear. A repository's busiest year is
 * routinely twenty times its quietest, and on a linear scale that leaves one
 * column full height and the rest a flat line along the bottom — technically
 * accurate and unreadable. The root keeps the ordering exact while letting the
 * quiet years still register as years rather than as nothing.
 */
function Pulse({ years }: { years: Array<[number, number]> }) {
  const peak = Math.max(...years.map(([, secs]) => secs), 1);
  return (
    <span class="catalog-pulse" aria-hidden="true">
      {years.map(([year, secs]) => (
        <i key={year} style={`height:${(Math.sqrt(secs / peak) * 100).toFixed(1)}%`} />
      ))}
    </span>
  );
}

/**
 * The years of this entry worth offering as a span, most recent first.
 *
 * A year later than this one is not a year of anything, whatever the plan says.
 * Offering one would put a repository's data-quality problem in front of
 * somebody as though it were a choice. Nothing is hidden by leaving it out —
 * the whole history plays every arrival, in order, whatever date each one
 * claims, and it is the default.
 *
 * `correctTimestamps` now refuses to propagate a stamp from after the moment
 * the repository was read, so no shipped plan reaches a future year any more.
 * This is the second line rather than the first: a plan is written once and
 * played by everyone, and an old artifact should not be able to put "2085" in
 * a dropdown.
 *
 * ## Every year the plan covers, and no floor
 *
 * There used to be one: `spanFloor`, eight seconds or a five-hundredth of the
 * show, whichever was larger. It was removed, because what it produced was a
 * picker with holes in it under a badge claiming the whole repository. Measured
 * against the shipped index:
 *
 *  - **React** offered 13, 14, 15, 16, 17, 19 — no 2018, and nothing after
 *    2019 — while the player's badge read `2013–2026 · ENTIRE REPO`.
 *  - **mdBook** skipped 2016 and 2024, and January and March of 2016 play, with
 *    commits in them, in the show the same card starts.
 *  - **LLVM** dropped eleven of its twenty-one years, **Chromium** eleven of
 *    twenty, **CPython** six, **Node** three.
 *
 * A viewer who has just watched 2016 go past cannot be told 2016 is not
 * offered; there is no reading of that which is not a bug. And the floor had a
 * second effect that was worse than the first: `CatalogScope` sums the *offered*
 * years to price "the whole history", so mdBook's card said 2 min 43 s and the
 * readout twenty pixels above its own button said 2 min 31 s — the twelve
 * seconds that the two dropped years hold.
 *
 * The reason a floor was wanted at all — that a one-second year is not worth
 * watching — is now answered by the track rather than by hiding it. Every year
 * is drawn as wide as the square root of its share, carries its own length in
 * its tooltip and label, and the readout under the track prices the selection
 * before it is committed. "2001 · 1 s" is a year a viewer can see is not worth
 * picking, which is a better answer than a gap they cannot see at all.
 */
function offeredYears(e: CatalogEntry): Array<[number, number]> {
  return [...realYears(e)].reverse();
}

/**
 * The years of this entry that are years, oldest first.
 *
 * A year later than this one is not a year of anything, whatever the plan says.
 * Both the picture and the choice would otherwise be showing a repository's
 * data-quality problem as though it were a fact about the project — Linux's
 * plan used to spend nine of its twelve hours in "2037" and "2085", which was
 * 90% of its columns.
 *
 * The cause is fixed in `correctTimestamps` and no plan built since reaches a
 * future year. This remains for the artifacts built before it, because a plan
 * is written once and played by everyone.
 *
 * Nothing is hidden by leaving them out. The whole history plays every arrival,
 * in order, whatever date each one claims, and it is the default.
 */
function realYears(e: CatalogEntry): Array<[number, number]> {
  const nowYear = new Date().getUTCFullYear();
  return (e.years ?? []).filter(([y]) => y <= nowYear);
}

function Card({ entry, featured }: { entry: CatalogEntry; featured: boolean }) {
  const e = entry;
  // Null unless it is slow enough to be worth naming, which is also the narrowing the JSX below needs.
  const slowFor = e.openSeconds != null && e.openSeconds >= SLOW_SECONDS ? e.openSeconds : null;
  // What the click actually pulls down. Where a plan ships, the dataset is not
  // fetched at all before the first frame — the plan replaces it — and the two
  // are not close enough to stand in for one another: Kubernetes' history is
  // 18 MB and its plan is 31, Linux's is 199 MB and its plan is 132. Quoting
  // the dataset was under-promising half this shelf and over-promising the rest.
  //
  // A span pulls down exactly the same bytes, which is the point of it: the
  // plan is not sliced, the clock is.
  const cost = e.planBytes ?? e.bytes;
  // A count the build never established is left out rather than printed as a
  // zero or a dash. Reading `null.toLocaleString()` here is what emptied this
  // whole page once: one entry from an older build with no sidecar threw
  // during render, Preact abandoned the rest of the tree, and the catalog
  // became a heading with nothing under it.
  const counts = [
    { n: e.merges, label: 'merges' },
    { n: e.contributors, label: 'people' },
  ].filter((c): c is { n: number; label: string } => typeof c.n === 'number');

  // The three facts a person actually chooses between, at the size that says so.
  //
  // How long it runs used not to be here at all, and its absence made the shelf
  // impossible to choose from honestly: every card said what it cost to arrive
  // and none of them said what you were arriving *at*. The pace beside it
  // answers the question that one raises — twelve hours of *what*? — and it is
  // the figure that a viewer can check the shelf against: every entry here
  // lands between five and eight arrivals a second, because the choreographer
  // gives each visible commit the same beat and the length follows from that
  // rather than the other way round.
  //
  // Merges and contributors stayed behind in the small line below, because
  // five counts in one row is a specification sheet — and once everything is
  // bold, none of it is.
  const figures = [
    // "LONG" was the label, and on a shelf of twelve cards all twelve said it.
    // It was written as a unit for the value above it — "2 min 43 s long" — and
    // rendered as a 9.5px uppercase caption under a bold number, which is the
    // shape of a *category*. A first-time visitor read the shelf as twelve
    // cards labelled LONG and asked what the other categories were. There is
    // no other category; it is how long the thing runs, so it says that.
    e.durationSeconds != null ? { value: runtime(e.durationSeconds), label: 'to watch' } : null,
    e.commits != null ? { value: fmt(e.commits), label: 'commits' } : null,
    // And how many of those commits get a beat of their own, which is the
    // number the length is actually made of. See `arrivalsOf`: without it this
    // shelf says a 1.8-million-commit history runs in under three minutes next
    // to one where 1.4 million takes twelve hours, and teaches a visitor that
    // the figures on it are decoration.
    //
    // Arrivals *per second* is still off the card. It is the number that
    // decides whether a history is watchable and it is meaningless to somebody
    // choosing between projects — "7.7/s" answers a question nobody standing at
    // a shelf is asking, and it is the same 7.7 on every entry here anyway.
    e.durationSeconds != null ? { value: fmt(arrivalsOf(e.durationSeconds)), label: 'on stage' } : null,
  ].filter((f): f is { value: string; label: string } => f !== null);

  const pulseYears = realYears(e);
  const open = () => {
    // Counted here rather than when a performance finally starts, because the
    // difference between the two is the interesting number: these are large
    // downloads and some of them are twelve-hour shows, and a card that is
    // opened and then backed out of is exactly what is worth knowing about.
    trackCatalogOpen(e.slug, e.commits);
    // One action per card. Which project is this card's question; how much of
    // it is the next one, and the scope chooser has always been where that is
    // asked. Nothing is fetched by asking — every answer is the same download.
    askCatalogScope({
      file: e.file,
      label: e.scope ? `${e.title} · ${e.scope}` : e.title,
      durationSeconds: e.durationSeconds ?? 0,
      // Derived, not `e.nodes`. The index's field is the streamed window's
      // resident node count and not the plan's arrivals — see `arrivalsOf` for
      // the three measurements that establish that — so passing it on would
      // put a number in `CatalogQuestion` that its own doc comment describes
      // wrongly.
      nodes: e.durationSeconds != null ? arrivalsOf(e.durationSeconds) : 0,
      commits: e.commits ?? 0,
      bytes: cost,
      openSeconds: e.openSeconds,
      years: offeredYears(e),
    });
  };

  return (
    <article class={`catalog-card${featured ? ' featured' : ''}`}>
      <button type="button" class="catalog-open" onClick={open} data-testid={`catalog-${e.slug.replace('/', '-')}`}>
        <span class="catalog-mark" style={`--tint:${tintOf(e.slug)}`}>
          <span class="catalog-plate">
            {e.logo ? (
              // Decorative, so it is not described: the title below already
              // says which project this is, and an alt text here would make a
              // screen reader announce the name twice.
              <img src={catalogUrl(e.logo)} alt="" loading="lazy" decoding="async" />
            ) : (
              <b aria-hidden="true">{e.slug.slice(0, 1).toUpperCase()}</b>
            )}
          </span>
          {/* The shape of the project's life, behind its mark.
              
              A logo says which project this is and nothing about it — every
              card would carry the same amount of information whether the
              repository had ten commits or a million. This is the plan's own
              per-year running time drawn as a column each, so the panel shows
              at a glance whether a project started fast and slowed, built
              steadily for a decade, or has only really been busy since last
              year. Kubernetes and CPython are both large and look nothing
              alike here, which is the point.
              
              It costs no new data: `years` is already in the index because
              the year selector needs it. Decorative, and marked so — the
              figures underneath state the same facts in words. */}
          {pulseYears.length > 1 && <Pulse years={pulseYears} />}
          {/* What it costs, on the panel and never hidden behind a hover. The
              page above promises no token and no requests, which is true and is
              not the whole price: this one is 199 MB on someone's phone plan.

              "wait", spelled out, because the caption below carries a second
              duration — how long the thing runs — and two bare numbers of
              minutes on one card that mean opposite things is worse than
              either alone. */}
          <span class={`catalog-cost${slowFor != null ? ' slow' : ''}`}>
            {externalCatalog ? `Streamed · ${size(cost)} total` : size(cost)}
            {slowFor != null && ` · ~${waitShort(slowFor)} wait`}
          </span>
          {/* The affordance is on the picture, where the eye already is. */}
          <span class="catalog-cue" aria-hidden="true">
            <svg viewBox="0 0 12 12" focusable="false">
              <path d="M3 1.6 L10 6 L3 10.4 Z" />
            </svg>
            Watch it all
          </span>
        </span>
        <span class="catalog-body">
          <span class="catalog-line">
            <span class="catalog-title">{e.title}</span>
            {e.scope && <em class="catalog-scope">{e.scope}</em>}
          </span>
          <span class="catalog-slug">{e.slug}</span>
          <span class="catalog-blurb">{e.blurb}</span>
          {figures.length > 0 && (
            <span class="catalog-figures">
              {figures.map((f) => (
                <span class="catalog-figure" key={f.label}>
                  <b>{f.value}</b>
                  <span>{f.label}</span>
                </span>
              ))}
            </span>
          )}
          {counts.length > 0 && (
            <span class="catalog-meta">
              {counts.map((c, i) => (
                <Fragment key={c.label}>
                  {i > 0 && <i />}
                  <b>{fmt(c.n)}</b>
                  {c.label}
                </Fragment>
              ))}
            </span>
          )}
          {/* Two different waits wearing the same number of seconds. Without a
              plan the tab is composing the history and the warning it used to
              print is exact. With one, nothing is being composed at all — the
              plan arrives finished and the wait is unpacking it, which is a
              sentence about size rather than about merge density, and telling
              somebody their tab is busy compiling when it is not is the kind of
              small lie that makes the honest numbers beside it harder to trust. */}
          {slowFor != null && (
            <span class="catalog-warn">
              {e.plan ? (
                <>
                  Shipped ready-made rather than composed here, but {size(cost)} of plan still takes about {wait(slowFor)} to unpack into a first frame
                  once it has arrived.
                </>
              ) : (
                <>Composed in this tab, not downloaded ready-made, about {wait(slowFor)} to the first frame.</>
              )}{' '}
              Progress is shown throughout, and it can be cancelled.
            </span>
          )}
        </span>
      </button>
      {/* The year choice is not here.
            
            It was a dropdown and a second button on every card, which turned a
            shelf of eleven projects into a shelf of eleven small forms and
            buried the one action a card exists for. Choosing a project and
            choosing how much of it are two decisions, and asking both at once
            asks neither clearly. The second one belongs after the click. */}
    </article>
  );
}

/** A number from JSON that may be absent, null, or something else entirely. */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `[[2016, 41.2], …]`, or null if the JSON does not hold a list of those. */
function toYears(raw: unknown): Array<[number, number]> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<[number, number]> = [];
  for (const row of raw) {
    if (!Array.isArray(row)) continue;
    const y = num(row[0]);
    const secs = num(row[1]);
    if (y != null && secs != null) out.push([y, secs]);
  }
  return out.length ? out : null;
}

/**
 * One catalog entry, or null if the JSON does not describe one.
 *
 * `index.json` is a static file that a build writes and nothing validates, and
 * casting it straight to `CatalogEntry[]` was a lie the type system happily
 * told: entries built before the sidecar existed carried `commits: null`
 * against a `number`, and the first card to format one took the entire page
 * down with it. Parsing at the boundary is the only place that mistake can be
 * caught, because after this line the types are true.
 */
function toEntry(raw: unknown): CatalogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.slug !== 'string' || typeof r.file !== 'string') return null;
  return {
    slug: r.slug,
    title: typeof r.title === 'string' ? r.title : r.slug,
    blurb: typeof r.blurb === 'string' ? r.blurb : '',
    scope: typeof r.scope === 'string' ? r.scope : null,
    file: r.file,
    logo: typeof r.logo === 'string' ? r.logo : null,
    plan: typeof r.plan === 'string' ? r.plan : null,
    planBytes: num(r.planBytes),
    bytes: num(r.bytes) ?? 0,
    commits: num(r.commits),
    merges: num(r.merges),
    contributors: num(r.contributors),
    openSeconds: num(r.openSeconds),
    durationSeconds: num(r.durationSeconds),
    nodes: num(r.nodes),
    years: toYears(r.years),
  };
}

/**
 * What the build put on the shelf, or null while that is unknown.
 *
 * Shared because the page around this list has to know what is on it: the row
 * of repositories that still need a token is only honest if it leaves out the
 * ones a build has since pre-fetched. The second read of a static JSON file
 * the browser has already cached is not worth threading state through the app
 * to avoid.
 */
export interface Shelf {
  entries: CatalogEntry[] | null;
  /**
   * The shelf is hosted elsewhere and could not be read.
   *
   * Distinct from `entries === null`, which also covers "still asking" and
   * "this build never had a shelf". Only the third state is worth saying out
   * loud, and only one of the three used to be possible: while the catalog was
   * published inside `dist`, a missing `index.json` meant the build shipped
   * without one and silence was the whole of the correct behaviour.
   *
   * It is served from an object store on another origin now. A failure there —
   * an outage, a DNS blip, a CORS rule edited by somebody — is not "this build
   * has no shelf"; it is twelve histories that exist and cannot be reached
   * this minute, and rendering nothing tells the visitor a landing page is
   * simply missing its main attraction.
   */
  unreachable: boolean;
}

export function useCatalogEntries(): Shelf {
  const [shelf, setShelf] = useState<Shelf>({ entries: null, unreachable: false });
  useEffect(() => {
    let live = true;
    // `externalCatalog` and nothing else decides whether a failure is worth
    // reporting, so a local build behaves exactly as it always did.
    const miss = () => {
      if (live && externalCatalog) setShelf({ entries: null, unreachable: true });
    };
    fetch(catalogUrl('index.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        const list = j && typeof j === 'object' ? (j as { entries?: unknown }).entries : null;
        if (!live) return;
        if (!Array.isArray(list)) return miss();
        const parsed = list.map(toEntry).filter((e): e is CatalogEntry => e !== null);
        if (parsed.length) setShelf({ entries: parsed, unreachable: false });
        else miss();
      })
      .catch(miss);
    return () => {
      live = false;
    };
  }, []);
  return shelf;
}

export function Catalog() {
  const { entries, unreachable } = useCatalogEntries();

  if (!entries) {
    if (!unreachable) return null;
    return (
      <section class="catalog-out" data-testid="catalog-unreachable" aria-label="Selection Ready to Watch">
        <p>
          The pre-fetched histories could not be reached just now. They are hosted separately from this page, so this is their
          problem and not yours, everything else here works, and a repository you paste in is fetched from GitHub as usual.
        </p>
        <button type="button" class="btn" onClick={() => location.reload()}>
          Try again
        </button>
      </section>
    );
  }
  const [first, ...rest] = entries;

  return (
    <section class="catalog" data-testid="catalog" aria-label="Selection Ready to Watch">
      {first && <Card entry={first} featured />}
      {rest.length > 0 && (
        <div class="catalog-grid">
          {rest.map((e) => (
            <Card key={e.slug} entry={e} featured={false} />
          ))}
        </div>
      )}
    </section>
  );
}
