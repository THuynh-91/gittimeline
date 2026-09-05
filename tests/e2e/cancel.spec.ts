import { expect, test } from '@playwright/test';

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
    if (!(await shelf.isVisible().catch(() => false))) test.skip(true, 'no catalog built into this bundle');

    // The largest entry, because cancelling is only possible while a load is
    // still running and the small ones are open before a click can land.
    const biggest = await page.evaluate(async () => {
      const list = (await (await fetch('/catalog/index.json')).json()).entries as Array<{ slug: string; planBytes?: number; bytes: number }>;
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
    if (!(await shelf.isVisible().catch(() => false))) test.skip(true, 'no catalog built into this bundle');
    const first = await page.evaluate(async () => {
      const list = (await (await fetch('/catalog/index.json')).json()).entries as Array<{ slug: string; bytes: number }>;
      return list.reduce((a, b) => (b.bytes < a.bytes ? b : a)).slug;
    });
    await shelf.getByTestId(`catalog-${first.replace('/', '-')}`).click();
    await page.getByTestId('scope-cancel').click();
    await expect(page.getByTestId('catalog-page')).toBeVisible();
  });
});
