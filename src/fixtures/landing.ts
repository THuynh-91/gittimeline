import { PEOPLE, Script, type Persona } from './synthetic';
import { hash01 } from '@/model/prng';
import type { Dataset } from '@/model/types';

/**
 * The history behind the landing form.
 *
 * This used to be the scripted demo, which is sixty hand-written commits and
 * about half a minute long. Behind the form that read badly: the same path
 * every time, and every thirty seconds the stage emptied and snapped back to
 * a single commit — a rewind, in full view, on the first thing anyone sees.
 *
 * So this is generated rather than written. It takes a seed and produces a
 * long history with the same vocabulary the scripted demo uses — branches
 * opening, work landing in parallel, merges of increasing weight, handoffs,
 * tags, quiet stretches — but arranged differently every time. Nothing here
 * claims to be a real repository; it is a shop window, and it says so on the
 * page.
 *
 * It stays deterministic for a given seed, like everything else in this
 * project: `hash01` is the same seeded PRNG the choreography uses, and there
 * is no `Math.random` anywhere near it. A different seed is a different path,
 * which is the point — the landing advances the seed instead of rewinding.
 */

const CAST: Persona[] = [PEOPLE.mara, PEOPLE.devi, PEOPLE.kofi, PEOPLE.ines, PEOPLE.yuki];

/** Branch names that read like work rather than like filler. */
const AREAS = [
  'auth', 'render', 'storage', 'parser', 'scheduler', 'network', 'cache', 'plugins',
  'i18n', 'search', 'export', 'theme', 'api', 'metrics', 'sync', 'editor',
];
const KINDS = ['feature', 'fix', 'perf', 'refactor'];

/** Subjects, assembled so the ledger reads like a project and not like lorem. */
const VERBS = ['Add', 'Extract', 'Rework', 'Tighten', 'Simplify', 'Cache', 'Batch', 'Guard', 'Document', 'Profile'];
const NOUNS = [
  'the update loop', 'the token check', 'the draw path', 'the index build', 'the retry policy',
  'the config loader', 'the error surface', 'the frame budget', 'the query planner', 'the write barrier',
  'the layout pass', 'the migration step', 'the socket handler', 'the parse table',
];

/**
 * How long the path runs before it has to start again.
 *
 * Long enough that nobody reaches the end. At the landing's third-speed this
 * is upwards of half an hour of material, which is longer than anyone spends
 * deciding what to type into a box — so in practice the path has no end, which
 * is what was asked for. Should someone stay that long, the next seed builds a
 * different history and the stage cross-fades into it rather than cutting.
 */
const COMMITS = 2400;

