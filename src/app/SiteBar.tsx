import { store } from './store';
import { showLanding } from './controller';
import { Wordmark } from './Wordmark';

/**
 * The bar across the top of every page that is not the performance itself.
 *
 * It lived only on the landing page, which meant the catalog and the sign-in
 * page each opened with a bare "← Back" and nothing else: no name, no way to
 * reach the other route without going home first, and no sign that the three
 * belonged to the same site. A visitor who arrived at the catalog by link had
 * no idea what they were looking at.
 *
 * The wordmark is a button on those pages and plain text on the landing page,
 * because a link to the page you are already on is a small lie — and because
 * on the landing page the hero says the name again immediately below, so a
 * second clickable copy is noise.
 */
export function SiteBar({ page }: { page: 'landing' | 'catalog' | 'signin' }) {
  const tokenActive = !!store.token.value;
  const mark = <Wordmark />;

  return (
    <header class="landing-bar" data-testid="site-bar">
      {page === 'landing' ? (
        <span class="landing-mark">{mark}</span>
      ) : (
        <button type="button" class="landing-mark as-link" onClick={showLanding} data-testid="site-home">
          {mark}
        </button>
      )}
      <nav class="landing-nav" aria-label="Site">
        {/* Every item on every page, always.
            
            The route you were already on used to be dropped on the reasoning
            that a nav item which does nothing is worse than one that is
            absent. It is not: removing it changes what the bar contains from
            page to page, so the whole thing shifts and resizes as you move
            around and no two pages look alike. A bar is furniture, and
            furniture that rearranges itself is the opposite of uniform.
            
            The current page is marked instead — `aria-current` for anyone
            listening, and a quiet brightening for anyone looking — and
            clicking it simply keeps you where you are. */}
        <button
          type="button"
          aria-current={page === 'catalog' ? 'page' : undefined}
          onClick={() => (store.mode.value = 'catalog')}
          data-testid="catalog-link"
        >
          Selection
        </button>
        <button
          type="button"
          onClick={() => (store.panel.value = store.panel.value === 'help' ? 'none' : 'help')}
        >
          How it works
        </button>
        <a href="https://github.com/THuynh-91/gittimeline" target="_blank" rel="noopener noreferrer">
          Source
        </a>
        <button
          type="button"
          class="nav-primary"
          aria-current={page === 'signin' ? 'page' : undefined}
          onClick={() => (store.mode.value = 'signin')}
          data-testid="signin-link"
        >
          {tokenActive ? 'GitHub connected' : 'Connect GitHub'}
        </button>
      </nav>
    </header>
  );
}
