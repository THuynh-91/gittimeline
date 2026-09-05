import { store, updateSettings } from './store';
import { Volume } from './Volume';

/**
 * Taking things off the stage.
 *
 * Two things, and only two, because these sit over the performance and every
 * one of them costs a piece of it. The running list of commit messages at the
 * top, and the player furniture at the bottom. Both are useful while you are
 * working out what you are looking at and both are in the way once you have.
 *
 * The notes drawn onto the history itself — branch names, "40 commits" over a
 * collapsed run, the marks on the scrubber — are a setting rather than a
 * button. They are part of the picture rather than furniture over it, and it
 * is not a switch anyone reaches for mid-performance.
 *
 * These deliberately stay put when everything else goes: a control that hides
 * itself along with what it hides is a trap. They fade back almost to nothing
 * until you go looking for them.
 */
export function ViewToggles() {
  const s = store.settings.value;
  return (
    <div class={`view-toggles${s.showControls ? '' : ' bare'}`} data-testid="view-toggles">
      <button
        type="button"
        class={`vbtn${s.showRail ? ' on' : ''}`}
        aria-pressed={s.showRail}
        title="Show or hide the running list of commit messages at the top"
        onClick={() => updateSettings({ showRail: !s.showRail })}
        data-testid="toggle-rail"
      >
        Messages
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
      <Volume />
    </div>
  );
}
