/**
 * The name, in one place.
 *
 * There were two of these: the site bar drew a split-colour `Git`/`Timeline`
 * with a `.landing-dot`, and the player's top bar drew `<span class="dot"/>
 * GitTimeline` — a different element, a different class, a different size and
 * a single undivided word. Nobody moving between the landing page and a
 * performance could miss it, because the mark sits in the same corner on both
 * and simply changed shape underneath the cursor.
 *
 * Two copies of a logo is one copy too many, so this is the only one. Where it
 * needs to be clickable it is wrapped by the caller, which is the only thing
 * that legitimately differs between the places it appears.
 */
export function Wordmark() {
  return (
    <>
      <span class="landing-dot" aria-hidden="true" />
      {/* Two words, and the name only makes sense as two: a *timeline* of
          *Git*. Splitting the colour rather than adding a space keeps the
          wordmark one object while letting each half be read. Ivory is the
          default branch on the stage and the accent is what this app adds on
          top of it, so the two halves use the same vocabulary as the picture. */}
      <span class="mark-git">Git</span>
      <span class="mark-time">Timeline</span>
    </>
  );
}
