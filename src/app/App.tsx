import { useEffect } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { store } from './store';
import { boot, handleKey, applySettingsToRuntime } from './controller';
import { Stage } from './Stage';
import { Landing } from './Landing';
import { Prelude } from './Prelude';
import { TopBar } from './TopBar';
import { DateBar } from './DateBar';
import { CommitRail } from './CommitRail';
import { Timeline } from './Timeline';
import { Transport } from './Transport';
import { Panels } from './Panels';
import { FollowButton } from './FollowButton';
import { ScopeChooser } from './ScopeChooser';
import { ExploreBar } from './ExploreBar';
import { ViewToggles } from './ViewToggles';
import { CatalogPage } from './CatalogPage';
import { SignIn } from './SignIn';

export function App() {
  useEffect(() => {
    void boot();
    const onKey = (e: KeyboardEvent) => {
      if (handleKey(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useSignalEffect(() => {
    const s = store.settings.value;
    document.documentElement.classList.toggle('reduced-motion', s.reducedMotion);
    document.documentElement.classList.toggle('high-contrast', s.highContrast);
    applySettingsToRuntime();
  });

  const mode = store.mode.value;
  const perf = store.perf.value;
  const showPlayer = mode === 'player';
  const chromeHidden = store.chromeHidden.value;
  const view = store.settings.value;
  const banner = store.banner.value;
  const toast = store.toast.value;

  return (
    <div class={`app${chromeHidden ? ' chrome-hidden' : ''}`}>
      <Stage />
      {/* A stable container that always exists, holding whichever page the
          mode selects.

          This was three adjacent conditionals — `{a && <A/>}{b && <B/>}` — and
          then a keyed ternary, and both left dead pages in the DOM: navigating
          to the catalog produced two catalog pages, and navigating back left
          one of them on top of the landing page. The Back button was working
          the whole time; it changed the mode underneath a corpse that was
          still covering the screen.

          The cause is that this element's siblings appear and disappear with
          the mode too, so the routed page's *position* among them moves, and a
          child that changes both type and position mid-list is the case where
          diffing goes wrong. A wrapper that is always present, in the same
          place, can only ever hold one child — the failure is unrepresentable
          rather than merely fixed. `display: contents` keeps it out of the
          layout entirely, so every page's own positioning is untouched. */}
      <div class="route">
        {mode === 'landing' ? <Landing /> : mode === 'catalog' ? <CatalogPage /> : mode === 'signin' ? <SignIn /> : null}
      </div>
      <ScopeChooser />
      <Prelude />
      {showPlayer && perf && !chromeHidden && <TopBar />}
      {showPlayer && perf && !chromeHidden && view.showRail && <CommitRail />}
      {showPlayer && perf && <FollowButton />}
      {showPlayer && perf && !chromeHidden && (
        // Hiding the controls takes away the player furniture, not your place
        // in the history. The date says where you are and the travel slider is
        // how you move once the performance is over — losing either of those
        // is not a cleaner view, it is a lost one.
        //
        // The toggles live inside the band rather than floating above it. As a
        // free-standing element they were positioned against the band's height
        // and collided with the date the moment the band's contents grew past
        // it, which is exactly what adding the travel slider did.
        <div class={`band${view.showControls ? '' : ' bare'}`} role="region" aria-label="Date, timeline and transport">
          <ViewToggles />
          <DateBar />
          <ExploreBar />
          {view.showControls && <Timeline />}
          {view.showControls && <Transport />}
        </div>
      )}
      {showPlayer && banner && !chromeHidden && (
        <div class={`banner ${banner.kind}`} role="status">
          <span>{banner.message}</span>
          {banner.action && (
            <button type="button" class="banner-action" onClick={banner.action.run}>
              {banner.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => (store.banner.value = null)}>
            ×
          </button>
        </div>
      )}
      {showPlayer && perf && <Panels />}
      {toast && (
        <div class="toast" role="status">
          {toast}
        </div>
      )}
      <div class="sr-only" aria-live="polite" aria-atomic="true">
        {store.announcement.value}
      </div>
    </div>
  );
}
