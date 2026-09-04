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

  test('the view cannot travel past the beginning or the end', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    const dur = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((t) => window.__gittimeline.seek(t), dur);
    await page.evaluate(() => window.__gittimeline.zoom(3));
    await page.waitForTimeout(120);

    const bounds = await page.evaluate(() => {
      const xs = window.__gittimeline.nodeX!;
      return { min: Math.min(...xs), max: Math.max(...xs) };
    });
    const range = page.getByTestId('explore-range');

    await range.fill('0');
    await page.waitForTimeout(120);
    const atStart = await page.evaluate(() => window.__gittimeline.viewport!);
    // The left edge of what you can see sits at the start of the history, not
    // in blank space before it.
    expect(atStart.cx - atStart.worldW / 2).toBeLessThanOrEqual(bounds.min + 1);
    expect(atStart.cx - atStart.worldW / 2).toBeGreaterThan(bounds.min - bounds.max);

    await range.fill('1000');
    await page.waitForTimeout(120);
    const atEnd = await page.evaluate(() => window.__gittimeline.viewport!);
    expect(atEnd.cx + atEnd.worldW / 2).toBeGreaterThanOrEqual(bounds.max - 1);
  });

  test('the follow button is gone once there is nothing left to follow', async ({ page }) => {
    await page.goto('/#demo=1&autoplay=1');
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.zoom(2));
    await expect(page.getByTestId('follow-button')).toBeVisible();
    const dur = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((t) => window.__gittimeline.seek(t), dur);
    await page.evaluate(() => window.__gittimeline.pause());
    await expect(page.getByTestId('follow-button')).toHaveCount(0);
    await expect(page.getByTestId('explore-bar')).toBeVisible();
  });

  test('playing again starts at the beginning and hands the camera back', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    const dur = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((t) => window.__gittimeline.seek(t), dur);
    await page.evaluate(() => window.__gittimeline.zoom(3));
    await page.getByTestId('explore-range').fill('900');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__gittimeline.manualCamera)).toBe(true);

    await page.getByTestId('transport-play').click();
    await page.waitForTimeout(200);
    // Back to the top, and back to the director: replaying the whole history
    // parked in a corner under manual control would show nothing at all.
    expect(await page.evaluate(() => window.__gittimeline.time)).toBeLessThan(2);
    expect(await page.evaluate(() => window.__gittimeline.manualCamera)).toBe(false);
  });

  test('leaving the landing page starts the performance, not joins it', async ({ page }) => {
    await page.goto('/');
    // The demo plays quietly behind the form; let it get well underway.
    await page.waitForTimeout(2500);
    await page.getByRole('link', { name: 'How it works' }).click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__gittimeline.mode)).toBe('player');
    expect(await page.evaluate(() => window.__gittimeline.time)).toBeLessThan(1.5);
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

  test('a newly loaded history is framed from its own beginning', async ({ page }) => {
    /**
     * Manual framing outlives whatever it was framing. Zooming into one corner
     * of a finished history and then loading a different repository played the
     * new performance entirely off-screen: it started at the beginning, but
     * the beginning was not where the camera was pointing.
     */
    await page.goto('/#demo=1');
    await waitForReady(page);
    const dur = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((t) => window.__gittimeline.seek(t), dur);
    await page.evaluate(() => window.__gittimeline.zoom(3.5));
    await page.getByTestId('explore-range').fill('950');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__gittimeline.manualCamera)).toBe(true);
    const parked = await page.evaluate(() => window.__gittimeline.viewport!.cx);

    await page.evaluate(() => window.__gittimeline.loadFixture('05-long-running-side-thread'));
    await page.waitForFunction(() => window.__gittimeline.stats && window.__gittimeline.stats.commits === 14, { timeout: 30000 });
    await page.waitForTimeout(300);

    expect(await page.evaluate(() => window.__gittimeline.manualCamera), 'the director has the camera back').toBe(false);
    expect(await page.evaluate(() => window.__gittimeline.time), 'and it starts at the start').toBeLessThan(2);
    expect(await page.evaluate(() => window.__gittimeline.viewport!.cx)).not.toBeCloseTo(parked, 0);
  });

  test('returning to the landing page leaves something moving behind it', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    await page.getByTestId('catalog-back').click();
    await page.getByTestId('url-input').waitFor();
    await page.waitForTimeout(600);
    // Not a frozen still of a finished performance, which is what returning
     // used to leave on the stage.
    expect(await page.evaluate(() => window.__gittimeline.playing)).toBe(true);
    expect(await page.evaluate(() => window.__gittimeline.time)).toBeGreaterThan(0);
  });
});
