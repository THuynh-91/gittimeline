import { expect, test } from '@playwright/test';
import { waitForReady } from './helpers';

/**
 * The catalog is the honest answer to "can I share my token so other people
 * get a higher rate limit". A token in the client is readable by anyone who
 * opens the network tab, so the fetching happens once at build time instead.
 * The property that matters is therefore not that it loads, but that it loads
 * having asked GitHub for nothing at all.
 */
test.describe('pre-fetched catalog', () => {
  test('a large history plays with no token and no GitHub requests', async ({ page }) => {
    const calls: string[] = [];
    await page.route('https://api.github.com/**', (route) => {
      calls.push(route.request().url());
      return route.abort();
    });

    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    const shelf = page.getByTestId('catalog');
    // A build without a catalog simply has no shelf; nothing here is a failure.
    if (!(await shelf.isVisible().catch(() => false))) test.skip(true, 'no catalog built into this bundle');

    await page.getByTestId('catalog-public-apis-public-apis').click();
    await waitForReady(page);

    const stats = await page.evaluate(() => window.__gittimeline.stats);
    expect(stats!.commits).toBeGreaterThan(1000);
    expect(stats!.merges).toBeGreaterThan(300);
    expect(await page.evaluate(() => window.__gittimeline.mode)).toBe('player');
    expect(calls, 'the catalog must not touch GitHub').toEqual([]);
  });

  test('every catalog entry is real, reachable and honestly described', async ({ page }) => {
    await page.goto('/');
    const index = await page.evaluate(async (base) => {
      const r = await fetch(`${base}catalog/index.json`);
      return r.ok ? await r.json() : null;
    }, '/');
    if (!index) test.skip(true, 'no catalog built into this bundle');

    for (const e of index.entries) {
      const head = await page.evaluate(async (f) => (await fetch(`/catalog/${f}`)).status, e.file);
      expect(head, `${e.slug} artifact is served`).toBe(200);
      // The shelf leads with a picture; a card with a broken image is worse
      // than a card with none, so the thumbnail must actually be there.
      expect(e.poster, `${e.slug} has a thumbnail`).toBeTruthy();
      const shot = await page.evaluate(async (f) => (await fetch(`/catalog/${f}`)).status, e.poster);
      expect(shot, `${e.slug} thumbnail is served`).toBe(200);
      expect(e.posterBytes, `${e.slug} thumbnail is small enough for a landing page`).toBeLessThan(120_000);
      expect(e.commits, `${e.slug} has commits`).toBeGreaterThan(0);
      expect(e.bytes, `${e.slug} has bytes`).toBeGreaterThan(1000);
      expect(typeof e.builtAt).toBe('string');
    }
  });
});
