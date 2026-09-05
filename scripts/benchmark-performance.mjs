#!/usr/bin/env node

/**
 * Repeatable compiler benchmark for a prebuilt GitTimeline artifact.
 *
 * Usage:
 *   node scripts/benchmark-performance.mjs public/catalog/torvalds-linux.gittimeline.gz
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const file = resolve(process.argv[2] ?? 'public/catalog/torvalds-linux.gittimeline.gz');
const started = performance.now();
const compressed = readFileSync(file);
const decoded = gunzipSync(compressed);
const raw = JSON.parse(decoded.toString('utf8'));

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { validateArtifact } = await vite.ssrLoadModule('/src/export/artifact.ts');
  const { dataset } = validateArtifact(raw);
  const loaded = performance.now();
  if (process.argv.includes('--threads-only')) {
    const { buildGraph } = await vite.ssrLoadModule('/src/dag/graph.ts');
    const { correctTimestamps } = await vite.ssrLoadModule('/src/dag/time.ts');
    const { selectSpine } = await vite.ssrLoadModule('/src/dag/spine.ts');
    const { assignThreads } = await vite.ssrLoadModule('/src/dag/threads.ts');
    const graphStart = performance.now();
    const graph = buildGraph(dataset.commits);
    const timestamps = correctTimestamps(graph, dataset.commits);
    const spine = selectSpine(graph, dataset, timestamps.presentation);
    const threadsStart = performance.now();
    const threads = assignThreads(graph, dataset, spine, timestamps.presentation);
    const finished = performance.now();
    console.log(
      JSON.stringify(
        {
          commits: dataset.commits.length,
          graphMilliseconds: Math.round((threadsStart - graphStart) * 10) / 10,
          threadMilliseconds: Math.round((finished - threadsStart) * 10) / 10,
          threads: threads.threads.length,
        },
        null,
        2,
      ),
    );
    process.exitCode = 0;
  } else {
    const { compilePerformance } = await vite.ssrLoadModule('/src/choreography/compile.ts');
  const marks = [];
  let previous = loaded;
  const perf = compilePerformance(
    dataset,
    {
      preset: {
        id: 'cinematic',
        version: 1,
        targetDuration: 0,
        lengthBias: 1,
        reducedMotion: false,
        aggregateAbove: 900,
      },
      seed: 'gitdance',
    },
    (stage) => {
      const now = performance.now();
      if (marks.length) marks[marks.length - 1].milliseconds = Math.round((now - previous) * 10) / 10;
      marks.push({ stage, milliseconds: 0 });
      previous = now;
    },
  );
  const finished = performance.now();
  if (marks.length) marks[marks.length - 1].milliseconds = Math.round((finished - previous) * 10) / 10;
  const memory = process.memoryUsage();
  let indexedEdgeEntries = 0;
  let longEdges = 0;
  let widestEdgeBuckets = 0;
  for (const edge of perf.edges) {
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < edge.pts.length; i += 2) {
      minX = Math.min(minX, edge.pts[i]);
      maxX = Math.max(maxX, edge.pts[i]);
    }
    const buckets = Math.floor((maxX + 12) / 640) - Math.floor((minX - 12) / 640) + 1;
    widestEdgeBuckets = Math.max(widestEdgeBuckets, buckets);
    if (buckets > 49) longEdges++;
    else indexedEdgeEntries += buckets;
  }
  console.log(
    JSON.stringify(
      {
        file,
        compressedBytes: compressed.byteLength,
        decodedBytes: decoded.byteLength,
        commits: dataset.commits.length,
        loadMilliseconds: Math.round((loaded - started) * 10) / 10,
        compileMilliseconds: Math.round((finished - loaded) * 10) / 10,
        stages: marks,
        output: {
          nodes: perf.nodes.length,
          edges: perf.edges.length,
          threads: perf.threads.length,
          aggregates: perf.aggregates.length,
          events: perf.events.length,
          camera: perf.camera.length,
          duration: perf.duration,
          bounds: perf.bounds,
          planHash: perf.planHash,
        },
        heapUsedBytes: memory.heapUsed,
        renderIndex: { indexedEdgeEntries, longEdges, widestEdgeBuckets },
      },
      null,
      2,
    ),
  );
  }
} finally {
  await vite.close();
}
