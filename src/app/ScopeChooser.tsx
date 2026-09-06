import { useEffect, useRef, useState } from 'preact/hooks';
import { store, type CatalogQuestion } from './store';
import { chooseScope, chooseCatalogSpan, dismissScope, cancel } from './controller';
import { legibleSecondsFor, predictVisible } from '@/choreography/pace';

/**
 * How long something runs, in words rather than as a clock.
 *
 * `12:43` is a position you are already inside; the question here is "how much
 * of my evening is this", and the answer to that is words. The hour branch is
 * not theoretical — with no cap on length, Linux's 332,279 arrivals at a beat
 * each come to twelve hours.
 */
function runtime(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}

/**
 * The same question, asked of a history that is already composed.
 *
 * Everything the live path has to predict from two probe requests is measured
 * here, because the plan exists and shipped with the site: the length is what
 * it runs, the pace is what actually arrives, and each year's share of the
 * running time was read off the plan's own clock.
 *
 * So this says nothing about requests or fetching, and it never warns anybody
 * off. Every answer costs the same one download — a span is that same plan with
 * the clock told where to start and where to stop — and the whole history is
 * the primary action, because it is the offer.
 */
function CatalogScope({ q }: { q: CatalogQuestion }) {
  const years = q.years.map(([y]) => y).sort((x, y) => x - y);
  const first = years.length ? years[0]! : null;
  const last = years.length ? years[years.length - 1]! : null;

  // The viewer picks both ends.
  //
  // This offered three fixed answers — the last two years, the last five, and
  // a row of single years — which is a menu of guesses about what somebody
  // wants. They know. A start and an end is the same two numbers the clock
  // needs either way, so letting them be chosen costs nothing and stops the
  // dialog pretending "2015–2019" is a more natural request than "2011–2017".
  const [from, setFrom] = useState<number | null>(first);
  const [to, setTo] = useState<number | null>(last);

  // Summed from the plan's own year table, so the length on the button is the
  // length that will actually run — recomputed as they choose rather than
  // precomputed for a handful of ranges.
  const spanSeconds = (lo: number, hi: number) => q.years.reduce((n, [y, secs]) => (y >= lo && y <= hi ? n + secs : n), 0);
  const lo = from != null && to != null ? Math.min(from, to) : null;
  const hi = from != null && to != null ? Math.max(from, to) : null;
  const chosenSecs = lo != null && hi != null ? spanSeconds(lo, hi) : 0;
  const whole = lo === first && hi === last;
  // `2015`, not `2015–2015`. One year is a year, and a range of it to itself
  // reads as a typo in the one place the dialog is being precise.
  const chosen = lo == null || hi == null ? '' : lo === hi ? String(lo) : `${lo}–${hi}`;

  const size = q.bytes >= 1e7 ? `${Math.round(q.bytes / 1e6)} MB` : `${(q.bytes / 1e6).toFixed(1)} MB`;
  const secondsOf = (y: number) => q.years.find(([yy]) => yy === y)?.[1] ?? 0;

  // Click one year, then another. Two clicks, no menus.
  //
  // This was two `<select>`s. A native menu of twenty-two years is a scroll
  // through a list to answer a question that is really "which part of this",
  // and it threw away the one thing the dialog knows that the viewer does
  // not: the years are wildly uneven. Two of Linux's twenty-one hold as much
  // of the running time as eight others put together, and a menu renders them
  // all the same height. The track below is the same choice made by pointing
  // at it, with each year as wide as the share of the show it actually is.
  const [pending, setPending] = useState(false);
  const pick = (y: number) => {
    if (!pending) {
      setFrom(y);
      setTo(y);
      setPending(true);
      return;
    }
    setTo(y);
    setPending(false);
  };

  // Dragging across the track picks a range in one gesture, and clicking two
  // years still does. Both, because they suit different intents: a drag is for
  // "roughly this stretch", and two clicks are for "exactly 2014 to 2019" —
  // and two clicks are what a keyboard has anyway.
  //
  // The gesture is judged on release rather than on press. Pressing does not
  // change the selection; if the pointer never reaches a different year it was
  // a click and goes through `pick`, and if it does, it was a drag and the two
  // ends are the year pressed and the year under the pointer. Deciding on
  // press instead would make every drag start by destroying the selection the
  // drag was about to replace, which flickers.
  const anchor = useRef<number | null>(null);
  const dragged = useRef(false);
  const card = useRef<HTMLDivElement>(null);

  /**
   * Keyboard focus, held inside the dialog while it is open.
   *
   * `aria-modal` is a promise made to assistive technology and to nothing
   * else: the browser still lets Tab walk straight out of the card and into
   * the page behind it, which is dimmed, inert to the eye and fully reachable
   * by the keyboard. Someone tabbing through this had to cross the whole
   * landing page to reach the year they wanted, and could leave the dialog
   * without ever knowing they had.
   *
   * Focus goes to the card rather than to a control, so a screen reader reads
   * the title and the cost before the question, and it goes back where it came
   * from on close — otherwise dismissing this drops focus onto `<body>` and
   * the next Tab starts again from the top of the document.
   */
  useEffect(() => {
    const root = card.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    root.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const stops = Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
      );
      if (!stops.length) {
        e.preventDefault();
        return;
      }
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const here = document.activeElement;
      // Coming off the card itself, Tab has nowhere to have been, so it goes
      // to the first control and Shift+Tab to the last.
      if (here === root) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && here === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && here === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);
  const [dragging, setDragging] = useState(false);
  // Pointer capture sends every subsequent event to the track, so the year
  // under the pointer has to be found by hit-testing rather than read off the
  // event's target.
  const yearAt = (clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const btn = el instanceof Element ? el.closest<HTMLElement>('[data-year]') : null;
    return btn ? Number(btn.dataset.year) : null;
  };
  const onDown = (e: PointerEvent) => {
    const y = yearAt(e.clientX, e.clientY);
    if (y == null) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    anchor.current = y;
    dragged.current = false;
    setDragging(true);
  };
  const onMove = (e: PointerEvent) => {
    if (anchor.current == null) return;
    const y = yearAt(e.clientX, e.clientY);
    if (y == null || y === anchor.current) return;
    dragged.current = true;
    setFrom(Math.min(anchor.current, y));
    setTo(Math.max(anchor.current, y));
    setPending(false);
  };
  const onUp = () => {
    if (anchor.current != null && !dragged.current) pick(anchor.current);
    anchor.current = null;
    setDragging(false);
  };
  return (
    <div
      class="prelude"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scope-title"
      data-testid="scope-chooser"
      // Dismissed by the backdrop as well as by Escape and the button. A dim
      // overlay that swallows the click is a dead end, and it was one: this
      // was the only modal in the app with no way out but a specific button.
      // `mousedown` and a target check rather than `click`, so a drag that
      // starts on the card and ends on the backdrop does not dismiss it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismissScope();
      }}
    >
      <div class="error-card scope-card" ref={card} tabIndex={-1}>
        <h2 id="scope-title">{q.label}</h2>
        <p>
          {/* What it costs to watch, and nothing about how it is built.
              This used to open with the arrival rate — "lands 7.7 arrivals a
              second, gathering 1.5 million commits into them" — which is a
              fact about the compiler, offered to somebody deciding how to
              spend an evening. How long, how big, how soon: that is the whole
              question at this point. */}
          {runtime(q.durationSeconds)} long, {size}{import.meta.env.VITE_CATALOG_BASE ? ' in the complete package. Only the sections you watch are downloaded.' : ' to download.'}
          {!import.meta.env.VITE_CATALOG_BASE && years.length > 1 && <> Any stretch of it costs the same download.</>}
          {q.openSeconds != null && q.openSeconds >= 5 && <> About {Math.round(q.openSeconds)} seconds from here to the first frame.</>}
        </p>

        {years.length > 1 && lo != null && hi != null && (
          <div class="scope-range">
            <div
              class={`scope-track${dragging ? ' dragging' : ''}`}
              role="group"
              aria-label="Choose a range of years — click two, or drag across"
              data-testid="scope-track"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              {years.map((y) => {
                const inside = y >= lo && y <= hi;
                return (
                  <button
                    key={y}
                    type="button"
                    class={`scope-year${inside ? ' in' : ''}${y === lo || y === hi ? ' edge' : ''}`}
                    // Wider for the years that hold more of the show, but by
                    // the square root of it rather than in proportion. Raw
                    // proportion is honest and unusable: Linux's 2005 is a
                    // rounding error beside its 2015, so the first four years
                    // collapsed to slivers too narrow to hold their own digits
                    // and the track looked broken. The root keeps the ordering
                    // and the sense of shape while leaving every year legible.
                    style={{ flexGrow: Math.max(0.6, Math.sqrt(secondsOf(y))) }}
                    aria-pressed={inside}
                    aria-label={`${y}, ${runtime(secondsOf(y))}`}
                    title={`${y} · ${runtime(secondsOf(y))}`}
                    data-year={y}
                    // The pointer path handles mouse and touch; this is left for
                    // the keyboard, where Enter and Space raise a click with no
                    // pointer sequence behind it.
                    onClick={(e) => {
                      if (e.detail !== 0) return;
                      pick(y);
                    }}
                    data-testid={`scope-year-${y}`}
                  >
                    <span>{String(y).slice(2)}</span>
                  </button>
                );
              })}
            </div>
            <div class="scope-ends">
              <span>{first}</span>
              <p class="scope-range-out" data-testid="scope-range-runtime">
                {whole ? 'the whole history' : chosen} · <b>{runtime(chosenSecs)}</b>
                {!whole && (
                  <button
                    type="button"
                    class="scope-reset"
                    onClick={() => {
                      setFrom(first);
                      setTo(last);
                      setPending(false);
                    }}
                  >
                    all of it
                  </button>
                )}
              </p>
              <span>{last}</span>
            </div>
          </div>
        )}

        {/* The way out sits opposite the way in, at the far corner. Beside
            the primary it is a second thing to read before choosing; pushed to
            the other end it is where a dialog's dismiss has always been, and
            the eye stops passing over it on the way to the button that matters. */}
        <div class="btn-row scope-actions">
          <button
            type="button"
            class="btn primary"
            onClick={() => chooseCatalogSpan(whole || lo == null || hi == null ? null : { from: lo, to: hi })}
            data-testid="scope-full"
          >
            {whole || lo == null ? `Watch everything · ${runtime(q.durationSeconds)}` : `Watch ${chosen} · ${runtime(chosenSecs)}`}
          </button>
          <button type="button" class="btn scope-close" onClick={dismissScope} data-testid="scope-cancel">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A big repository is a decision, not a default. Fetching a decade of history
 * costs hundreds of requests and produces a performance so dense that individual
 * commits stop reading, so when a project turns out to be large we say how large
 * and let the viewer pick a span before spending anything.
 *
 * Whatever is chosen, coverage stays honest: a scoped run is labelled partial
 * and the commits outside the span are shown as unloaded, never as absent.
 */
