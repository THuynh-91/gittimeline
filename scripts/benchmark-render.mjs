#!/usr/bin/env node

/**
 * Browser-side playback benchmark for a prebuilt catalog artifact.
 *
 * Usage:
 *   node scripts/benchmark-render.mjs http://localhost:5173 /catalog/torvalds-linux.gittimeline.gz
 */

import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const origin = process.argv[2] ?? 'http://localhost:5173';
const artifactArg = process.argv[3] ?? '/catalog/torvalds-linux.gittimeline.gz';
const artifactFile = existsSync(artifactArg) ? resolve(artifactArg) : null;
const artifact = artifactFile ? '/__benchmark-artifact.gittimeline' : artifactArg;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  if (artifactFile) {
    await page.route(`**${artifact}`, (route) => route.fulfill({ path: artifactFile, contentType: 'application/octet-stream' }));
  }
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__gittimeline, null, { timeout: 30_000 });
  const loadStart = performance.now();
  await page.evaluate((url) => {
    void window.__gittimeline.loadArtifact(url);
  }, artifact);
  try {
    await page.waitForFunction(
      () => window.__gittimeline?.source?.slug === 'torvalds/linux' && ['READY', 'PAUSED', 'PLAYING'].includes(window.__gittimeline.phase),
      null,
      { timeout: 90_000 },
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      phase: window.__gittimeline?.phase,
      source: window.__gittimeline?.source,
      text: document.body.innerText.slice(0, 1_000),
    }));
    console.log(JSON.stringify({ timeout: error.message, state, errors }, null, 2));
    throw error;
  }
  const loadMilliseconds = performance.now() - loadStart;
  await page.evaluate(() => window.__gittimeline.pause());

  const samples = [];
  for (const fraction of [0.05, 0.5, 0.95]) {
    const sample = await page.evaluate(async (at) => {
      const api = window.__gittimeline;
      const started = performance.now();
      api.seek(api.duration * at);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const seekMilliseconds = performance.now() - started;
      let frames = 0;
      const frameStart = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          frames++;
          if (performance.now() - frameStart >= 2_000) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const elapsed = performance.now() - frameStart;
      return { fraction: at, seekMilliseconds, fps: (frames * 1_000) / elapsed };
    }, fraction);
    samples.push(sample);
  }

  console.log(
    JSON.stringify(
      {
        loadMilliseconds: Math.round(loadMilliseconds),
        stats: await page.evaluate(() => window.__gittimeline.stats),
        samples: samples.map((sample) => ({
          fraction: sample.fraction,
          seekMilliseconds: Math.round(sample.seekMilliseconds * 10) / 10,
          fps: Math.round(sample.fps * 10) / 10,
        })),
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
