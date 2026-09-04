/**
 * Build the pre-fetched catalog.
 *
 *   GH_TOKEN=<token> node scripts/build-catalog.mjs [outDir]
 *
 * Why this exists: GitHub gives an anonymous visitor about 60 requests an hour,
 * which is a few thousand commits. A large repository needs hundreds. The
 * honest answer is not to ship a token — a browser must send it as an
 * `Authorization` header, so anyone can read it straight out of the network
 * tab — but to do the fetching once, here, with a token that never leaves the
 * build, and ship the *result* as a static file. A visitor then watches a large
 * history with no token and no API requests at all.
 *
 * Why it drives the real interface instead of calling the API directly: the
 * only path into the canonical model is `buildDataset`, and duplicating its
 * normalization in a build script is exactly how the two would drift. So this
 * opens the built site in a browser, types the token into the page the way a
 * person would, loads the repository, and asks the app for the artifact it
 * would have exported. Whatever the app considers true is what gets shipped.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'public/catalog';
const base = process.env.GD_BASE ?? 'http://localhost:4173/';
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
const { entries } = JSON.parse(readFileSync('catalog.json', 'utf8'));

if (!token) {
  console.error('No token. Set GH_TOKEN (locally) or GITHUB_TOKEN (in Actions).');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const index = [];

for (const entry of entries) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  let requests = 0;
  page.on('request', (r) => {
    if (r.url().startsWith('https://api.github.com/')) requests++;
  });
  const started = Date.now();
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__gittimeline);
    await page.getByTestId('token-disclosure').click();
    await page.getByTestId('landing-token').fill(token);
    await page.getByRole('button', { name: 'Use', exact: true }).click();

    await page.getByTestId('url-input').fill(entry.slug);
    await page.getByTestId('play-button').click();

    const chooser = page.getByTestId('scope-chooser');
    if (await chooser.waitFor({ timeout: 45000 }).then(() => true).catch(() => false)) {
      if (entry.scope) await page.getByRole('button', { name: entry.scope, exact: true }).click();
      else await page.getByTestId('scope-full').click();
    }

    await page.waitForFunction(
      (want) => window.__gittimeline.source?.slug.toLowerCase() === want,
      entry.slug.toLowerCase(),
      { timeout: 900000 },
    );

    const packed = await page.evaluate(() => window.__gittimeline.artifact());
    if (!packed) throw new Error('the app produced no artifact');
    const bytes = Buffer.from(packed, 'base64');
    const file = `${entry.slug.replace('/', '-')}.gittimeline.gz`;
    writeFileSync(join(outDir, file), bytes);

    // A picture of the finished history, so the shelf is something you can
    // look at rather than a list of names. This is a real frame of the real
    // performance at its final tableau — not an illustration of one — which
    // is both more honest and far smaller than the SVG poster: that runs to
    // 3.4 MB for a merge-heavy history because it carries every path.
    let shotFile = null;
    let shotBytes = 0;
    try {
      await page.setViewportSize({ width: 1200, height: 420 });
      // Everything except the stage comes off, or the thumbnail is a picture
      // of the interface rather than of the history.
      await page.addStyleTag({
        content: '.rail,.band,.banner,.toast,.topbar,.follow-btn,.view-toggles,.prelude{display:none!important}',
      });
      // Not the final tableau: that shot is deliberately quiet and dim, which
      // is right at the end of a performance and makes a near-black thumbnail.
      // The widest parallel phrase is the moment the picture is most alive —
      // several threads open at once, trails lit, camera pulled back.
      await page.evaluate(() => {
        const g = window.__gittimeline;
        const widest = g
          .events('PARALLEL_PHRASE')
          .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
        g.seek(widest ? widest.start + (widest.end - widest.start) * 0.6 : g.duration * 0.72);
        g.play();
      });
      await page.waitForTimeout(900); // let trails and glow build under motion
      // JPEG, not PNG: the stage is a dark photographic gradient with fine
      // strokes over it, which PNG stores at ~220 KB a frame and JPEG at a
      // fraction of that with no visible difference at card size.
      const shot = await page.getByTestId('stage-canvas').screenshot({ type: 'jpeg', quality: 82 });
      shotFile = `${entry.slug.replace('/', '-')}.jpg`;
      writeFileSync(join(outDir, shotFile), shot);
      shotBytes = shot.length;
    } catch (err) {
      console.warn(`  ${entry.slug}: no thumbnail — ${err instanceof Error ? err.message : String(err)}`);
    }

    const stats = await page.evaluate(() => window.__gittimeline.stats);
    // Coverage must be recorded honestly: a truncated fetch shipped as a
    // catalog entry would misrepresent the repository to every visitor.
    const coverage = await page.getByTestId('quality-badge').textContent().catch(() => null);
    const banner = await page.locator('.banner').first().textContent().catch(() => null);
    if (coverage && coverage.trim() !== 'exact' && !entry.scope) {
      console.warn(`  ${entry.slug}: coverage is "${coverage.trim()}"${banner ? ` — ${banner.replace(/\s+/g, ' ').trim().slice(0, 160)}` : ''}`);
    }
    index.push({
      slug: entry.slug,
      title: entry.title ?? entry.slug,
      blurb: entry.blurb ?? '',
      scope: entry.scope ?? null,
      file,
      poster: shotFile,
      posterBytes: shotBytes,
      bytes: bytes.length,
      commits: stats.commits,
      merges: stats.merges,
      contributors: stats.contributors,
      coverage: coverage ? coverage.trim() : null,
      builtAt: new Date().toISOString(),
    });
    console.log(
      `${entry.slug}${entry.scope ? ` (${entry.scope})` : ''}: ${stats.commits} commits, ` +
        `${requests} requests, ${(bytes.length / 1e6).toFixed(2)} MB` +
        `${shotBytes ? ` + ${(shotBytes / 1024).toFixed(0)} KB thumbnail` : ''}, ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
  } catch (err) {
    // One repository failing must not cost the whole catalog: ship what worked.
    console.error(`${entry.slug}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await page.close();
  }
}

await browser.close();
writeFileSync(join(outDir, 'index.json'), `${JSON.stringify({ entries: index }, null, 2)}\n`);
console.log(`\ncatalog: ${index.length}/${entries.length} entries, ${(index.reduce((n, e) => n + e.bytes, 0) / 1e6).toFixed(2)} MB total`);
if (!index.length) process.exit(1);
