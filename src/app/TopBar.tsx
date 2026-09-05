import { Wordmark } from './Wordmark';
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
    // Clamped to what a date can honestly be.
    //
    // Commit timestamps are whatever the committer's clock said, and on a very
    // large history some of those clocks are wrong by decades. Linux has
    // commits dated 2030, 2037 and 2085, so this read "2005–2085" — which is
    // not a fact about Linux, it is a fact about somebody's laptop in 2006,
    // repeated by us as though we had checked it.
    //
    // The plan's own presentation times are already corrected so a child never
    // precedes its parent; what is not corrected is the far end, because
    // nothing downstream needs it to be. Here it does: a badge is a claim.
    const now = new Date().getUTCFullYear();
    // Walked rather than spread. `Math.min(...years)` passes every element as
    // an argument, and a plan's time map has one entry per aggregated span —
    // Rust's is long enough to overflow the call stack, which threw during
    // render and dropped the whole page back to the demo. A repository that
    // fails to open because its date range is being computed is a poor trade
    // for one line of brevity.
    let from = Infinity;
    let to = -Infinity;
    for (const [ms] of map) {
      const y = new Date(ms).getUTCFullYear();
      if (!Number.isFinite(y) || y < 1970 || y > now) continue;
      if (y < from) from = y;
      if (y > to) to = y;
    }
    if (!Number.isFinite(from)) return null;
    return from === to ? String(from) : `${from}–${to}`;
  })();
  // A span is watching part of a whole history, which is exactly what this
  // badge already exists to say. It overrides `exact`, because the plan being
  // complete is no longer the interesting fact once the clock has been told to
  // start in 2019 and stop at the end of 2019 — what is on screen is a slice,
  // and nothing else on the page says so.
  const chosen = store.span.value;
  const chosenLabel = chosen ? (chosen.from === chosen.to ? String(chosen.from) : `${chosen.from}–${chosen.to}`) : null;
  const badge =
    completeness === 'synthetic'
      ? 'generated'
      : chosenLabel
        ? `${chosenLabel} · partial`
        : span
          ? completeness === 'exact'
            ? `${span} · entire repo`
            : `${span} · partial`
          : completeness;
  const summary = chosenLabel ? `Playing ${chosenLabel} out of ${span ?? 'the whole history'}. ${perf.coverage.summary}` : perf.coverage.summary;
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
          class="landing-mark as-link"
          aria-label="Back to start"
          onClick={() => {
            pause();
            store.mode.value = 'landing';
            store.panel.value = 'none';
          }}
        >
          <Wordmark />
        </button>
        <div class="repo-id">
          <strong>
            {perf.source.owner}/{perf.source.name}
          </strong>
          <button type="button" class={`quality ${completeness}`} title={summary} onClick={() => toggle('help')} aria-label={`Coverage: ${badge}. ${summary}`} data-testid="quality-badge">
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
