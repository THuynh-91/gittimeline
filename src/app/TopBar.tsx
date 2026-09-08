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
  /**
   * The badge in two parts, because at 390px only one of them fits.
   *
   * Measured before this split, at 390x844: the pill read `2015–2026 · ENTIRE
   * REPO`, wrapped to **four lines**, stood 72px tall inside a 50px bar and
   * was drawn at y = -11 — the first line clipped off the top of the screen.
   * A `<button>` has `flex-shrink: 1` and this one had no `white-space`, so
   * the truth claim was the element that gave way while the repository name
   * beside it kept its width.
   *
   * The fix is not to shrink the type. It is that the years are the part with
   * a substitute: the date hero underneath is a year at 30px, and the scrubber
   * is labelled with year ticks across its whole width. The state word has no
   * substitute anywhere on the screen. So the years are the half that drops
   * when the bar is narrow, and only when they are redundant — a *chosen*
   * span keeps them, because there the year is the claim ("2016 · partial")
   * and the hero underneath is showing the same year for a different reason.
   *
   * Nothing is dropped from the accessible name or the tooltip, which carry
   * the whole sentence at every width.
   */
  const state = completeness === 'synthetic' ? 'generated' : chosenLabel ? 'partial' : completeness === 'exact' ? 'entire repo' : 'partial';
  const years = completeness === 'synthetic' ? null : (chosenLabel ?? span);
  const badge = years ? `${years} · ${state}` : state;
  const summary = chosenLabel ? `Playing ${chosenLabel} out of ${span ?? 'the whole history'}. ${perf.coverage.summary}` : perf.coverage.summary;
  const toggle = (id: PanelId) => (store.panel.value = panel === id ? 'none' : id);
  const btn = (id: PanelId, label: string, icon: () => preact.JSX.Element, testId?: string, optional = false) => (
    <button type="button" class={`icon-btn${optional ? ' optional' : ''}`} aria-label={label} title={label} aria-expanded={panel === id} onClick={() => toggle(id)} data-testid={testId}>
      {icon()}
    </button>
  );
  /**
   * The way out, and where it goes.
   *
   * "Back to start" on the wordmark was the only exit a running show had, and
   * it lands on the landing page — so a visitor who picked Linux off the shelf
   * and wanted something else had to go home and find the shelf again. Twelve
   * histories, and no way back to them from inside one.
   *
   * `outcome === 'artifact'` is set by `loadCatalogEntry` and by nothing else,
   * so it is exactly "this came off the shelf". Where it did, the exit goes to
   * the shelf; where it did not, there is no shelf to return to and it goes
   * where the wordmark went. One control, correct destination, rather than two
   * controls a viewer has to choose between.
   *
   * It is also why the wordmark comes off the bar under 720px: at that width
   * the left of a player is where the exit lives, not where a logo does, and
   * its hundred pixels are what pay for the repository name and the badge to
   * both fit on the same screen.
   */
  const fromShelf = store.outcome.value === 'artifact';
  const leave = () => {
    pause();
    store.panel.value = 'none';
    store.mode.value = fromShelf ? 'catalog' : 'landing';
  };
  return (
    <header class={`topbar${fromShelf ? ' from-shelf' : ''}`}>
      <div class="topbar-left">
        <button type="button" class="topbar-back" aria-label={fromShelf ? 'Back to the selection' : 'Back to start'} title={fromShelf ? 'Back to the selection' : 'Back to start'} onClick={leave} data-testid="player-back">
          <Icons.back />
          <span>{fromShelf ? 'Selection' : 'Start'}</span>
        </button>
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
            {/* The owner is the half that drops at phone width. `mdBook` is
                45px and `rust-lang/mdBook` is 105, and on a 390px bar that
                difference is the whole of whether the name gets to be read at
                all or arrives as `rust-lang/…`. The aria-label on the badge
                beside it still says both, and so does Help. */}
            <span class="repo-owner">{perf.source.owner}/</span>
            {perf.source.name}
          </strong>
          <button
            type="button"
            class={`quality ${completeness}${chosenLabel ? ' has-span' : ''}`}
            title={summary}
            onClick={() => toggle('help')}
            aria-label={`Coverage: ${badge}. ${summary}`}
            data-testid="quality-badge"
          >
            {years && (
              <>
                <span class="q-years">{years}</span>
                <span class="q-sep"> · </span>
              </>
            )}
            <span class="q-state">{state}</span>
          </button>
        </div>
      </div>
      <div class="icon-buttons">
        <button type="button" class={`icon-btn${s.muted ? '' : ' active'}`} aria-label={s.muted ? 'Unmute (M)' : 'Mute (M)'} aria-pressed={!s.muted} title="Sound (M)" onClick={toggleMute} data-testid="mute-button">
          {s.muted ? <Icons.muted /> : <Icons.sound />}
        </button>
        <button type="button" class={`icon-btn optional${s.autoCamera ? ' active' : ''}`} aria-label={store.manualCamera.value ? 'Free look, follow at this zoom (C)' : store.cameraLocked.value ? 'Following at your zoom (C)' : 'Auto camera (C)'} aria-pressed={s.autoCamera} title="Camera (C)" onClick={toggleAutoCamera} data-testid="camera-button">
          <Icons.camera />
        </button>
        {/* Not `optional`: this is the stage's stated alternative for anyone
            who cannot see it, so it is not the first thing to drop when the
            window narrows. */}
        {btn('events', 'Events (E)', Icons.list, 'events-button')}
        {btn('settings', 'Settings', Icons.settings, 'settings-button')}
        {/* Also not `optional` any more, and that flag was the whole of the
            defect: `.icon-btn.optional` is `display: none` under 720px, so on
            a phone the Help panel — which holds the legend, the sound note,
            the keyboard map and this repository's coverage — had no route to
            it whatever. The camera is the one control on this bar a viewer can
            genuinely do without, because double-tapping the stage does the
            same thing; an explanation is not. */}
        {btn('help', 'Help (?)', Icons.help, 'help-button')}
      </div>
    </header>
  );
}
