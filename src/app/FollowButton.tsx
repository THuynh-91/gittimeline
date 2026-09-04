import { store } from './store';
import { toggleAutoCamera } from './controller';

/**
 * A way back. Once you have panned or zoomed away, the performance keeps
 * playing wherever it is, so this stays on screen until you rejoin it — and it
 * rejoins at the zoom you chose rather than snapping to the director's framing.
 */
export function FollowButton() {
  if (!store.manualCamera.value) return null;
  return (
    <button type="button" class="follow-btn" onClick={toggleAutoCamera} data-testid="follow-button">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2" />
        <circle cx="12" cy="12" r="8.4" />
        <path d="M12 1.6v2.6M12 19.8v2.6M1.6 12h2.6M19.8 12h2.6" />
      </svg>
      Follow the performance
    </button>
  );
}
