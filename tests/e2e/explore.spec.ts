import { expect, test } from '@playwright/test';
import { waitForReady } from './helpers';

test.describe('travelling the finished picture', () => {
  test('a slider appears when the performance ends and pans without changing zoom', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    await expect(page.getByTestId('explore-bar')).toHaveCount(0);

    const dur = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((t) => window.__gittimeline.seek(t), dur);
    await expect(page.getByTestId('explore-bar')).toBeVisible();

    // Zoom in so there is something left to travel through.
    await page.evaluate(() => window.__gittimeline.zoom(2.6));
    await page.waitForTimeout(120);
    const zoomed = await page.evaluate(() => window.__gittimeline.viewport!.scale);

    const range = page.getByTestId('explore-range');
    await expect(range).toBeEnabled();
    await range.fill('40');
    await page.waitForTimeout(120);
    const left = await page.evaluate(() => window.__gittimeline.viewport!);
    await range.fill('930');
    await page.waitForTimeout(120);
    const right = await page.evaluate(() => window.__gittimeline.viewport!);

    expect(right.cx).toBeGreaterThan(left.cx);
    // The whole point: the magnification is untouched by travelling.
    expect(right.scale).toBeCloseTo(zoomed, 5);
    expect(left.scale).toBeCloseTo(zoomed, 5);
  });

  test('the slider is keyboard operable and reports where it is', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    const dur = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((t) => window.__gittimeline.seek(t), dur);
    await page.evaluate(() => window.__gittimeline.zoom(3));
    await page.waitForTimeout(120);

    const range = page.getByTestId('explore-range');
    await expect(range).toHaveAttribute('aria-label', /zoom/i);
    await range.focus();
    const before = await page.evaluate(() => window.__gittimeline.viewport!.cx);
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => window.__gittimeline.viewport!.cx)).toBeGreaterThan(before);
    await expect(page.getByTestId('explore-at')).not.toBeEmpty();
  });

  test('it disappears again once the performance is playing', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    const dur = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((t) => window.__gittimeline.seek(t), dur);
    await expect(page.getByTestId('explore-bar')).toBeVisible();
    await page.evaluate(() => window.__gittimeline.seek(1));
    await expect(page.getByTestId('explore-bar')).toHaveCount(0);
  });
});
