import { store, updateSettings } from './store';
import { applySettingsToRuntime } from './controller';

/**
 * Music volume, next to the view toggles.
 *
 * It lives with them rather than in the transport because it has to survive
 * the transport being hidden — someone watching with the controls cleared
 * still needs to turn the music down. Dragging to zero mutes; the speaker
 * toggles back to the level you were last at, so muting never costs you your
 * setting.
 */
export function Volume() {
  const s = store.settings.value;
  const level = s.muted ? 0 : s.effectsLevel;

  const set = (v: number) => {
    updateSettings({ effectsLevel: v > 0 ? v : s.effectsLevel, muted: v <= 0 });
    applySettingsToRuntime();
  };

  return (
    <div class="volume" data-testid="volume">
      <button
        type="button"
        class="vbtn icon"
        aria-pressed={!s.muted}
        aria-label={s.muted ? 'Unmute the music' : 'Mute the music'}
        title={s.muted ? 'Unmute' : 'Mute'}
        onClick={() => {
          updateSettings({ muted: !s.muted });
          applySettingsToRuntime();
        }}
        data-testid="volume-mute"
      >
        {s.muted ? '🔇' : '🔊'}
      </button>
      <input
        class="volume-range"
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(level * 100)}
        aria-label="Music volume"
        onInput={(e) => set(Number((e.currentTarget as HTMLInputElement).value) / 100)}
        data-testid="volume-range"
      />
    </div>
  );
}
