import { store } from './store';
import { dateAtFraction, player } from './controller';
import { fmtClock } from '@/choreography/events';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The timelapse readout: the repository's own calendar, large, advancing as
 * the performance plays. The performance clock sits quietly beside it so the
 * two clocks are never confused.
 */
export function DateBar() {
  const perf = store.perf.value;
  const t = store.time.value;
  if (!perf) return null;
  // Once the performance is over the viewer travels the finished picture with
  // the slider, which moves the camera and not the clock. The hero has to
  // describe what is actually on screen: leaving it at the playhead meant it
  // read "September 2026" while you were looking at 2017.
  const travel = store.travelAt.value;
  const hist = travel != null ? (dateAtFraction(travel) ?? player.historicalAt(t)) : player.historicalAt(t);
  // The era and the event caption describe the clock. While the viewer is
  // travelling the finished picture the clock is parked at the end, so those
  // two lines would sit under a 2017 heading insisting it is the present day.
  const travelling = travel != null;
  const win = store.spanSeconds.value;
  const era = travelling ? undefined : perf.eras.find((e) => t >= e.performanceStart && t < e.performanceEnd);
  const ev = travelling ? null : store.caption.value;
  const d = hist != null && Number.isFinite(hist) ? new Date(hist) : null;
  /**
   * Branches open at this moment: started, and not merged.
   *
   * Read off `ending` rather than off `end`, and the difference is not
   * cosmetic. The first version of this counted `start <= t && end > t` under
   * a comment claiming that `end` is the plan's end for a thread that never
   * lands. That is false on all thirteen plans: `duration - max(thread.end)`
   * is exactly `CLOCK_TAIL` — 3.20s — for every one of them, and no thread
   * ends at `duration`. So a live ref tip read as *closed* for the last 3.2
   * seconds of every history, which is the stretch where the caption says
   * "Present day".
   *
   * `ending` says what actually happened to it. A merged thread closes when it
   * merges. A tip or a dormant one never closes, because nobody merged it —
   * which is the honest reading and needs no arithmetic on the clock.
   *
   * Not counted while travelling, because the clock is parked at the end and
   * the number would describe the last frame rather than the picture on
   * screen — the same reason the era and the caption go quiet above.
   */
  const open = travelling ? 0 : perf.threads.reduce((n, th) => n + (th.start <= t && (th.ending !== 'merged' || th.end > t) ? 1 : 0), 0);
  const partial = perf.coverage.completeness !== 'exact' && perf.source.provider === 'github';
  const spansYears = perf.timeMap.length > 1 && perf.timeMap[perf.timeMap.length - 1]![0] - perf.timeMap[0]![0] > 400 * 86_400_000;

  return (
    <div class="datebar">
      <div class="date-hero" data-testid="date-hero">
        {d ? (
          <>
            <span class="month">{MONTHS[d.getUTCMonth()]}</span>
            <span class="year">{d.getUTCFullYear()}</span>
            {!spansYears && <span class="day">{d.getUTCDate()}</span>}
          </>
        ) : (
          <span class="month">No commits yet</span>
        )}
      </div>
      <div class="date-meta">
        <span class="caption-line" data-testid="caption">
          {travelling && <b>Travelling the finished history</b>}
          {era && <b>{era.label}</b>}
          {era && ev ? ' · ' : ''}
          {ev ? ev.caption : ''}
        </span>
        {/* How many branches are open at this moment.

            The one number this app can put on screen that a topological tool
            cannot. gitk, `git log --graph` and GitHub's network graph all draw
            main as a trunk by construction, so "how much was happening at
            once" is not a question they can be asked — there is no *now* in a
            topological view to ask it about. Here x is the clock, so it is a
            reading rather than a calculation.

            `maxConcurrentThreads` has been in `stats` since the compiler was
            written and only ever appeared in Help as a repository-wide
            maximum. This is the live value, which is the interesting one: the
            peak tells you what the project was once capable of, and this tells
            you what it is doing while you watch.

            Beside the date rather than in the transport, which the proposal
            suggested, because the transport is controls and this line is
            already the app's answer to "what is true at this moment".

            The tooltip says what the number counts and nothing else. It used
            to add "the busiest moment of this history has N", from
            `maxConcurrentThreads` — which counts threads with an edge *in
            flight*, a different and much smaller quantity. Put in one sentence
            the two read as a contradiction, and on seven of the nine shelf
            entries it was a flat absurdity: "99 of 1033 branches are open at
            this point; the busiest moment of this history has 16." Both
            numbers were right, about different questions. */}
        {open > 0 && (
          <span class="open-threads" data-testid="open-threads" title={`${open} of this history's ${perf.stats.threads} branches have started by this point and have not been merged.`}>
            <b>{open}</b> {open === 1 ? 'branch' : 'branches'} open
          </span>
        )}
        <span class="clock" data-testid="clock">
          {partial && <span class="partial-flag">partial history</span>}
          {/* Against the length of what is actually playing. A span is a
              window on the plan, so the plan's own clock says a viewer who
              chose three years of a nine-minute history is four minutes into
              it before the first frame, and finished with three and a half
              minutes left on the counter. */}
          <b>{fmtClock(win ? t - win.start : t)}</b> / {fmtClock(win ? win.end - win.start : perf.duration)}
        </span>
      </div>
    </div>
  );
}
