import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { loadCatalogEntry } from './controller';

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
 * Each card leads with a *real frame of that performance* — captured at build
 * time — because the shape of a history is the thing worth choosing between,
 * and a column of repository names is not. The picture also sets an honest
 * expectation: a linear project and a pull-request treadmill look nothing
 * alike, and you can see which you are about to watch.
 *
 * Under the picture the card leads with two numbers at the same size: how long
 * the performance runs, and how many commits are in it. The second was always
 * here; the first was not, and a shelf that said what every entry cost to open
 * and never what it was worth staying for was asking people to choose blind.
 * Three minutes and thirty-five minutes are different offers, and which of them
 * a card is making should be legible from across the room.
 *
 * The owner's mark sits beside the title and is kept small, because it is there
 * to be recognised before the words are read and anything larger would argue
 * with the frame above it about which of the two is the picture. It is served
 * from this origin like everything else: the page allows no remote images at
 * all, which is the catalog's promise written somewhere a browser enforces it.
 *
 * That is why the first entry is given the full width. Four equal rows of
 * picture-and-caption reads as a table with illustrations however large the
 * illustrations are; one big frame with the rest ranged beneath it reads as a
 * gallery, and the frames are the point.
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
  poster: string | null;
  /**
   * The owner's avatar, downloaded at build time and served from this origin.
   * Null where that download failed; the card then names the owner and nothing
   * else, which is what it did before logos existed.
   */
  logo: string | null;
  bytes: number;
  /** Null where the build wrote no sidecar; the card then says nothing rather than guessing. */
  commits: number | null;
  merges: number | null;
  contributors: number | null;
  /**
   * Seconds from click to first frame, timed at build time on the same machine
   * that captured the thumbnail. Null when that pass never got a reading.
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
}

/**
 * Above this many seconds, the card says how long it will take *before* it is
 * clicked, rather than after.
 *
 * These are not slow downloads — Kubernetes is eighteen megabytes — they are
 * slow *compositions*: 141,000 commits of which 41% are merges have to be
 * threaded, laid out and choreographed in this tab before there is a first
 * frame. A card that looks as instant as ripgrep's and then holds the page for
 * two and a half minutes is the worst thing this list could do, so the cost
 * goes on the face of the card, next to the picture.
 *
 * Fifteen sits in a gap in the measurements rather than on top of one. What the
 * shelf actually contains is four entries under three seconds and then nothing
 * at all until CPython in the low twenties, so a threshold anywhere in between
 * separates the same two groups — but one at twenty lands right on CPython,
 * which times between 12 and 21 seconds depending on what else the build
 * machine is doing, and a card that gains and loses its warning between builds
 * is not describing anything real.
 */
const SLOW_SECONDS = 15;

const fmt = (n: number) => n.toLocaleString('en-US');

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
 * and the answer to that is words. Seconds stay in below the hour, because the
 * difference between four minutes and four and a half is the difference between
 * watching it now and watching it later. Nothing here reaches the hour — the
 * choreographer caps a performance at thirty-five minutes — so that branch is
 * only so a cap raised one day does not have the card printing `95 min`.
 */
const runtime = (seconds: number) => {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
};

