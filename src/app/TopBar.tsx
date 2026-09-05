import { store, type PanelId } from './store';
import { toggleMute, toggleAutoCamera, pause } from './controller';
import { Icons } from './icons';

export function TopBar() {
  const perf = store.perf.value;
  const s = store.settings.value;
  const panel = store.panel.value;
  if (!perf) return null;
  const completeness = perf.source.provider === 'synthetic' ? 'synthetic' : perf.coverage.completeness === 'exact' ? 'exact' : 'partial';
  // What the badge says.
  //
  // It said "exact" or "partial", which is precise about provenance and tells
  // a viewer nothing they can act on — "partial" of *what*, and missing
  // *which* part? The span is the answer to both, and it is a fact the plan
  // already holds: the first and last commit actually on screen. So the badge
  // names the years, and adds the one word that says whether anything is
  // missing from them.
  const span = (() => {
    const map = perf.timeMap;
    if (!map.length) return null;
    const from = new Date(map[0]![0]).getUTCFullYear();
    const to = new Date(map[map.length - 1]![0]).getUTCFullYear();
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return from === to ? String(from) : `${from}–${to}`;
  })();
  const badge =
    completeness === 'synthetic'
      ? 'generated'
      : span
        ? completeness === 'exact'
          ? `${span} · entire repo`
          : `${span} · partial`
        : completeness;
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
          <span class="dot" aria-hidden="true" /> GitTimeline
        </button>
        <div class="repo-id">
          <strong>
            {perf.source.owner}/{perf.source.name}
          </strong>
          <button type="button" class={`quality ${completeness}`} title={perf.coverage.summary} onClick={() => toggle('help')} aria-label={`Coverage: ${badge}. ${perf.coverage.summary}`} data-testid="quality-badge">
            {badge}
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
        {btn('settings', 'Settings', Icons.settings, 'settings-button')}
        {btn('help', 'Help (?)', Icons.help, 'help-button', true)}
      </div>
    </header>
  );
}
