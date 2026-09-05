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

    // The smallest history on the shelf, rather than a named one. The catalog
    // is rebuilt from whatever has been pre-fetched, and naming an entry here
    // meant the suite broke every time that list changed — which tests the
    // build script's contents, not the property under test.
    //
    // It used to be the first one, on the assumption that the shelf led with
    // its quickest entry. It leads with Linux now: the widest frame on the page
    // rather than the fastest thing on it, 1.5 million commits, and minutes of
    // composition in this tab on any build where the precompiled plan is
    // missing or a version behind. Clicking it here would hang this test on the
    // one entry least able to answer inside a timeout — and the property under
    // test is that a pre-fetched history plays having asked GitHub for nothing,
    // which the smallest artifact demonstrates exactly as well as the largest.
    const cheapest = await page.evaluate(async () => {
      const list = (await (await fetch('/catalog/index.json')).json()).entries as Array<{ slug: string; bytes: number }>;
      return list.reduce((a, b) => (b.bytes < a.bytes ? b : a)).slug;
    });
    await shelf.getByTestId(`catalog-${cheapest.replace('/', '-')}`).click();
    await waitForReady(page);

    const stats = await page.evaluate(() => window.__gittimeline.stats);
    expect(stats!.commits, 'a catalog entry is a real history').toBeGreaterThan(1000);
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
      // A card with a broken image is worse than a card with none, so a
      // thumbnail that is *claimed* has to resolve. Claiming none is allowed:
      // capturing a frame means compiling the whole history in a browser, and
      // the largest of these take minutes, so the card falls back to a drawn
      // placeholder rather than the entry falling out of the catalog.
      if (e.poster) {
        const shot = await page.evaluate(async (f) => (await fetch(`/catalog/${f}`)).status, e.poster);
        expect(shot, `${e.slug} thumbnail is served`).toBe(200);
      }
      expect(e.posterBytes, `${e.slug} thumbnail is small enough for a landing page`).toBeLessThan(120_000);
      // The owner's logo is under the same rule as the thumbnail, and for a
      // sharper reason: the page's CSP allows no remote images, so a logo that
      // is not a local file cannot be a logo at all. Claiming one that does not
      // resolve would put a broken image on the page that promises no requests.
      if (e.logo) {
        const mark = await page.evaluate(async (f) => (await fetch(`/catalog/${f}`)).status, e.logo);
        expect(mark, `${e.slug} logo is served`).toBe(200);
      }
      expect(e.commits, `${e.slug} has commits`).toBeGreaterThan(0);
      expect(e.bytes, `${e.slug} has bytes`).toBeGreaterThan(1000);
      // How long the performance runs is the fact the card leads with, so an
      // entry that does not carry one is an entry the shelf cannot describe.
      // The upper bound is the choreographer's own cap: a length past it did
      // not come from a plan this app loaded, it came from somewhere wrong.
      expect(e.durationSeconds, `${e.slug} knows how long it runs`).toBeGreaterThan(0);
      expect(e.durationSeconds, `${e.slug} runs no longer than the cap`).toBeLessThanOrEqual(35 * 60);
      expect(typeof e.builtAt).toBe('string');
    }
  });
});
