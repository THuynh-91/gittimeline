import { SiteBar } from './SiteBar';
import { SiteFoot } from './SiteFoot';
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
  const { entries: shelf } = useCatalogEntries();
  // Only once the shelf has actually answered.
  //
  // This read `!shelf?.some(...)`, and `shelf` is null both while the fetch is
  // in flight and when it fails. Optional chaining made that null mean "on the
  // shelf: no" for every candidate, so the page opened by listing all of them
  // under a heading that says they are not pre-fetched and need a token — a
  // flash of the wrong answer on every visit, and the settled state whenever
  // the host is down. Half of the ones named here are on the shelf.
  const missing = shelf ? FAMOUS.filter((f) => !shelf.some((e) => e.slug.toLowerCase() === f.slug.toLowerCase())) : [];
  return (
    <div class="page" data-testid="catalog-page">
      <SiteBar page="catalog" />
      <div class="page-inner">
        <button type="button" class="page-back" onClick={showLanding} data-testid="catalog-back">
          ← Back
        </button>
        <header class="page-head">
          <h1>Selection Ready to Watch</h1>
          {/* Cut from a hundred and fifty words to fifty, and the cut is the
              fix rather than a tidy-up.
              What was here argued the case for the cards: that length is what
              you choose between, that three minutes and twelve hours are not
              the same evening, that nothing is shortened by playing it faster
              than it can be followed. All true, all unread — a first-time
              visitor scrolled past it and then read the cards as proof that
              the numbers on them mean nothing, because the cards headlined
              commits and the length did not follow from the commits.
              The cards say it themselves now: a third figure for how many
              commits get a beat of their own on stage, which is the quantity
              the length is actually made of. So this says which three numbers
              a card carries and stops arguing. */}
          <p class="page-lead">
            Fetched ahead of time, so opening one costs no GitHub token and no requests at all. Each card says how long it runs, how many commits it
            holds, and how many of those get a beat of their own on stage, which is the number the length is made of. Pick one and it asks how much of
            it you want before it starts; every answer is the same one download.
          </p>
        </header>
        <Catalog />
        {missing.length > 0 && (
          <section class="famous" aria-labelledby="famous-heading">
            <h2 id="famous-heading">The big ones</h2>
            <p>
              Not pre-fetched, these are the projects that need a GitHub token, and the ones worth spending it on. Picking one puts it in the box on the
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
      <SiteFoot />
    </div>
  );
}
