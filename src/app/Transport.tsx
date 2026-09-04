import { store, updateSettings } from './store';
import { togglePlay, seek, jumpLandmark, stepUnit, setSpeed, player } from './controller';
import { fmtClock, fmtDate } from '@/choreography/events';
import { Icons } from './icons';

export function Transport() {
  const perf = store.perf.value;
  const playing = store.playing.value;
  const t = store.time.value;
  const speed = store.speed.value;
  const scale = store.settings.value.timelineScale;
  if (!perf) return null;
  const hist = player.historicalAt(t);
  return (
    <div class="transport">
      <button type="button" class="tbtn" aria-label="Previous landmark (Shift+Left)" title="Previous landmark" onClick={() => jumpLandmark(-1)}>
        <Icons.prev />
      </button>
      <button type="button" class="tbtn" aria-label="Step back" title="Step back (Left)" onClick={() => stepUnit(-1)}>
        <Icons.stepBack />
      </button>
      <button type="button" class="tbtn play" aria-label={playing ? 'Pause' : 'Play'} aria-pressed={playing} title="Play / pause (Space)" onClick={togglePlay} data-testid="transport-play">
        {playing ? <Icons.pause /> : <Icons.play />}
      </button>
      <button type="button" class="tbtn" aria-label="Step forward" title="Step forward (Right)" onClick={() => stepUnit(1)}>
        <Icons.stepFwd />
      </button>
      <button type="button" class="tbtn" aria-label="Next landmark (Shift+Right)" title="Next landmark" onClick={() => jumpLandmark(1)}>
        <Icons.next />
      </button>
      <select class="speed" aria-label="Playback speed" value={String(speed)} onChange={(e) => setSpeed(Number((e.target as HTMLSelectElement).value))}>
        {[0.5, 0.75, 1, 1.5, 2].map((r) => (
          <option key={r} value={String(r)}>
            {r}×
          </option>
        ))}
      </select>
      <div class="scale-toggle" role="group" aria-label="Timeline scale">
        <button type="button" aria-pressed={scale === 'performance'} onClick={() => updateSettings({ timelineScale: 'performance' })}>
          Show
        </button>
        <button type="button" aria-pressed={scale === 'historical'} onClick={() => updateSettings({ timelineScale: 'historical' })}>
          Calendar
        </button>
      </div>
      <span class="spacer" />
      <span class="clock" aria-live="off" data-testid="clock">
        <b>{fmtClock(t)}</b> / {fmtClock(perf.duration)}
        {hist != null && <span class="date">{` · ${fmtDate(hist)}`}</span>}
      </span>
      <button type="button" class="tbtn" aria-label="Restart" title="Restart (Home)" onClick={() => seek(0)} style="display:none" />
    </div>
  );
}