function Card({ entry, featured }: { entry: CatalogEntry; featured: boolean }) {
  const e = entry;
  // Null unless it is slow enough to be worth naming, which is also the narrowing the JSX below needs.
  const slowFor = e.openSeconds != null && e.openSeconds >= SLOW_SECONDS ? e.openSeconds : null;
  // A count the build never established is left out rather than printed as a
  // zero or a dash. Reading `null.toLocaleString()` here is what emptied this
  // whole page once: one entry from an older build with no sidecar threw
  // during render, Preact abandoned the rest of the tree, and the catalog
  // became a heading with nothing under it.
  const counts = [
    { n: e.merges, label: 'merges' },
    { n: e.contributors, label: 'people' },
  ].filter((c): c is { n: number; label: string } => typeof c.n === 'number');

  // The two facts a person actually chooses between, at the size that says so.
  //
  // How long it runs used not to be here at all, and its absence made the shelf
  // impossible to choose from honestly: every card said what it cost to arrive
  // and none of them said what you were arriving *at*. A visitor deciding
  // between these is deciding how to spend the next half hour, and mdBook's
  // three minutes and Linux's thirty-five are not the same offer.
  //
  // Merges and contributors stayed behind in the small line below, because
  // three counts and a length in one row is a specification sheet — and once
  // everything is bold, the length is not.
  const figures = [
    e.durationSeconds != null ? { value: runtime(e.durationSeconds), label: 'long' } : null,
    e.commits != null ? { value: fmt(e.commits), label: 'commits' } : null,
  ].filter((f): f is { value: string; label: string } => f !== null);

  return (
    <button
      type="button"
      class={`catalog-card${featured ? ' featured' : ''}`}
      onClick={() => void loadCatalogEntry(e.file, e.scope ? `${e.title} · ${e.scope}` : e.title)}
      data-testid={`catalog-${e.slug.replace('/', '-')}`}
    >
      <span class="catalog-shot">
        {e.poster ? (
          <img src={`${import.meta.env.BASE_URL}catalog/${e.poster}`} alt={`The shape of ${e.slug}'s history`} loading="lazy" decoding="async" />
        ) : (
          // A build can produce an artifact and fail to capture a frame of it.
          // An empty black rectangle reads as a broken image; the name set into
          // an empty plate reads as a card whose picture has not been taken.
          <span class="catalog-noshot">{e.slug}</span>
        )}
        {/* What it costs, on the picture and never hidden behind a hover. The
            page above promises no token and no requests, which is true and is
            not the whole price: this one is 222 MB on someone's phone plan.

            "wait", spelled out, because the caption below now carries a second
            duration — how long the thing runs — and two bare numbers of minutes
            on one card that mean opposite things is worse than either alone. */}
        <span class={`catalog-cost${slowFor != null ? ' slow' : ''}`}>
          {size(e.bytes)}
          {slowFor != null && ` · ~${waitShort(slowFor)} wait`}
        </span>
        {/* The affordance is on the picture, where the eye already is. */}
        <span class="catalog-cue" aria-hidden="true">
          <svg viewBox="0 0 12 12" focusable="false">
            <path d="M3 1.6 L10 6 L3 10.4 Z" />
          </svg>
          Watch
        </span>
      </span>
      <span class="catalog-body">
        <span class="catalog-line">
          {/* Decorative, so it is not described: the title beside it already
              says which project this is, and an alt text here would make a
              screen reader announce the name twice. */}
          {e.logo && <img class="catalog-logo" src={`${import.meta.env.BASE_URL}catalog/${e.logo}`} alt="" loading="lazy" decoding="async" />}
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
        {slowFor != null && (
          <span class="catalog-warn">
            Composed in this tab, not downloaded ready-made — about {wait(slowFor)} to the first frame. Progress is shown throughout, and it can be
            cancelled.
          </span>
        )}
      </span>
    </button>
  );
}

/** A number from JSON that may be absent, null, or something else entirely. */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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
    poster: typeof r.poster === 'string' ? r.poster : null,
    logo: typeof r.logo === 'string' ? r.logo : null,
    bytes: num(r.bytes) ?? 0,
    commits: num(r.commits),
    merges: num(r.merges),
    contributors: num(r.contributors),
    openSeconds: num(r.openSeconds),
    durationSeconds: num(r.durationSeconds),
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
export function useCatalogEntries(): CatalogEntry[] | null {
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.BASE_URL}catalog/index.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        const list = j && typeof j === 'object' ? (j as { entries?: unknown }).entries : null;
        if (!live || !Array.isArray(list)) return;
        const parsed = list.map(toEntry).filter((e): e is CatalogEntry => e !== null);
        if (parsed.length) setEntries(parsed);
      })
      .catch(() => {
        /* no catalog built: the section simply does not appear */
      });
    return () => {
      live = false;
    };
  }, []);
  return entries;
}

export function Catalog() {
  const entries = useCatalogEntries();

  if (!entries) return null;
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
