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

    const stats = await page.evaluate(() => window.__gittimeline.stats);
    const coverage = await page.evaluate(() => window.__gittimeline.source?.coverage ?? null);
    index.push({
      slug: entry.slug,
      title: entry.title ?? entry.slug,
      blurb: entry.blurb ?? '',
      scope: entry.scope ?? null,
      file,
      bytes: bytes.length,
      commits: stats.commits,
      merges: stats.merges,
      contributors: stats.contributors,
      coverage,
      builtAt: new Date().toISOString(),
    });
    console.log(
      `${entry.slug}${entry.scope ? ` (${entry.scope})` : ''}: ${stats.commits} commits, ` +
        `${requests} requests, ${(bytes.length / 1e6).toFixed(2)} MB, ${((Date.now() - started) / 1000).toFixed(0)}s`,
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
