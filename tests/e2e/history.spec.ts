import { expect, test } from '@playwright/test';

/**
 * The browser's own Back button.
 *
 * Every route in this app lives at one URL and is chosen by a signal, so the
 * browser had no idea navigation was happening: Back from the selection page
 * left the site entirely. These are the four things that has to mean.
 */
test.describe('going back', () => {
  test('Back and Forward walk the routes the visitor actually took', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('url-input')).toBeVisible();

    await page.getByTestId('catalog-link').click();
    await expect(page.getByTestId('catalog-page')).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#selection');

    await page.getByTestId('signin-link').click();
    await expect(page.getByTestId('signin-page')).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId('catalog-page')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('url-input')).toBeVisible();
    await page.goForward();
    await expect(page.getByTestId('catalog-page')).toBeVisible();
  });

  test('a route survives being reloaded, because a static host never sees the hash', async ({ page }) => {
    // A real path would 404 on GitHub Pages, which has no /selection file —
    // a deep link that works only as long as nobody uses it as a link.
    await page.goto('/#selection');
    await expect(page.getByTestId('catalog-page')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('catalog-page')).toBeVisible();
  });

  test('Back leaves a performance for the page that started it', async ({ page }) => {
    await page.goto('/#demo=1');
    await expect(page.getByTestId('help-button')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('url-input')).toBeVisible();
  });

  test('a share link is not rewritten out from under the visitor', async ({ page }) => {
    await page.goto('/#demo=1&t=3');
    await expect(page.getByTestId('help-button')).toBeVisible();
    // Entering the player used to replace the hash with the bare route, so
    // reloading a shared link landed somewhere else entirely.
    expect(page.url()).toContain('demo=1');
  });
});
