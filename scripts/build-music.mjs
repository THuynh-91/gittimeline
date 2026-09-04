/**
 * Fetch the soundtrack.
 *
 *   node scripts/build-music.mjs [outDir]
 *
 * The score used to be synthesised — a piano and a small orchestra driven by
 * the repository's own events. Every voice was tied to something true about
 * the history, all of it was measured and spaced, and it was still hard to
 * listen to, which is the only test a soundtrack has to pass.
 *
 * So the soundtrack is real recorded music now. There is no public-domain rock
 * — the genre is entirely inside copyright, composition and recording both —
 * but there is a great deal of freely licensed instrumental music, and Kevin
 * MacLeod's library is released under Creative Commons Attribution 4.0. That
 * licence permits commercial use and redistribution; it requires credit, which
 * the site gives in the help panel, in the data file below, and in the README.
 *
 * These are fetched at build time rather than committed, exactly like the
 * catalog: twenty megabytes of audio does not belong in a git history, and a
 * deploy that fetches its own assets stays reproducible.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'public/music';
const BASE = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree';

/**
 * Three registers, because a repository that merges a pull request every other
 * commit and one that takes a considered commit a week should not open on the
 * same music. `register` is what `characterOf` selects on.
 */
const TRACKS = [
  {
    id: 'volatile-reaction',
    file: 'Volatile Reaction.mp3',
    title: 'Volatile Reaction',
    artist: 'Kevin MacLeod',
    register: 'frantic',
    note: 'Driving and relentless — for a history that never stops moving.',
  },
  {
    id: 'exit-the-premises',
    file: 'Exit the Premises.mp3',
    title: 'Exit the Premises',
    artist: 'Kevin MacLeod',
    register: 'driving',
    note: 'Upbeat and purposeful — for steady, sustained work.',
  },
  {
    id: 'chill-wave',
    file: 'Chill Wave.mp3',
    title: 'Chill Wave',
    artist: 'Kevin MacLeod',
    register: 'calm',
    note: 'Unhurried — for a long, quiet history.',
  },
];

const LICENCE = {
  name: 'Creative Commons Attribution 4.0',
  url: 'https://creativecommons.org/licenses/by/4.0/',
  source: 'https://incompetech.com/',
  credit: 'Music by Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0',
};

mkdirSync(outDir, { recursive: true });
const index = [];

for (const track of TRACKS) {
  const url = `${BASE}/${encodeURIComponent(track.file)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 100_000) throw new Error(`suspiciously small (${bytes.length}B)`);
    const name = `${track.id}.mp3`;
    writeFileSync(join(outDir, name), bytes);
    index.push({ ...track, file: name, bytes: bytes.length, sourceUrl: url, licence: LICENCE });
    console.log(`${track.title.padEnd(22)} ${(bytes.length / 1e6).toFixed(1)} MB  ${track.register}`);
  } catch (err) {
    // Best effort, like the catalog: a build without music is quiet, not broken.
    console.error(`${track.title}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }
}

writeFileSync(join(outDir, 'index.json'), `${JSON.stringify({ licence: LICENCE, tracks: index }, null, 2)}\n`);
console.log(`\nmusic: ${index.length}/${TRACKS.length} tracks, ${(index.reduce((n, t) => n + t.bytes, 0) / 1e6).toFixed(1)} MB total`);
if (!index.length) process.exit(1);
