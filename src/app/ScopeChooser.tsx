import { useState } from 'preact/hooks';
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

  const pace = q.durationSeconds > 0 ? q.nodes / q.durationSeconds : 0;
  const size = q.bytes >= 1e7 ? `${Math.round(q.bytes / 1e6)} MB` : `${(q.bytes / 1e6).toFixed(1)} MB`;

  // What fraction of the history is drawn as its own arrival rather than
  // gathered into a ribbon. Null when the entry does not say.
  const drawn = q.nodes ?? null;
  const drawnShare = drawn != null && q.commits ? drawn / q.commits : null;
  const commitsLabel = q.commits >= 1e6 ? `${(q.commits / 1e6).toFixed(1)} million` : q.commits.toLocaleString();
  return (
    <div class="prelude" role="dialog" aria-labelledby="scope-title" data-testid="scope-chooser">
      <div class="error-card scope-card">
        <h2 id="scope-title">{q.label}</h2>
        <p>
          {/* "Every one of them gets its own beat" is true of most of the
              shelf and wildly untrue of the top of it. Chromium draws 923
              arrivals out of 1,817,062 commits and LLVM 894 out of 595,778 —
              0.05% and 0.15% — because the compiler collapses dense stretches
              into aggregate ribbons rather than drawing every commit. That is
              a good decision and the sentence describing it was not: it told
              someone about to spend three minutes that they were about to
              watch 1.8 million commits arrive one at a time. So the claim is
              made only when it holds, and the rest of the time the ribbons are
              named for what they are. */}
          The whole history runs {runtime(q.durationSeconds)} and lands {pace.toFixed(1)} arrivals a second
          {drawnShare == null || drawnShare >= 0.5
            ? ' — every commit gets its own beat, so nothing here is going faster than it can be followed. It is simply that long.'
            : `, gathering ${commitsLabel} commits into them. Long runs of steady work arrive as one broad stroke rather than a commit at a time, which is the only way a history this size is watchable at all.`}{' '}
          {years.length > 1 && <>Any stretch of it costs the same {size} download, played from a different place to a different place.{' '}</>}
          {q.openSeconds != null && q.openSeconds >= 5 && <>Either way it is about {Math.round(q.openSeconds)} seconds from here to the first frame.</>}
        </p>

        {years.length > 1 && lo != null && hi != null && (
          <div class="scope-range">
            <label>
              <span>From</span>
              <select value={String(from)} onChange={(e) => setFrom(Number((e.target as HTMLSelectElement).value))} data-testid="scope-from">
                {years.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>To</span>
              <select value={String(to)} onChange={(e) => setTo(Number((e.target as HTMLSelectElement).value))} data-testid="scope-to">
                {years.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <p class="scope-range-out" data-testid="scope-range-runtime">
              {whole ? 'the whole history' : chosen} · <b>{runtime(chosenSecs)}</b>
            </p>
          </div>
        )}

        <div class="btn-row">
          <button
            type="button"
            class="btn primary"
            onClick={() => chooseCatalogSpan(whole || lo == null || hi == null ? null : { from: lo, to: hi })}
            data-testid="scope-full"
          >
            {whole || lo == null ? `Watch everything · ${runtime(q.durationSeconds)}` : `Watch ${chosen} · ${runtime(chosenSecs)}`}
          </button>
          <button type="button" class="btn" onClick={dismissScope} data-testid="scope-cancel">
            Not this one
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