export function buildLandingDataset(seed: string): Dataset {
  const rnd = (salt: string) => hash01(`${seed}:${salt}`);
  const pick = <T>(arr: T[], salt: string): T => arr[Math.floor(rnd(salt) * arr.length) % arr.length]!;

  // Start the calendar somewhere plausible and different per seed, so the date
  // readout is not the same year on every visit.
  const year = 2016 + Math.floor(rnd('year') * 8);
  // This name reaches the interface. It was `gittimeline-landing-<seed>`, so
  // the header read "gittimeline/gittimeline-landing-1" the moment this history
  // was promoted to the player — an internal identifier, seed counter and all,
  // presented as though it were a repository somebody could go and look at.
  const s = new Script('an example history', `${year}-0${1 + Math.floor(rnd('month') * 9)}-04T09:00:00Z`, 'main');

  let n = 0;
  const id = (p: string) => `${p}-${n++}`;
  const subject = (i: number) => `${pick(VERBS, `v${i}`)} ${pick(NOUNS, `n${i}`)}`;

  // The main line always exists; side branches come and go around it.
  s.commit('main', id('c'), CAST[0]!, { message: 'Initial commit' });

  /**
   * `phase` and `period` are what stop this reading as a Gantt chart.
   *
   * A review of the landing: "it reads as a Gantt chart". It did, and the
   * reason was structural rather than cosmetic. Every branch opened from
   * `main` and merged back to `main`, so the topology was a star, and every
   * open branch committed on about two steps in three, so each one drew an
   * unbroken horizontal bar in its own lane. Parallel bars in rows, nothing
   * crossing: that is a Gantt chart, drawn correctly.
   *
   * Two changes, each producing something a star cannot: a branch may be cut
   * from another open branch, so lines have depth and cross; and a branch may
   * land in another branch rather than in `main`, so merges are not all one
   * diagonal into one lane.
   *
   * A third change was tried and reverted: making the work bursty rather than
   * uniform. It broke up the bars by emptying the stage, which is the wrong
   * trade; the measurement is in the loop below.
   */
  interface Open { name: string; commits: number; owner: Persona; opened: number }
  const open: Open[] = [];
  let mainOwner = CAST[0]!;
  let nextTag = 1;
  let used = 0;

  for (let step = 0; used < COMMITS; step++) {
    const r = (salt: string) => rnd(`${step}:${salt}`);

    // Open a branch. More of them early, so the picture widens as it goes and
    // the busiest stretch is somewhere in the middle rather than at the edges.
    const width = open.length;
    // Up to fourteen lanes rather than six. Six was enough for the picture to
    // be *correct* and not enough for it to be worth looking at: measured over
    // a whole path, ninety-three per cent of the light fell in one 300px band
    // of an 800px frame, because there were never enough threads open at once
    // to give the camera a box with any height to it.
    if (width < 14 && r('open') < 0.55 - width * 0.03) {
      const name = `${pick(KINDS, `k${step}`)}/${pick(AREAS, `a${step}`)}-${step}`;
      // A third of branches are cut from another open branch rather than from
      // `main`. This is the one change that gives the picture depth: a branch
      // of a branch has to merge home through its parent, so its line crosses
      // lanes on the way rather than running straight back to the spine.
      const host = open.length && r('nest') < 0.34 ? pick(open, `host${step}`) : null;
      s.branch(name, host ? host.name : 'main');
      open.push({ name, commits: 0, owner: pick(CAST, `o${step}`), opened: step });
    }

    // Work lands on the main line and on whatever is open. A quiet stretch now
    // and then keeps the pace from being uniform, which is what makes the
    // busy parts read as busy.
    const quiet = r('quiet') < 0.12;
    const days = quiet ? 4 + r('gap') * 20 : 0.3 + r('d') * 1.6;

    if (r('main') < 0.55) {
      // Handoffs: the main line changes hands occasionally, which is the one
      // thing that makes contributor colour mean something on screen.
      if (r('handoff') < 0.12) mainOwner = pick(CAST, `h${step}`);
      s.commit('main', id('c'), mainOwner, { days, message: subject(used) });
      used++;
    }

    for (const b of open) {
      if (used >= COMMITS) break;
      /**
       * Uniform, and that is deliberate after trying the alternative.
       *
       * Making the work bursty -- a branch busy for part of a cycle and quiet
       * for the rest -- was the obvious answer to "it reads as bars", and it
       * was measured and reverted. Lit pixels on the landing at 32 s fell from
       * 2.54% to 0.74% and the share of rows carrying any ink from 22% to 11%:
       * it did break the bars up, by emptying the stage. That undoes the
       * deliberate work recorded above this loop, which widened the picture to
       * fourteen lanes precisely so the camera had a box with height to it.
       *
       * A starved picture is more Gantt-like, not less, because what is left
       * is the few longest lines. So the volume stays and the *topology*
       * carries the change: see `nest` above and `side` below.
       */
      if (r(`w${b.name}`) > 0.62) continue;
      s.commit(b.name, id('c'), b.owner, { days: 0.2 + r(`bd${b.name}`) * 0.9, message: subject(used) });
      b.commits++;
      used++;
    }

    // Land the oldest branch once it has enough behind it. Waiting makes the
    // merge heavy, and merge weight is what the impact scales on — a branch
    // that lands twelve commits looks and reads bigger than one that lands two.
    const ripe = open.filter((b) => b.commits >= 2 && step - b.opened >= 2);
    if (ripe.length && r('land') < 0.45) {
      // Occasionally take several at once: an octopus is the biggest gesture
      // the motion language has and it should not be rationed to never.
      const octopus = ripe.length >= 3 && r('oct') < 0.18;
      const taking = octopus ? ripe.slice(0, 3) : [ripe[0]!];
      for (const b of taking) s.keep(b.name);
      const target = octopus ? taking.map((b) => b.name) : taking[0]!.name;
      /**
       * Not always into `main`.
       *
       * A single branch sometimes lands in another open branch instead, which
       * is how work actually converges in a repository of any size: a feature
       * collects its parts before the whole thing goes home. On the stage it
       * is the difference between every merge being one diagonal into the
       * spine and merges happening out in the branches, which is most of what
       * makes a graph look like a graph.
       *
       * Octopuses still go to `main` -- three branches converging is the
       * biggest gesture the motion language has and it belongs on the line
       * everybody is watching.
       */
      const others = open.filter((b) => !taking.includes(b) && b.commits >= 1);
      const into = !octopus && others.length && r('side') < 0.28 ? pick(others, `into${step}`) : null;
      const label = octopus
        ? `Merge ${taking.length} branches`
        : `Merge ${taking[0]!.name}${into ? ` into ${into.name}` : ''}`;
      const mergeId = id('m');
      s.merge(into ? into.name : 'main', target, mergeId, into ? into.owner : mainOwner, { days: 0.4 + r('md') * 0.8, message: label });
      used++;
      if (into) into.commits++;
      for (const b of taking) open.splice(open.indexOf(b), 1);

      // Tags land on merges, which is where releases really land.
      if (!into && r('tag') < 0.22) s.tag(`v0.${nextTag++}.0`, mergeId);
    }
  }

  // Leave a couple of threads unmerged. A repository that is still being
  // worked on has live tips, and the beacons that mark them are part of the
  // language; ending with everything neatly landed would be the unusual case.
  for (const b of open.slice(0, 2)) s.keep(b.name);

  return s.build();
}
