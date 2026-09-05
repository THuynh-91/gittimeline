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
 * So the soundtrack is recorded rock. There is no public-domain rock — the
 * genre is entirely inside copyright, composition and recording both — but
 * Kevin MacLeod's catalog is released under Creative Commons Attribution 4.0
 * and sixty-one of its pieces are filed under Rock. That licence permits
 * commercial use and redistribution; it requires credit, which the site gives
 * in the help panel, in the data file below, and in the README.
 *
 * The first attempt at this shipped by title alone and got it badly wrong:
 * *Volatile Reaction* is filed under **Soundtrack** and described by its own
 * composer as "blasting brass, pounding percussion... suitable for fights,
 * evil"; the other two were Electronica and Funk. It sounded like a war film
 * because it was one. So the picks are now checked against the catalog's own
 * metadata at build time and the build fails if a track is not actually rock —
 * a guitar-bass-drums lineup is not something to take on trust from a title.
 *
 * These are fetched at build time rather than committed, exactly like the
 * catalog: twenty megabytes of audio does not belong in a git history, and a
 * deploy that fetches its own assets stays reproducible.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'public/music';
const MP3 = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree';
const CATALOG = 'https://incompetech.com/music/royalty-free/pieces.json';
const GENRES = 'https://incompetech.com/music/royalty-free/genre.json';

/**
 * Three registers, because a repository that merges a pull request every other
 * commit and one that takes a considered commit a week should not open on the
 * same music. `registerFor` in src/audio/score.ts is what selects between them.
 *
 * All three are guitar, bass and kit, and all three are long — they loop for
 * as long as the performance runs, and a two-minute loop under a ten-minute
 * history is its own kind of unpleasant.
 */
const TRACKS = [
  {
    id: 'ready-aim-fire',
    title: 'Ready Aim Fire',
    register: 'frantic',
    note: 'Hard, fast rock — for a history that never stops moving.',
  },
  {
    id: 'riptide',
    title: 'Riptide',
    register: 'driving',
    note: 'Straight two-guitar rock — for steady, sustained work.',
  },
  {
    id: 'cold-funk',
    title: 'Cold Funk',
    register: 'calm',
    note: 'Unhurried rock, repeating guitar and bass — for a long, quiet history.',
  },
];

/** What a pick has to be to ship. A title is not evidence of a genre. */
const REQUIRED_GENRE = 'Rock';
const MIN_SECONDS = 180;

const LICENCE = {
  name: 'Creative Commons Attribution 4.0',
  url: 'https://creativecommons.org/licenses/by/4.0/',
  source: 'https://incompetech.com/',
  credit: 'Music by Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0',
};

const seconds = (len) => {
  const parts = String(len ?? '').split(':').map(Number);
  if (parts.some(Number.isNaN) || !parts.length) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

const catalog = await fetch(CATALOG).then((r) => r.json());
const genres = Object.fromEntries((await fetch(GENRES).then((r) => r.json())).map((g) => [String(g.id), g.genre]));

mkdirSync(outDir, { recursive: true });
const index = [];
const problems = [];

for (const track of TRACKS) {
  const piece = catalog.find((p) => p.title === track.title);
  if (!piece) {
    problems.push(`${track.title}: not in the catalog`);
    continue;
  }
  // The check that would have caught the war music.
  const genre = genres[String(piece.genre)];
  if (genre !== REQUIRED_GENRE) {
    problems.push(`${track.title}: filed under ${genre}, not ${REQUIRED_GENRE}`);
    continue;
  }
  const length = seconds(piece.length);
  if (length < MIN_SECONDS) {
    problems.push(`${track.title}: ${piece.length} is too short to loop under a long history`);
    continue;
  }

  const url = `${MP3}/${encodeURIComponent(piece.filename)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 100_000) throw new Error(`suspiciously small (${bytes.length}B)`);
    const name = `${track.id}.mp3`;
    writeFileSync(join(outDir, name), bytes);
    index.push({
      ...track,
      file: name,
      bytes: bytes.length,
      artist: 'Kevin MacLeod',
      genre,
      bpm: Number(piece.bpm) || null,
      length: piece.length,
      instruments: piece.instruments,
      feel: piece.feel,
      isrc: piece.isrc ?? null,
      sourceUrl: url,
      licence: LICENCE,
    });
    console.log(`${track.title.padEnd(18)} ${genre.padEnd(5)} ${String(piece.bpm).padStart(3)}bpm  ${piece.length}  ${(bytes.length / 1e6).toFixed(1)} MB  → ${track.register}`);
  } catch (err) {
    problems.push(`${track.title}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

writeFileSync(join(outDir, 'index.json'), `${JSON.stringify({ licence: LICENCE, tracks: index }, null, 2)}\n`);
for (const p of problems) console.error(`  FAILED  ${p}`);
console.log(`\nmusic: ${index.length}/${TRACKS.length} tracks, ${(index.reduce((n, t) => n + t.bytes, 0) / 1e6).toFixed(1)} MB total`);

// A build without music is quiet, not broken — but a build with the *wrong*
// music is worse than a silent one, so a track that failed its genre check is
// a hard failure rather than a missing file.
if (problems.some((p) => p.includes('filed under'))) process.exit(1);
if (!index.length) process.exit(1);
