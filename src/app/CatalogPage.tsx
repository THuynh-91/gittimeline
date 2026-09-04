import { Catalog } from './Catalog';
import { showLanding } from './controller';

/**
 * The catalog on its own page.
 *
 * It was on the landing page and it did not belong there: the landing page
 * asks one question — which repository? — and a shelf of four alternatives
 * underneath it competes with the answer rather than supporting it. Here it
 * has room to be browsed, and the landing page goes back to being a single
 * input with the demo playing behind it.
 */
export function CatalogPage() {
  return (
    <div class="page" data-testid="catalog-page">
      <div class="page-inner">
        <button type="button" class="page-back" onClick={showLanding} data-testid="catalog-back">
          ← Back
        </button>
        <h1>Ready to watch</h1>
        <p class="page-lead">
          These histories were fetched ahead of time and ship with the site, so opening one costs no GitHub token and no requests at all. Each picture
          is a real frame of that performance, at the moment the whole history is on screen.
        </p>
        <Catalog heading={false} />
      </div>
    </div>
  );
}
