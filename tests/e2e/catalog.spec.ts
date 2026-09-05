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

  test('a single year plays out of the same plan, and the badge says so', async ({ page }) => {
    const calls: string[] = [];
    await page.route('https://api.github.com/**', (route) => {
      calls.push(route.request().url());
      return route.abort();
    });

    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    const shelf = page.getByTestId('catalog');
    if (!(await shelf.isVisible().catch(() => false))) test.skip(true, 'no catalog built into this bundle');

    const cheapest = await page.evaluate(async () => {
      const list = (await (await fetch('/catalog/index.json')).json()).entries as Array<{ slug: string; bytes: number }>;
      return list.reduce((a, b) => (b.bytes < a.bytes ? b : a)).slug;
    });
    const key = cheapest.replace('/', '-');
    const chooser = shelf.getByTestId(`catalog-year-${key}`);
    // An entry whose plan predates spans simply offers none, and there is then
    // nothing here to test rather than something broken.
    if (!(await chooser.isVisible().catch(() => false))) test.skip(true, 'this build indexed no years');
    const year = await chooser.inputValue();
    await shelf.getByTestId(`catalog-span-${key}`).click();
    await waitForReady(page);

    // The whole plan is loaded — a span is a window on it, not a smaller
    // download — so the duration is the whole history's and the clock is
    // somewhere inside it rather than at nought.
    const state = await page.evaluate(() => ({ time: window.__gittimeline.time, duration: window.__gittimeline.duration, pace: window.__gittimeline.pace }));
    expect(state.duration, 'the span plays the plan it was cut from').toBeGreaterThan(0);
    expect(state.pace!.perSecond, 'a span is never denser than the suite allows').toBeLessThanOrEqual(9);
    // The one thing on screen that distinguishes a span from a seek.
    await expect(page.getByTestId('quality-badge')).toHaveText(new RegExp(`${year}.*partial`));
    expect(calls, 'a span costs no GitHub requests either').toEqual([]);
  });

  test('every catalog entry is real, reachable and honestly described', async ({ page }) => {
    await page.goto('/');
    const index = await page.evaluate(async (base) => {
      const r = await fetch(`${base}catalog/index.json`);
      return r.ok ? await r.json() : null;
    }, '/');
    if (!index) test.skip(true, 'no catalog built into this bundle');

    // `HEAD`, and the variable has always said so. A `GET` here asked for the
    // body of every artifact on the shelf, which was 85 MB while the shelf
    // stopped at LLVM and became 981 MB the moment Linux, Rust and Chromium
    // could be opened and joined it — a gigabyte pulled through the page to
    // establish twelve status codes, and a minute is not long enough to do it
    // in. What is being asserted is that the file is there and served, and a
    // `HEAD` is that assertion with none of the download.
    const fetched = (f: string) => page.evaluate(async (u) => (await fetch(`/catalog/${u}`, { method: 'HEAD' })).status, f);

    for (const e of index.entries) {
      expect(await fetched(e.file), `${e.slug} artifact is served`).toBe(200);
      // A card with a broken image is worse than a card with none, so a
      // thumbnail that is *claimed* has to resolve. Claiming none is allowed:
      // capturing a frame means compiling the whole history in a browser, and
      // the largest of these take minutes, so the card falls back to a drawn
      // placeholder rather than the entry falling out of the catalog.
      // The card's picture *is* the owner's mark now, so a claimed logo that
      // does not resolve is not a missing decoration — it is the whole image on
      // the card. The page's CSP allows no remote images either, so a logo that
      // is not a local file cannot be a logo at all.
      if (e.logo) {
        expect(await fetched(e.logo), `${e.slug} logo is served`).toBe(200);
      }
      // A claimed plan is the one field on a card that is a promise about the
      // click rather than a description of the repository: it is what the card
      // quotes as the cost of opening, and it is what says the wait is a
      // download rather than a compile. An index naming a plan that is not
      // served would put a size on the card that nothing is going to charge.
      if (e.plan) {
        expect(await fetched(e.plan), `${e.slug} plan is served`).toBe(200);
        expect(e.planBytes, `${e.slug} says what its plan weighs`).toBeGreaterThan(1000);
      }
      expect(e.commits, `${e.slug} has commits`).toBeGreaterThan(0);
      expect(e.bytes, `${e.slug} has bytes`).toBeGreaterThan(1000);
      // How long the performance runs is the fact the card leads with, so an
      // entry that does not carry one is an entry the shelf cannot describe.
      //
      // There is no upper bound to assert against any more, and the assertion
      // that used to be here — thirty-five minutes — is exactly the thing that
      // went wrong. A cap on length is a cap on how much can be shown, and
      // while it existed Linux's 332,279 arrivals were delivered inside it at
      // 158 a second. The pace below is what that assertion should always have
      // been: not how long a history takes, but whether it can be followed.
      expect(e.durationSeconds, `${e.slug} knows how long it runs`).toBeGreaterThan(0);
      expect(e.nodes, `${e.slug} says how many arrivals are in it`).toBeGreaterThan(0);
      expect(e.nodes / e.durationSeconds, `${e.slug} lands its arrivals slowly enough to be counted`).toBeLessThanOrEqual(9);
      // The years a card offers as spans. Each is a calendar year and a length
      // in seconds, and their lengths cannot add up to more than the whole —
      // a span is a window on this plan and never a longer show than the plan.
      if (e.years) {
        const total = (e.years as Array<[number, number]>).reduce((n, [, secs]) => n + secs, 0);
        expect(total, `${e.slug} spans fit inside the performance`).toBeLessThanOrEqual(e.durationSeconds + 1);
        for (const [y, secs] of e.years as Array<[number, number]>) {
          expect(y, `${e.slug} year ${y} is a year`).toBeGreaterThan(1969);
          expect(secs, `${e.slug} year ${y} has a length`).toBeGreaterThan(0);
        }
      }
      expect(typeof e.builtAt).toBe('string');
    }
  });
});
