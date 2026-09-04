import { store } from './store';
import { chooseScope, cancel } from './controller';
import { legibleSecondsFor, predictVisible } from '@/choreography/pace';

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
