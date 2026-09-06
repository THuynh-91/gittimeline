import { useEffect, useRef, useState } from 'preact/hooks';
import { performanceEnded, store } from './store';
import { exploreState, exploreTo, dateAtFraction, cameraIsManual } from './controller';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Travelling the finished picture.
 *
 * The last shot frames the whole history at once, which is the right final
 * image and the wrong way to look at any particular part of it — zoom in to
 * read one corner and you have lost every way of getting to the others except
 * dragging blindly. So once the performance is over, this appears: a slider
 * along the whole width of the history that moves the camera *without changing
 * the magnification*, so whatever you zoomed in to stays the size you chose
 * while you travel from the first commit to the last.
 *
 * It is deliberately not the timeline. The timeline moves the performance
 * clock and the director's camera follows; this moves only the camera, over a
 * picture that has already finished being drawn.
 */
export function ExploreBar() {
  const perf = store.perf.value;
  const [pos, setPos] = useState(0.5);
  const [visible, setVisible] = useState(1);
  /**
   * Whether the viewer has actually taken the view.
   *
   * The date hero answers "where are we?" and the answer is the playhead's
   * date — until somebody goes travelling, at which point it has to describe
   * what they are looking at instead. Deciding that from the camera alone was
   * wrong: the closing shot moves the camera on its own, and on a streamed
   * history it settles somewhere that is not the ending, so the readout
   * announced a date nobody had navigated to and captioned it "Travelling the
   * finished history" with no travelling done.
   *
   * Measured at the final frame, untouched: Node said September 2012 while the
   * timeline said 2026-09-04 — fourteen years apart. CPython 12.67, React
   * 11.25, mdBook 5.50. The demo is exempt because it is held whole and its
   * whole picture fits, which is the case the existing `visible >= 0.995`
   * guard was written for and the only case it catches.
   *
   * A ref rather than state: the loop below runs on every frame and has to see
   * this the instant the slider moves. Through state it saw the previous
   * value until the effect restarted, and overwrote the position the slider
   * had just set — which passed in Chromium and failed in Firefox and WebKit,
   * the two engines whose timing differs enough to lose that race.
   */
  const travelling = useRef(false);
  const dragging = useRef(false);

  const ended = performanceEnded();

  // The camera keeps moving for reasons of its own — the tableau settles, the
  // viewer scrolls to zoom, the follow button hands control back — so the
  // control tracks it rather than assuming it is the only thing driving.
  useEffect(() => {
    if (!ended) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (dragging.current) return;
      const st = exploreState();
      if (!st) return;
      setPos((p) => (Math.abs(p - st.at) > 0.001 ? st.at : p));
      // While the whole picture is on screen the camera is not *at* any
      // particular month, and saying it is reads as a mistake: a repository
      // that ran to 2026 announced "January 2019" at the final frame, because
      // that is where the middle of the history happens to fall. Hand the date
      // back to the playhead until the viewer zooms in on somewhere.
      // Only once somebody has taken it: the slider was moved, or the camera
      // was taken by hand. The whole-picture guard stays, because even a
      // deliberate traveller is not at any particular month when the entire
      // history is on screen.
      const taken = travelling.current || cameraIsManual();
      const at = !taken || st.visible >= 0.995 ? null : st.at;
      if (store.travelAt.peek() !== at) store.travelAt.value = at;
      setVisible((v) => (Math.abs(v - st.visible) > 0.005 ? st.visible : v));
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      store.travelAt.value = null;
      travelling.current = false;
    };
  }, [ended]);

  if (!ended || !perf) return null;

  // Nothing to travel through when the whole picture already fits on screen.
  const whole = visible >= 0.995;
  const ms = dateAtFraction(pos);

  const d = ms != null && Number.isFinite(ms) ? new Date(ms) : null;

  const onInput = (e: Event) => {
    const f = Number((e.currentTarget as HTMLInputElement).value) / 1000;
    dragging.current = true;
    travelling.current = true;
    setPos(f);
    store.travelAt.value = f;
    exploreTo(f);
  };

  return (
    <div class="explore" data-testid="explore-bar">
      <label class="explore-label" for="explore-range">
        {whole ? 'Zoom in to travel the history' : 'Travel the finished history'}
      </label>
      <div class={`explore-track${whole ? ' whole' : ''}`} style={{ '--window': `${(visible * 100).toFixed(2)}%`, '--at': pos.toFixed(4) }}>
        <input
          id="explore-range"
          class="explore-range"
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(pos * 1000)}
          disabled={whole}
          aria-label="Travel the finished history, keeping the current zoom"
          aria-valuetext={d ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : undefined}
          onInput={onInput}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onBlur={() => {
            dragging.current = false;
          }}
          data-testid="explore-range"
        />
      </div>
      <span class="explore-at" data-testid="explore-at">
        {d ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : ''}
      </span>
    </div>
  );
}
