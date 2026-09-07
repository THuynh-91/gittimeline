import { expect, test } from './muted';
import { type Page } from '@playwright/test';
import { waitForReady } from './helpers';

/**
 * The performance in words — the stage's own stated alternative.
 *
 * The canvas's alternative text has ended with "Use the Events panel (E) for a
 * textual account" since the stage was written, and there was no panel and no
 * key: the whole of what a screen reader was told about a Canvas2D animation
 * was a pointer to nothing. `accessibility.md` promises six non-canvas
 * equivalences and this is the one the stage itself names.
 */
test.describe('the events panel', () => {
  const load = async (page: Page) => {
    await page.goto('/');
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.loadFixture('12-merge-storm'));
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.pause());
  };

  test('opens with E, and with the button, and closes again', async ({ page }) => {
    await load(page);
    await page.keyboard.press('e');
    await expect(page.getByTestId('events-panel')).toBeVisible();
    // The alt text names the key, so the key is the thing under test — but a
    // keyboard shortcut nobody can discover is not a control on its own.
    await page.keyboard.press('e');
    await expect(page.getByTestId('events-panel')).toHaveCount(0);

    await page.getByTestId('events-button').click();
    await expect(page.getByTestId('events-panel')).toBeVisible();
    await expect(page.getByTestId('events-button')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('events-panel')).toHaveCount(0);
  });

  test('lists nothing that has not happened yet, and grows as it does', async ({ page }) => {
    await load(page);
    await page.evaluate(() => window.__gittimeline.seek(0));
    await page.keyboard.press('e');
    const panel = page.getByTestId('events-panel');
    await expect(panel).toBeVisible();

    // The stage's hardest rule is that nothing is drawn before its moment. A
    // panel listing the whole plan would hand a screen-reader user the ending
    // while a sighted one was minutes away from it.
    const atStart = await page.getByTestId('events-list').locator('li').count();

    const duration = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((d: number) => window.__gittimeline.seek(d * 0.5), duration);
    const half = await page.getByTestId('events-list').locator('li').count();
    await page.evaluate((d: number) => window.__gittimeline.seek(d), duration);
    const end = await page.getByTestId('events-list').locator('li').count();

    expect(half, 'more has happened by halfway').toBeGreaterThan(atStart);
    expect(end, 'and more again by the end').toBeGreaterThan(half);

    // Every listed moment is at or before the playhead, checked against the
    // plan rather than against the rendering.
    const late = await page.evaluate((d: number) => {
      const t = d * 0.5;
      return window.__gittimeline.events().filter((e) => e.impact <= t).length;
    }, duration);
    expect(late, 'the count matches the plan at that moment').toBe(half);
  });

  test('every line goes to its moment', async ({ page }) => {
    await load(page);
    const duration = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((d: number) => window.__gittimeline.seek(d), duration);
    await page.keyboard.press('e');

    const rows = page.getByTestId('events-list').locator('li button');
    await expect(rows.first()).toBeVisible();
    // Reading that something happened is half of it; going there is the other
    // half, and for a keyboard user it is the only way to reach a moment that
    // is not a landmark.
    const name = await rows.first().getAttribute('aria-label');
    expect(name, 'the time is part of the name, not decoration beside it').toMatch(/at \d/);
    expect(name).toMatch(/go there/i);

    await rows.nth(3).click();
    const after = await page.evaluate(() => window.__gittimeline.time);
    expect(after, 'the playhead moved off the end').toBeLessThan(duration);
    expect(after, 'and landed somewhere in the performance').toBeGreaterThanOrEqual(0);
  });

  test('offers the whole transcript, which the panel deliberately does not hold', async ({ page }) => {
    await load(page);
    await page.keyboard.press('e');
    const download = page.waitForEvent('download');
    await page.getByTestId('events-transcript').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/transcript/);
  });
});
