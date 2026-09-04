import { store, type PanelId } from './store';
import { toggleMute, toggleAutoCamera, toggleReducedMotion, toggleRecording, canRecord, pause } from './controller';
import { Icons } from './icons';

export function TopBar() {
  const perf = store.perf.value;
  const s = store.settings.value;
  const panel = store.panel.value;
  if (!perf) return null;
  const completeness = perf.source.provider === 'synthetic' ? 'synthetic' : perf.coverage.completeness === 'exact' ? 'exact' : 'partial';
  const toggle = (id: PanelId) => (store.panel.value = panel === id ? 'none' : id);
  const btn = (id: PanelId, label: string, icon: () => preact.JSX.Element, testId?: string, optional = false) => (
    <button type="button" class={`icon-btn${optional ? ' optional' : ''}`} aria-label={label} title={label} aria-expanded={panel === id} onClick={() => toggle(id)} data-testid={testId}>
      {icon()}
    </button>
  );
  return (
    <header class="topbar">
      <div style="display:flex;align-items:center;gap:18px">
        <button
          type="button"
          class="wordmark"
          aria-label="Back to start"
          onClick={() => {
            pause();
            store.mode.value = 'landing';
            store.panel.value = 'none';
          }}
        >
          <span class="dot" aria-hidden="true" /> GitDance
        </button>
        <div class="repo-id">
          <strong>
            {perf.source.owner}/{perf.source.name}
          </strong>
          <button type="button" class={`quality ${completeness}`} title={perf.coverage.summary} onClick={() => toggle('data')} aria-label={`Data quality: ${completeness}. ${perf.coverage.summary}`} data-testid="quality-badge">
            {completeness}
          </button>
        </div>
      </div>
      <div class="icon-buttons">
        <button type="button" class={`icon-btn${s.muted ? '' : ' active'}`} aria-label={s.muted ? 'Unmute (M)' : 'Mute (M)'} aria-pressed={!s.muted} title="Sound (M)" onClick={toggleMute} data-testid="mute-button">
          {s.muted ? <Icons.muted /> : <Icons.sound />}
        </button>
        <button type="button" class={`icon-btn optional${s.autoCamera ? ' active' : ''}`} aria-label={store.manualCamera.value ? 'Free look — follow at this zoom (C)' : store.cameraLocked.value ? 'Following at your zoom (C)' : 'Auto camera (C)'} aria-pressed={s.autoCamera} title="Camera (C)" onClick={toggleAutoCamera} data-testid="camera-button">
          <Icons.camera />
        </button>
        <button type="button" class={`icon-btn optional${s.reducedMotion ? ' active' : ''}`} aria-label="Reduced motion (R)" aria-pressed={s.reducedMotion} title="Reduced motion (R)" onClick={toggleReducedMotion} data-testid="motion-button">
          <Icons.motion />
        </button>
        {canRecord() && (
          <button type="button" class={`icon-btn optional${store.recording.value ? ' rec' : ''}`} aria-label={store.recording.value ? 'Stop recording' : 'Record WebM'} aria-pressed={store.recording.value} title="Record WebM" onClick={toggleRecording}>
            <Icons.record />
          </button>
        )}
        {btn('events', 'Events (E)', Icons.list, 'events-button')}
        {btn('data', 'What am I seeing? (I)', Icons.info, 'data-button')}
        {btn('settings', 'Settings', Icons.settings, 'settings-button')}
        {btn('share', 'Share & export', Icons.share, 'share-button')}
        {btn('help', 'Help (?)', Icons.help, 'help-button', true)}
      </div>
    </header>
  );
}
