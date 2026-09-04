import { store } from './store';
import { player } from './controller';
import { fmtClock, fmtDate } from '@/choreography/events';

/** The two clocks, side by side: the artistic performance clock and the real historical date. */
export function Caption() {
  const ev = store.caption.value;
  const t = store.time.value;
  const perf = store.perf.value;
  if (!perf) return null;
  const hist = player.historicalAt(t);
  const big = !!ev && ev.type !== 'COMMIT_STEP';
  const era = perf.eras.find((e) => t >= e.performanceStart && t < e.performanceEnd);
  if (!store.settings.value.captions) {
    return (
      <div class="caption" aria-hidden="true">
        <span />
        <span class="clock">
          <b>{fmtClock(t)}</b> / {fmtClock(perf.duration)} · {hist != null ? fmtDate(hist) : ''}
        </span>
      </div>
    );
  }
  return (
    <div class="caption" aria-hidden="true">
      <span class={`line${big ? ' big' : ''}`} data-testid="caption">
        {ev ? ev.caption : perf.stats.commits === 0 ? 'No commits yet' : ''}
      </span>
      <span class="clock">
        <b>{fmtClock(t)}</b> / {fmtClock(perf.duration)}
        {hist != null && (
          <>
            {' · '}
            <b>{fmtDate(hist)}</b>
          </>
        )}
        {era ? ` · ${era.label}` : ''}
      </span>
    </div>
  );
}
