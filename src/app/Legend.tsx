import { useEffect } from 'preact/hooks';
import { store, updateSettings } from './store';
import { Icons } from './icons';

/**
 * The key to the picture, drawn, in the band, opened by itself the first time.
 *
 * ## What was wrong
 *
 * Every mark on the stage was explained in exactly one place: a `<dl>` inside
 * the Help panel, behind a `?` in the top-right corner. Measured on a
 * first-time viewer who was sent the app knowing only that it plays Git
 * history: **ninety seconds of watching before she found it**, and only because
 * she clicked every icon in the bar. At 390px the `?` is `display: none`
 * (`.icon-btn.optional`), so the only explanation of what she was looking at
 * was not merely hidden, it was unreachable.
 *
 * ## Why this shape and not another
 *
 * Rejected, and why:
 *
 *  - **Opening the Help panel automatically.** Help is a 360px-wide column that
 *    covers a third of the stage and carries sound, keyboard, limits and the
 *    repository's statistics. Putting all of that in front of the first frame
 *    is a modal in front of the thing it explains, and it teaches the viewer
 *    that this app opens dialogs at them.
 *  - **Making the `?` pulse or wear a dot.** A hint about where the hint is.
 *    It still costs a click before anything is explained, and a badge that
 *    demands to be clicked is the same nag with worse manners.
 *  - **A sentence on the stage.** The legend is five facts about five marks.
 *    As prose it is the paragraph nobody reads — which is the whole premise
 *    here — and as prose it also cannot be *matched* against the picture,
 *    which is the only thing a key is for.
 *
 * So it is the marks themselves, at 26px, each with two or three words beside
 * it, in one wrapping row of the band. It is a key, so it looks like a key: the
 * ivory line is the same ivory, the branch curve is the same slate, the merge
 * is a ring with a spoke. Nothing here is a picture *of* a legend; these are
 * the shapes the renderer draws, at legend size.
 *
 * ## When it appears
 *
 * On the first performance anybody watches, and then never again unless asked
 * for. `seenStageKey` is written when the strip is dismissed rather than when
 * it is shown, and never by a timer: a key that disappears while you are still
 * matching it against the stage is worse than one that was never offered. The
 * KEY button beside the other band toggles brings it back at any width, which
 * is also the phone's route to it now that the `?` is not.
 *
 * The full sentences stay in Help. This strip names the marks; Help says what
 * they mean in a whole sentence, and adds the ribbon, the sound, the keyboard
 * and the limits. Two lengths of the same answer, and the short one is the one
 * that arrives unasked.
 */

/**
 * One row of the key: a drawn mark and the fewest words that name it.
 *
 * The swatches are 34x18 rather than square, because four of the five marks
 * are things that *run* — a line, a curve, a dashed absence — and a square
 * crops a line into a dash. The two round marks (the spark, the merge ring)
 * are centred in the same box so the labels stay on one grid.
 */
const KEY: Array<{ id: string; label: string; art: () => preact.JSX.Element }> = [
  {
    id: 'main',
    label: 'the main line',
    art: () => (
      <svg viewBox="0 0 34 18" aria-hidden="true" focusable="false">
        <path d="M1 9h32" stroke="var(--ivory)" stroke-width="2.4" fill="none" stroke-linecap="round" />
      </svg>
    ),
  },
  {
    id: 'branch',
    label: 'a real branch',
    art: () => (
      <svg viewBox="0 0 34 18" aria-hidden="true" focusable="false">
        {/* The spine it left and came back to, faint, so the curve reads as a
            departure rather than as a squiggle on its own. */}
        <path d="M1 9h32" stroke="var(--ivory)" stroke-width="1" fill="none" opacity="0.28" stroke-linecap="round" />
        <path d="M3 9C9 9 9 3 17 3s8 6 14 6" stroke="#6f7d99" stroke-width="1.7" fill="none" stroke-linecap="round" />
      </svg>
    ),
  },
  {
    id: 'person',
    label: 'a person',
    art: () => (
      <svg viewBox="0 0 34 18" aria-hidden="true" focusable="false">
        {/* Two sparks, in two colours, and that is deliberate.
            One would say "the blue dot is a person", which is the wrong
            reading: a contributor's colour belongs to *them* and there are as
            many as there are people. Two hues say "these travelling dots"
            without claiming either colour means anything on its own. The glow
            is what the renderer puts on a moving body; without it this is a
            bullet point. */}
        <circle cx="12" cy="7" r="5.5" fill="#7fd6ff" opacity="0.16" />
        <circle cx="12" cy="7" r="2.7" fill="#7fd6ff" />
        <circle cx="22" cy="12" r="5" fill="#ffb070" opacity="0.16" />
        <circle cx="22" cy="12" r="2.3" fill="#ffb070" />
      </svg>
    ),
  },
  {
    id: 'merge',
    label: 'a merge',
    art: () => (
      <svg viewBox="0 0 34 18" aria-hidden="true" focusable="false">
        <path d="M1 9h9M24 9h9" stroke="var(--ivory)" stroke-width="1" fill="none" opacity="0.28" stroke-linecap="round" />
        {/* One spoke per incoming parent, which is what the stage draws. Two
            here, because two is what a merge normally has. */}
        <path d="M17 9 10 4.5M17 9l-7 9" stroke="#6f7d99" stroke-width="1.2" fill="none" opacity="0.75" />
        <circle cx="17" cy="9" r="5.2" stroke="#fff3dc" stroke-width="1.7" fill="none" />
      </svg>
    ),
  },
  {
    id: 'unloaded',
    label: 'not loaded',
    art: () => (
      <svg viewBox="0 0 34 18" aria-hidden="true" focusable="false">
        <path d="M1 9h32" stroke="#a0aabe" stroke-width="1.7" fill="none" opacity="0.55" stroke-dasharray="4 3.5" stroke-linecap="round" />
      </svg>
    ),
  },
];

export function Legend() {
  const seen = store.settings.value.seenStageKey;
  const open = store.stageKeyOpen.value;

  // Opened for the viewer who has never seen it, once, on the first
  // performance. The effect runs on mount and reads the flag through `peek`
  // equivalents already in the render above, so nothing here re-fires when the
  // strip is closed again.
  useEffect(() => {
    if (!store.settings.peek().seenStageKey) store.stageKeyOpen.value = true;
  }, []);

  if (!open) return null;

  // Closing is what records that it has been read. Nothing else does: not a
  // timer, and not merely having been rendered.
  const dismiss = () => {
    store.stageKeyOpen.value = false;
    if (!seen) updateSettings({ seenStageKey: true });
  };

  return (
    <div class="stage-key" data-testid="stage-key" role="group" aria-label="Key to the stage">
      {KEY.map((k) => (
        <span class="stage-key-item" key={k.id} data-key={k.id}>
          <span class="stage-key-art">{k.art()}</span>
          {k.label}
        </span>
      ))}
      {/* A key is furniture and closes like furniture. It is the last thing in
          the row rather than the first, so it is not what the eye lands on. */}
      <button type="button" class="stage-key-close" aria-label="Hide the key" title="Hide the key" onClick={dismiss} data-testid="stage-key-close">
        <Icons.close />
      </button>
    </div>
  );
}
