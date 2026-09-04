import { audio } from './controller';

/**
 * The credit the licence requires.
 *
 * The soundtrack is Creative Commons Attribution 4.0, which permits use and
 * redistribution and requires attribution. That is not a formality to bury in
 * a licence file: it is the condition on which the music may be used at all,
 * so it appears wherever the music is explained.
 */
export function MusicCredit() {
  const now = audio.nowPlaying;
  if (!now) return null;
  return (
    <span class="music-credit" data-testid="music-credit">
      Now playing <em>{now.title}</em> by {now.artist} —{' '}
      <a href={now.licence.url} target="_blank" rel="noopener noreferrer">
        {now.licence.name}
      </a>
      .
    </span>
  );
}
