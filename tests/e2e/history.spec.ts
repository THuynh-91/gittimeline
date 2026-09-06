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

  /**
   * The one thing a viewer cannot check for themselves.
   *
   * Somebody comes back from GitHub having pressed Cancel, or having had the
   * authorisation refused. The fragment carrying `gh_error` is stripped on
   * arrival — correctly, it must not be re-shareable — and if nothing is said
   * the page is identical to the one they left. They have no way to tell a
   * refusal from a success.
   *
   * It has been written twice and been dead both times, for three separate
   * reasons: it read the fragment back after `replaceState` had removed it; it
   * set the banner on the line before `loadDemo`, which finishes by clearing
   * it; and the banner is rendered only under `showPlayer`, while the return
   * address is the landing page. Every one of those left the URL correctly
   * cleaned up on the way past, which is exactly what makes the failure look
   * like success. Hence a test, and not a fourth comment.
   */
  test('a sign-in that came back refused says so, and does not leave the error in the URL', async ({ page }) => {
    // A real load, not a hash change: `boot` runs once per document, and
    // navigating between two URLs that differ only in the fragment never
    // reloads. That distinction is the whole of what is under test.
    await page.goto('/#gh_error=access_denied');
    await expect(page.locator('.toast')).toContainText('sign-in did not complete');
    expect(await page.evaluate(() => location.hash), 'the failure must not be re-shareable').toBe('');
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
