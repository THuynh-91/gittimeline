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
      {mode === 'landing' && <Landing />}
      {mode === 'catalog' && <CatalogPage />}
      <ScopeChooser />
      <Prelude />
      {showPlayer && perf && !chromeHidden && <TopBar />}
      {showPlayer && perf && !chromeHidden && view.showRail && <CommitRail />}
      {showPlayer && perf && <FollowButton />}
      {showPlayer && perf && !chromeHidden && <ViewToggles />}
      {showPlayer && perf && !chromeHidden && view.showControls && (
        <div class="band" role="region" aria-label="Date, timeline and transport">
          <DateBar />
          <ExploreBar />
          <Timeline />
          <Transport />
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
