import { useEffect, useRef, useState } from 'preact/hooks';
import { store } from './store';
import { exploreState, exploreTo, dateAtFraction } from './controller';

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
  const t = store.time.value;
  const playing = store.playing.value;
  const [pos, setPos] = useState(0.5);
  const [visible, setVisible] = useState(1);
  const dragging = useRef(false);

  const ended = !!perf && !playing && !store.loopRange.value && t >= perf.duration - 0.05;

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
      setVisible((v) => (Math.abs(v - st.visible) > 0.005 ? st.visible : v));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ended]);

  if (!ended) return null;

  // Nothing to travel through when the whole picture already fits on screen.
  const whole = visible >= 0.995;
  const ms = dateAtFraction(pos);
  const d = ms != null && Number.isFinite(ms) ? new Date(ms) : null;

  const onInput = (e: Event) => {
    const f = Number((e.currentTarget as HTMLInputElement).value) / 1000;
    dragging.current = true;
    setPos(f);
    exploreTo(f);
  };

  return (
    <div class="explore" data-testid="explore-bar">
      <label class="explore-label" for="explore-range">
        {whole ? 'Zoom in to travel the history' : 'Travel the finished history'}
      </label>
      <div class="explore-track" style={{ '--window': `${Math.round(visible * 100)}%`, '--at': `${Math.round(pos * 100)}%` }}>
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
