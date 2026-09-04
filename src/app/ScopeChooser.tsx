import { store } from './store';
import { chooseScope, cancel } from './controller';

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
  const { displayName, estimatedCommits, firstYear, lastYear } = scope;
  const years: number[] = [];
  if (firstYear && lastYear) for (let y = lastYear; y >= firstYear && years.length < 12; y--) years.push(y);
  const approx = estimatedCommits ? estimatedCommits.toLocaleString('en-US') : 'a great many';
  const requests = estimatedCommits ? Math.ceil(estimatedCommits / 100) : null;

  return (
    <div class="prelude" role="dialog" aria-labelledby="scope-title" data-testid="scope-chooser">
      <div class="error-card scope-card">
        <h2 id="scope-title">{displayName} has about {approx} commits</h2>
        <p>
          The whole history is {requests ? `about ${requests} requests` : 'a large fetch'} and plays at the three-minute ceiling, where commits land too quickly to follow individually. A single year is quicker to load and much easier to watch.
        </p>
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
            Everything
          </button>
          <button type="button" class="btn" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
