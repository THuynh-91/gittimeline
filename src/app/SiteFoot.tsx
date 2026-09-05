/**
 * The one ask, at the bottom of every page.
 *
 * It lived in the landing page's own footer, which meant it existed on exactly
 * one of the three routes — and not the one people spend time on. Someone who
 * came in, went to the selection page and browsed the shelf never saw it at
 * all and reasonably concluded it had been taken away.
 *
 * Still a footer rather than a nav item: nothing here is paywalled and nothing
 * is gated, so it asks once, quietly, at the end — not from the top bar where
 * it would compete with the routes people actually came for.
 */
export const SPONSOR_URL = 'https://github.com/sponsors/THuynh-91';

export function SiteFoot({ children }: { children?: preact.ComponentChildren }) {
  return (
    <footer class="landing-foot">
      {children}
      <a class="support-link" href={SPONSOR_URL} target="_blank" rel="noopener noreferrer">
        <span aria-hidden="true">♥</span> Support this project
      </a>
    </footer>
  );
}
