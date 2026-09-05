import { SiteBar } from './SiteBar';
import { store } from './store';
import { Catalog, useCatalogEntries } from './Catalog';
import { showLanding } from './controller';

/**
 * The projects people ask for by name.
 *
 * None of them can be fetched by an anonymous visitor: Linux alone is 1.5
 * million commits, which is roughly fifteen thousand requests against an hourly
 * allowance of sixty. So these do not load on click — they fill the box on the
 * way back to the landing page, where the token note sits directly underneath
 * and the size probe will offer a span before a single request is spent.
 * Promising them as one-click and then failing would be worse than being clear
 * about the cost up front.
 *
 * The list is filtered against the shelf above, because the shelf is where
 * these belong and builds keep moving them there. A name in both places, under
 * a heading that says it is not pre-fetched, is simply untrue.
 */
const FAMOUS: Array<{ slug: string; note: string }> = [
  { slug: 'torvalds/linux', note: '1.5M commits' },
  { slug: 'kubernetes/kubernetes', note: '141k' },
  { slug: 'python/cpython', note: '133k' },
  { slug: 'rust-lang/rust', note: '339k' },
  { slug: 'microsoft/vscode', note: '165k' },
  { slug: 'nodejs/node', note: '48k' },
  { slug: 'facebook/react', note: '22k' },
  { slug: 'tensorflow/tensorflow', note: '199k' },
];

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
  const shelf = useCatalogEntries();
  const missing = FAMOUS.filter((f) => !shelf?.some((e) => e.slug.toLowerCase() === f.slug.toLowerCase()));
  return (
    <div class="page" data-testid="catalog-page">
      <SiteBar page="catalog" />
      <div class="page-inner">
        <button type="button" class="page-back" onClick={showLanding} data-testid="catalog-back">
          ← Back
        </button>
        <header class="page-head">
          <h1>Selection Ready to Watch</h1>
          <p class="page-lead">
            These histories were fetched ahead of time and ship with the site, so opening one costs no GitHub token and no requests at all. Every card
            says how long its performance runs and how fast its commits arrive, because those are the things you are choosing between — three minutes of
            a small tool and twelve hours of Linux are not the same evening, and nothing here is shortened by playing it faster than it can be followed.
            If a whole history is more than you want, each card also offers a single year of itself: that is the same plan with the clock told where to
            start and stop, so it costs the same one download and no waiting at all. What a card <em>does</em> cost is written on it too — the size of
            that download, and where unpacking it afterwards is long enough to notice, how long.
          </p>
        </header>
        <Catalog />
        {missing.length > 0 && (
          <section class="famous" aria-labelledby="famous-heading">
            <h2 id="famous-heading">The big ones</h2>
            <p>
              Not pre-fetched — these are the projects that need a GitHub token, and the ones worth spending it on. Picking one puts it in the box on the
              landing page; GitTimeline measures a repository before it fetches anything and will offer you a year or a recent span if the whole thing is
              too large to watch.
            </p>
            <div class="famous-row">
              {missing.map((f) => (
                <button
                  key={f.slug}
                  type="button"
                  onClick={() => {
                    store.input.value = f.slug;
                    store.inputError.value = null;
                    showLanding();
                  }}
                >
                  {f.slug}
                  <i>{f.note}</i>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
