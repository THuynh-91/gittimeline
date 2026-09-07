// Run from the repository root. Transforms are diagnostic and remain in memory.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const variants = [
  { name: 'baseline' },
  { name: 'uncapped-weight', uncap: true },
  { name: 'aggregate-not-quiet', classify: true },
  { name: 'combined', uncap: true, classify: true },
];
const results = [];
mkdirSync('x', { recursive: true });
for (const variant of variants) {
  const server = await createServer({
    configFile: false, resolve: { alias: { '@': resolve('src') } },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error',
    plugins: [{ name: 'isolated-clock-experiment', enforce: 'pre', transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/choreography/compile.ts')) {
        if (variant.uncap) code = code.replace('Math.min(3.2, Math.log2(span.memberCount + 1) * 0.55)', 'Math.log2(span.memberCount + 1) * 0.55');
        if (variant.classify) code = code.replace('      weight,', '      weight,\n      aggregated: aggIdx !== undefined,');
        return code;
      }
      if (variant.classify && id.replaceAll('\\', '/').endsWith('/src/choreography/clock.ts')) {
        return code.replace('if (dh > GAP_THRESHOLD) {', 'if (dh > GAP_THRESHOLD && !it.aggregated) {');
      }
    } }],
  });
  try {
    const { parseArtifact } = await server.ssrLoadModule('/src/export/artifact.ts');
    const { compilePerformance } = await server.ssrLoadModule('/src/choreography/compile.ts');
    const { mapMonotone } = await server.ssrLoadModule('/src/choreography/clock.ts');
    for (const stem of ['nodejs-node', 'python-cpython']) {
      const side = JSON.parse(readFileSync(`public/catalog/${stem}.perf.json`, 'utf8'));
      const { dataset } = await parseArtifact(new Blob([readFileSync(`public/catalog/${stem}.gittimeline.gz`)]));
      const started = performance.now();
      const p = compilePerformance(dataset, { preset: side.preset, seed: side.seed });
      if (variant.name === 'baseline' && p.planHash !== side.planHash) throw new Error(`Baseline differs from published plan: ${stem}`);
      const agg = p.aggregates.reduce((a, b) => b.memberCount > a.memberCount ? b : a);
      const entry = p.nodes.find(n => n.sha === agg.boundaryShas[0]);
      const exit = p.nodes.find(n => n.sha === agg.boundaryShas[1]);
      const sorted = p.nodes.slice().sort((a, b) => a.impact - b.impact);
      const prev = sorted[sorted.indexOf(exit) - 1];
      const startYear = new Date(p.timeMap[0][0]).getUTCFullYear();
      const endYear = new Date(p.timeMap.at(-1)[0]).getUTCFullYear();
      const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => {
        const y = startYear + i;
        return [y, mapMonotone(p.timeMap, Date.UTC(y + 1, 0, 1)) - mapMonotone(p.timeMap, Date.UTC(y, 0, 1))];
      });
      const result = {
        variant: variant.name, stem, planHash: p.planHash, baselineHash: side.planHash,
        compileSeconds: (performance.now() - started) / 1000,
        duration: p.duration, nodes: p.nodes.length, yearsUnder50ms: years.filter(v => v[1] < 0.05).length,
        since2016Seconds: p.timeMap.at(-1)[1] - mapMonotone(p.timeMap, Date.UTC(2016, 0, 1)),
        since2018Seconds: p.timeMap.at(-1)[1] - mapMonotone(p.timeMap, Date.UTC(2018, 0, 1)),
        largestAggregate: { id: agg.id, members: agg.memberCount, years: (agg.historicalEnd - agg.historicalStart) / 86400000 / 365.25,
          precedingStep: exit.impact - prev.impact, traversalSeconds: exit.impact - entry.impact,
          quietCaption: p.events.filter(e => e.type === 'QUIET_GAP' && e.subjectIds.includes(exit.sha)).map(e => e.caption) },
        years,
      };
      results.push(result);
      const { years: omitted, ...summary } = result;
      console.log(JSON.stringify(summary));
      writeFileSync('x/proposal-investigation.json', JSON.stringify(results, null, 2));
    }
  } finally { await server.close(); }
}
