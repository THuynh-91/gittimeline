import { store } from './store';
import { play, showLanding } from './controller';

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
  const mark = (
    <>
      <span class="landing-dot" aria-hidden="true" />
      {/* Two words, and the name only makes sense as two: a *timeline* of
          *Git*. Splitting the colour rather than adding a space keeps the
          wordmark one object while letting each half be read. Ivory is the
          default branch on the stage and the accent is what this app adds on
          top of it, so the two halves use the same vocabulary as the picture. */}
      <span class="mark-git">Git</span>
      <span class="mark-time">Timeline</span>
    </>
  );

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
        {/* Ordered by how many people want each one. Browsing something that
            costs nothing comes first; the account action is last and on the
            right, where a primary action is looked for. The route you are
            already on is dropped rather than shown inert — a nav item that
            does nothing when clicked is worse than one that is absent. */}
        {page !== 'catalog' && (
          <button type="button" onClick={() => (store.mode.value = 'catalog')} data-testid="catalog-link">
            Selection
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            store.panel.value = 'help';
            play();
          }}
        >
          How it works
        </button>
        <a href="https://github.com/THuynh-91/gittimeline" target="_blank" rel="noopener noreferrer">
          Source
        </a>
        {page !== 'signin' && (
          <button type="button" class="nav-primary" onClick={() => (store.mode.value = 'signin')} data-testid="signin-link">
            {tokenActive ? 'GitHub connected' : 'Connect GitHub'}
          </button>
        )}
      </nav>
    </header>
  );
}
