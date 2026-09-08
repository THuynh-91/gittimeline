import { store, updateSettings } from './store';
import { applySettingsToRuntime } from './controller';
import { Icons } from './icons';

/**
 * Music volume, next to the view toggles.
 *
 * It lives with them rather than in the transport because it has to survive
 * the transport being hidden — someone watching with the controls cleared
 * still needs to turn the music down.
 *
 * ## One mute, not two
 *
 * This used to carry its own mute button, so the app had **two separate mute
 * controls**: this one and the speaker in the top bar, which is also what `M`
 * presses. A first-time viewer found both and reported them as a defect,
 * reasonably — two controls for one state is two things to check when the
 * music is still playing.
 *
 * The top bar's is the one that stays, because it is the one with a keyboard
 * shortcut and the one whose icon is drawn in the same hand as everything else
 * around it. This one was a `🔊` emoji, the single emoji in an interface of
 * hand-drawn strokes: whatever font the machine happened to have, at whatever
 * weight, beside 1.7px stroked paths.
 *
 * Nothing is lost with it gone. Dragging to zero still mutes and dragging back
 * up still unmutes, and because the level is kept rather than overwritten,
 * unmuting from the top bar or from `M` returns to the level you were last at.
 * The speaker glyph that is left is a label: it says what the slider is for,
 * and it is not a button, so there is nothing to press twice.
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
      {/* Decorative: the slider beside it is labelled "Music volume", so a
          screen reader has already been told, and the mute *control* is in the
          top bar. Drawn from the same icon set as that one, so the two read as
          the same speaker at two sizes rather than as two different marks. */}
      <span class="volume-mark" aria-hidden="true">
        {s.muted ? <Icons.muted /> : <Icons.sound />}
      </span>
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
