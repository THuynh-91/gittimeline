import { store, updateSettings } from './store';

/**
 * Taking things off the stage.
 *
 * The commit ledger and the player furniture are useful while you are working
 * out what you are looking at, and they are the only things in the way once
 * you have. So both come off, and what is left is the performance.
 *
 * These two buttons deliberately stay put when everything else goes: a
 * control that hides itself along with what it hides is a trap. They fade
 * back almost to nothing until you go looking for them.
 */
export function ViewToggles() {
  const s = store.settings.value;
  return (
    <div class={`view-toggles${s.showControls ? '' : ' bare'}`} data-testid="view-toggles">
      <button
        type="button"
        class={`vbtn${s.showRail ? ' on' : ''}`}
        aria-pressed={s.showRail}
        title="Show or hide the commit ledger"
        onClick={() => updateSettings({ showRail: !s.showRail })}
        data-testid="toggle-rail"
      >
        Names
      </button>
      <button
        type="button"
        class={`vbtn${s.showControls ? ' on' : ''}`}
        aria-pressed={s.showControls}
        title="Show or hide the date, timeline and transport"
        onClick={() => updateSettings({ showControls: !s.showControls })}
        data-testid="toggle-controls"
      >
        Controls
      </button>
    </div>
  );
}