export function ScopeChooser() {
  const scope = store.scope.value;
  if (!scope) return null;
  // A catalog entry is the same question about a history that has already been
  // composed, so it is answered from measurements rather than from a forecast.
  // It shares this component rather than getting one of its own: two dialogs
  // asking "how much of this do you want" in two visual languages would be
  // worse than either.
  if (scope.reason === 'catalog' && scope.plan) return <CatalogScope q={scope.plan} />;
  const { displayName, estimatedCommits, firstYear, lastYear, reason, mergeRatio } = scope;
  const years: number[] = [];
  if (firstYear && lastYear) for (let y = lastYear; y >= firstYear && years.length < 12; y--) years.push(y);
  const approx = estimatedCommits ? estimatedCommits.toLocaleString('en-US') : 'a great many';
  const requests = estimatedCommits ? Math.ceil(estimatedCommits / 100) : null;
  // What the whole history could cost to watch, at the pace that keeps every
  // arrival visible. Nothing is truncated, so this is never an under-estimate —
  // but a history whose merges are all routine pull requests collapses into
  // ribbons and comes in well under it, and the estimate cannot tell the two
  // apart from two probe requests. So it is offered as an upper bound.
  const fullMinutes =
    estimatedCommits && mergeRatio != null
      ? Math.round(legibleSecondsFor(predictVisible(estimatedCommits, mergeRatio)) / 60)
      : null;

  return (
    <div class="prelude" role="dialog" aria-labelledby="scope-title" data-testid="scope-chooser">
      <div class="error-card scope-card">
        <h2 id="scope-title">{displayName} has about {approx} commits</h2>
        {reason === 'dense' ? (
          <p>
            About {Math.round((mergeRatio ?? 0) * 100)}% of its recent commits are merges. A routine pull request — a branch that left the main line,
            carried a commit or two and was merged straight back — collapses into a ribbon, but a branch with a story of its own is a branch point
            that cannot be collapsed without hiding what happened, so a merge-heavy history can keep nearly all of its commits on stage. Shown at a
            pace you can actually follow, the whole thing runs {fullMinutes ? `up to ${fullMinutes} minutes` : 'a very long time'}. A single year is
            loaded quickly and watched in a couple.
          </p>
        ) : (
          <p>
            The whole history is {requests ? `about ${requests} requests` : 'a large fetch'} and runs up against the six-minute ceiling, where commits
            land too quickly to follow individually. A single year is quicker to load and much easier to watch.
          </p>
        )}
        <div class="scope-years">
          {years.map((y) => (
            <button type="button" key={y} class="btn small" onClick={() => chooseScope({ since: `${y}-01-01T00:00:00Z`, until: `${y + 1}-01-01T00:00:00Z`, label: String(y) })}>
              {y}
            </button>
          ))}
        </div>
        <div class="btn-row">
          {lastYear && (
            <button type="button" class="btn primary" onClick={() => chooseScope({ since: `${lastYear - 1}-01-01T00:00:00Z`, until: null, label: `${lastYear - 1}–${lastYear}` })}>
              The last two years
            </button>
          )}
          {firstYear && lastYear && lastYear - firstYear > 4 && (
            <button type="button" class="btn" onClick={() => chooseScope({ since: `${lastYear - 4}-01-01T00:00:00Z`, until: null, label: `${lastYear - 4}–${lastYear}` })}>
              The last five years
            </button>
          )}
          <button type="button" class="btn" onClick={() => chooseScope({ since: null, until: null, label: 'the full history' })} data-testid="scope-full">
            {reason === 'dense' && fullMinutes ? `Everything · up to ${fullMinutes} min` : 'Everything'}
          </button>
          <button type="button" class="btn" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
