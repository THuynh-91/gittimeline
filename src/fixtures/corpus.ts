import { PEOPLE, Script, buildSynthetic, type Persona } from './synthetic';
import type { Dataset } from '@/model/types';

/**
 * Synthetic topology suite (spec Appendix B). Each fixture is a tiny,
 * deterministic history that isolates one structural situation. They double
 * as documentation, regression tests and manual QA material.
 */
export interface Fixture {
  id: string;
  title: string;
  build: () => Dataset;
}

const { mara, devi, kofi, ines, yuki, bot, anon } = PEOPLE;

export const FIXTURES: Fixture[] = [
  {
    id: '01-linear',
    title: 'One root, linear commits',
    build: () => {
      const s = new Script('01-linear', '2020-01-01T00:00:00Z');
      s.commit('main', 'c0', mara);
      for (let i = 1; i <= 8; i++) s.commit('main', `c${i}`, i % 3 === 0 ? devi : mara, { days: 2 });
      return s.build();
    },
  },
  {
    id: '02-simple-split-merge',
    title: 'Simple branch and merge',
    build: () => {
      const s = new Script('02-simple-split-merge', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      s.commit('main', 'b', mara, { days: 1 });
      s.branch('feature', 'main');
      s.commit('feature', 'f1', devi, { days: 1 });
      s.commit('main', 'c', mara, { days: 1 });
      s.commit('feature', 'f2', devi, { days: 1 });
      s.merge('main', 'feature', 'm', mara, { days: 1 });
      s.commit('main', 'd', mara, { days: 1 });
      return s.build();
    },
  },
  {
    id: '03-two-parallel-threads',
    title: 'Two simultaneous feature threads',
    build: () => {
      const s = new Script('03-two-parallel-threads', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      s.branch('x', 'main');
      s.branch('y', 'main');
      for (let i = 0; i < 4; i++) {
        s.commit('x', `x${i}`, devi, { days: 0.5 });
        s.commit('y', `y${i}`, kofi, { days: 0.5 });
      }
      s.merge('main', 'x', 'mx', mara, { days: 1 });
      s.merge('main', 'y', 'my', mara, { days: 1 });
      return s.build();
    },
  },
  {
    id: '04-nested-divergence',
    title: 'A branch that branches',
    build: () => {
      const s = new Script('04-nested-divergence', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      s.branch('outer', 'main');
      s.commit('outer', 'o1', devi, { days: 1 });
      s.branch('inner', 'outer');
      s.commit('inner', 'i1', kofi, { days: 1 });
      s.commit('outer', 'o2', devi, { days: 1 });
      s.commit('inner', 'i2', kofi, { days: 1 });
      s.merge('outer', 'inner', 'oi', devi, { days: 1 });
      s.commit('main', 'b', mara, { days: 0.5 });
      s.merge('main', 'outer', 'mo', mara, { days: 1 });
      return s.build();
    },
  },
  {
    id: '05-long-running-side-thread',
    title: 'Long-running side thread merged late',
    build: () => {
      const s = new Script('05-long-running-side-thread', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      s.branch('long', 'main');
      for (let i = 0; i < 6; i++) {
        s.commit('main', `m${i}`, mara, { days: 7 });
        s.commit('long', `l${i}`, ines, { days: 5 });
      }
      s.merge('main', 'long', 'ml', mara, { days: 3 });
      return s.build();
    },
  },
  {
    id: '06-unmerged-current-ref',
    title: 'A branch that is still open',
    build: () => {
      const s = new Script('06-unmerged-current-ref', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      s.commit('main', 'b', mara, { days: 1 });
      s.branch('wip', 'main');
      s.commit('wip', 'w1', devi, { days: 1 });
      s.commit('main', 'c', mara, { days: 1 });
      s.commit('wip', 'w2', devi, { days: 1 });
      s.keep('wip');
      return s.build();
    },
  },
  {
    id: '07-octopus-merge',
    title: 'Octopus merge with three parents',
    build: () => {
      const s = new Script('07-octopus-merge', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      s.branch('p', 'main');
      s.branch('q', 'main');
      s.branch('r', 'main');
      s.commit('p', 'p1', devi, { days: 1 });
      s.commit('q', 'q1', kofi, { days: 0.2 });
      s.commit('r', 'r1', ines, { days: 0.2 });
      s.commit('p', 'p2', devi, { days: 1 });
      s.merge('main', ['p', 'q', 'r'], 'octo', mara, { days: 1 });
      s.commit('main', 'b', mara, { days: 1 });
      return s.build();
    },
  },
  {
    id: '08-criss-cross',
    title: 'Criss-cross merges',
    build: () => {
      const s = new Script('08-criss-cross', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      s.branch('side', 'main');
      s.commit('side', 's1', devi, { days: 1 });
      s.commit('main', 'b', mara, { days: 0.5 });
      s.merge('side', 'main', 'sm', devi, { days: 1 });
      s.merge('main', 'side', 'ms', mara, { days: 0.2, message: 'Merge side into main (criss-cross)' });
      s.commit('side', 's2', devi, { days: 1 });
      s.merge('main', 'side', 'final', mara, { days: 1 });
      return s.build();
    },
  },
  {
    id: '09-multiple-roots',
    title: 'Two unrelated histories joined',
    build: () => {
      const s = new Script('09-multiple-roots', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      s.commit('main', 'b', mara, { days: 1 });
      s.commit('other', 'o0', kofi, { days: 0.5, parents: [] });
      s.commit('other', 'o1', kofi, { days: 1 });
      s.commit('main', 'c', mara, { days: 0.5 });
      s.merge('main', 'other', 'join', mara, { days: 1, message: 'Merge unrelated history' });
      return s.build();
    },
  },
  {
    id: '10-clock-skew',
    title: 'Child timestamped before its parent',
    build: () => {
      const s = new Script('10-clock-skew', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      s.commit('main', 'b', mara, { days: 3 });
      s.commit('main', 'skewed', devi, { at: -4, message: 'Committed from a machine with a wrong clock' });
      s.commit('main', 'c', mara, { at: 5 });
      s.commit('main', 'nodate', kofi, { at: 6, rawDate: null, message: 'No timestamp at all' });
      s.commit('main', 'd', mara, { at: 7 });
      return s.build();
    },
  },
  {
    id: '11-dense-linear-burst',
    title: 'A dense burst of linear commits',
    build: () => {
      const s = new Script('11-dense-linear-burst', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      s.commit('main', 'b', mara, { days: 30 });
      for (let i = 0; i < 40; i++) s.commit('main', `burst${i}`, i % 2 ? devi : mara, { days: 0.05 });
      s.commit('main', 'z', mara, { days: 20 });
      return s.build();
    },
  },
  {
    id: '12-merge-storm',
    title: 'Many merges in a short window',
    build: () => {
      const s = new Script('12-merge-storm', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      const people = [devi, kofi, ines, yuki, devi, kofi];
      for (let i = 0; i < 6; i++) {
        s.branch(`f${i}`, 'main');
        s.commit(`f${i}`, `f${i}-1`, people[i]!, { days: 0.3 });
        s.commit(`f${i}`, `f${i}-2`, people[i]!, { days: 0.3 });
      }
      for (let i = 0; i < 6; i++) s.merge('main', `f${i}`, `m${i}`, mara, { days: 0.15 });
      s.commit('main', 'calm', mara, { days: 5 });
      return s.build();
    },
  },
  {
    id: '13-contributor-handoff',
    title: 'Dominant contributor changes on the main line',
    build: () => {
      const s = new Script('13-contributor-handoff', '2020-01-01T00:00:00Z');
      for (let i = 0; i < 5; i++) s.commit('main', `m${i}`, mara, { days: 2 });
      for (let i = 0; i < 5; i++) s.commit('main', `d${i}`, devi, { days: 2 });
      for (let i = 0; i < 5; i++) s.commit('main', `k${i}`, kofi, { days: 2 });
      return s.build();
    },
  },
  {
    id: '14-bots-and-coauthors',
    title: 'Bot-dominated activity',
    build: () => {
      const s = new Script('14-bots-and-coauthors', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      for (let i = 0; i < 8; i++) s.commit('main', `bump${i}`, bot, { days: 3, message: `Bump dependency ${i}` });
      s.commit('main', 'human', devi, { days: 2, message: 'Co-authored fix\n\nCo-authored-by: Kofi Mensah <kofi@example.invalid>' });
      s.commit('main', 'anon', anon, { days: 1 });
      return s.build();
    },
  },
  {
    id: '15-partial-boundaries',
    title: 'Partial history with unloaded parents',
    build: () => {
      const s = new Script('15-partial-boundaries', '2020-01-01T00:00:00Z');
      s.commit('main', 'ancient', mara);
      s.commit('main', 'old', mara, { days: 30 });
      s.commit('main', 'a', mara, { days: 30, missingParents: ['old', 'ancient'] });
      s.branch('side', 'main');
      s.commit('side', 's1', devi, { days: 1 });
      s.commit('main', 'b', mara, { days: 1 });
      s.merge('main', 'side', 'm', mara, { days: 1 });
      return s.build({ truncated: true, reportedCommitCount: 1200 });
    },
  },
  {
    id: '16-known-aggregate',
    title: 'Long known run collapsed into an exact aggregate',
    build: () => {
      const s = new Script('16-known-aggregate', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      for (let i = 0; i < 60; i++) s.commit('main', `run${i}`, i % 4 === 0 ? devi : mara, { days: 0.5 });
      s.branch('f', 'main');
      s.commit('f', 'f1', kofi, { days: 1 });
      s.commit('main', 'z', mara, { days: 1 });
      s.merge('main', 'f', 'mf', mara, { days: 1 });
      return s.build();
    },
  },
  {
    id: '17-unknown-span',
    title: 'A merge whose side history was never loaded',
    build: () => {
      const s = new Script('17-unknown-span', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', mara);
      s.commit('main', 'b', mara, { days: 1 });
      s.commit('ghost', 'g1', devi, { days: 1, parents: ['a'] });
      s.commit('ghost', 'g2', devi, { days: 1 });
      s.merge('main', 'ghost', 'm', mara, { days: 1 });
      s.commit('main', 'c', mara, { days: 1 });
      // Remove the ghost commits: the merge keeps its parent SHA, so it becomes a boundary node.
      s.commits.forEach((c) => {
        if (c.id === 'm') c.missingParents = ['g1', 'g2'];
      });
      return s.build({ truncated: true });
    },
  },
  {
    id: '18-hostile-metadata',
    title: 'Hostile strings and oversized metadata',
    build: () => {
      const evil: Persona = { name: '<img src=x onerror=alert(1)>‮evil', login: 'x'.repeat(200) };
      const s = new Script('18-hostile-metadata', '2020-01-01T00:00:00Z');
      s.commit('main', 'a', evil, { message: '<script>alert(1)</script>' + 'A'.repeat(5000) });
      s.commit('main', 'b', mara, { days: 1, message: 'javascript:alert(1)  control chars' });
      s.commit('main', 'c', evil, { days: 1, message: '“Quotes” & <tags> & ​zero‑width' });
      s.tag('<b>tag</b>'.repeat(30), 'c');
      return s.build();
    },
  },
  {
    id: '19-million-node-synthetic-lod',
    title: 'Large synthetic history (LOD stress, scaled down for the browser)',
    build: () => {
      const s = new Script('19-million-node-synthetic-lod', '2012-01-01T00:00:00Z');
      s.commit('main', 'root', mara);
      const people = [mara, devi, kofi, ines, yuki];
      let branchNo = 0;
      for (let era = 0; era < 12; era++) {
        for (let i = 0; i < 150; i++) s.commit('main', `e${era}-c${i}`, people[(era + i) % people.length]!, { days: 0.4 });
        for (let b = 0; b < 4; b++) {
          const name = `b${branchNo++}`;
          s.branch(name, 'main');
          for (let i = 0; i < 6; i++) s.commit(name, `${name}-${i}`, people[(b + i) % people.length]!, { days: 0.3 });
          s.merge('main', name, `${name}-merge`, mara, { days: 0.5 });
        }
        s.tag(`v${era}.0`, s.head('main')!);
      }
      return s.build();
    },
  },
  {
    id: '20-empty-repository',
    title: 'Repository with no commits',
    build: () =>
      buildSynthetic({ name: '20-empty-repository', epoch: '2020-01-01T00:00:00Z', defaultBranch: 'main', commits: [], refs: [] }),
  },
  {
    id: '21-pull-request-treadmill',
    title: 'Half of all history is pull-request merges',
    build: () => {
      // The shape of a popular list or docs repository — public-apis merges a
      // contributor branch roughly every other commit. It is the most common
      // real-world topology there is, and the one that most easily overwhelms
      // the score, so it belongs in the corpus rather than only on the network.
      const s = new Script('21-pull-request-treadmill', '2021-01-01T00:00:00Z');
      s.commit('main', 'seed', mara);
      const people = [devi, kofi, ines, yuki, mara];
      for (let i = 0; i < 240; i++) {
        const who = people[i % people.length]!;
        s.branch(`pr${i}`, 'main');
        s.commit(`pr${i}`, `pr${i}-1`, who, { days: 0.05 });
        if (i % 3 === 0) s.commit(`pr${i}`, `pr${i}-2`, who, { days: 0.02 });
        s.merge('main', `pr${i}`, `m${i}`, mara, { days: 0.03 });
      }
      return s.build();
    },
  },
];

export function fixtureById(id: string): Fixture | undefined {
  return FIXTURES.find((f) => f.id === id);
}
