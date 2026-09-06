import { expect, test } from '@playwright/test';
import { shelfPresent } from './helpers';

/**
 * Cancelling a load returns to the page it was started from.
 *
 * The landing page keeps a demo compiled behind the hero, so `store.perf` is
 * never null. Cancel read that as "something is loaded, stay on the stage",
 * and a viewer who backed out of a large catalog entry was left looking at
 * "an example history" they had never asked for.
 */
test.describe('backing out', () => {
  test('cancelling a catalog load goes back to the selection page', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    const shelf = page.getByTestId('catalog');
    if (!(await shelfPresent(page))) test.skip(true, 'no catalog built into this bundle');

    // Hold the plan open so the load is reliably still running when Cancel is
    // pressed. Racing it stopped working once the renderer got faster: the
    // button appeared, Playwright began the click, and the performance
    // finished underneath it — "element was detached from the DOM". The thing
    // under test is where cancelling *lands*, not whether a tester can out-run
    // a download, so the download is made to wait instead.
    // What is actually downloaded, which is no longer a `.gtperf.gz`.
    //
    // A published entry is streamed now: `<slug>.pages/manifest.json` and then
    // content-addressed `<sha256>.json.bin` pages, named `.bin` because a
    // `Content-Encoding: gzip` would change the bytes the hash and the length
    // are checked against. So this pattern matched nothing, the delay never
    // applied, and the load finished in 0.9s while Playwright was mid-click —
    // "element was detached from the DOM". The manifest is deliberately left
    // alone: the load has to get far enough to put a Cancel button on screen
    // before there is anything to cancel.
    await page.route(/\.(bin|gtperf\.gz)$/, async (route) => {
      await new Promise((r) => setTimeout(r, 10_000));
      await route.continue();
    });

    // The largest entry, because cancelling is only possible while a load is
    // still running and the small ones are open before a click can land.
    const biggest = await page.evaluate(async () => {
      const list = (await (await fetch(window.__gittimeline.catalogUrl('index.json'))).json()).entries as Array<{ slug: string; planBytes?: number; bytes: number }>;
      return list.reduce((a, b) => ((b.planBytes ?? b.bytes) > (a.planBytes ?? a.bytes) ? b : a)).slug;
    });
    await shelf.getByTestId(`catalog-${biggest.replace('/', '-')}`).click();
    await page.getByTestId('scope-full').click();

    const cancelButton = page.getByTestId('cancel-button');
    await cancelButton.click({ timeout: 30000 });

    await expect(page.getByTestId('catalog-page')).toBeVisible();
    await expect(page.getByTestId('catalog')).toBeVisible();
  });

  test('dismissing the year question leaves the shelf where it was', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    const shelf = page.getByTestId('catalog');
    if (!(await shelfPresent(page))) test.skip(true, 'no catalog built into this bundle');
    const first = await page.evaluate(async () => {
      const list = (await (await fetch(window.__gittimeline.catalogUrl('index.json'))).json()).entries as Array<{ slug: string; bytes: number }>;
      return list.reduce((a, b) => (b.bytes < a.bytes ? b : a)).slug;
    });
    await shelf.getByTestId(`catalog-${first.replace('/', '-')}`).click();
    await page.getByTestId('scope-cancel').click();
    await expect(page.getByTestId('catalog-page')).toBeVisible();
  });
});
