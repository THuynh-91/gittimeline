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

    /**
     * Checked against the plan rather than against the rendering — but as a
     * relationship, not an equality.
     *
     * This asserted `rows === events().filter(impact <= t).length`, which was
     * true while the panel listed every event unconditionally and became false
     * the moment it started hiding texture by default. Duplicating the list of
     * hidden types here would put the definition of "significant" in two
     * places, which is exactly what sharing `TEXTURE_EVENTS` with the
     * transcript was meant to avoid. So: never more than the plan holds at
     * that moment, and exactly as many once the switch is on.
     */
    await page.evaluate((d: number) => window.__gittimeline.seek(d * 0.5), duration);
    const inPlan = await page.evaluate((d: number) => {
      const t = d * 0.5;
      return window.__gittimeline.events().filter((e) => e.impact <= t).length;
    }, duration);
    expect(half, 'never more than the plan holds by then').toBeLessThanOrEqual(inPlan);

    await page.getByTestId('events-every').check();
    const everything = await page.getByTestId('events-list').locator('li').count();
    expect(everything, 'and exactly as many with every commit shown').toBe(inPlan);
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

  test('shows the news by default and every commit on request, and marks where the show is', async ({ page }) => {
    /**
     * `accessibility.md` has described both of these since before the panel
     * existed — "the current event marked `aria-current`" and "a 'show every
     * commit' switch expands it to all steps" — and the first version of the
     * panel had neither. It listed everything unconditionally, which on a
     * thousand-node plan buries the divergences and the merges among a
     * thousand entries of "somebody committed something".
     */
    await load(page);
    const duration = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((d: number) => window.__gittimeline.seek(d), duration);
    await page.keyboard.press('e');
    const list = page.getByTestId('events-list');
    await expect(list.locator('li').first()).toBeVisible();

    const news = await list.locator('li').count();
    const every = await page.evaluate(() => window.__gittimeline.events().length);
    expect(news, 'the default is not simply everything').toBeLessThan(every);

    // The most recent thing is where the performance has got to, for anybody
    // who cannot see the playhead.
    await expect(list.locator('[aria-current="true"]'), 'exactly one entry is current').toHaveCount(1);
    await expect(list.locator('li').first().locator('button')).toHaveAttribute('aria-current', 'true');

    await page.getByTestId('events-every').check();
    const all = await list.locator('li').count();
    expect(all, 'the switch expands it').toBeGreaterThan(news);
    await expect(list.locator('[aria-current="true"]'), 'and the current entry survives it').toHaveCount(1);
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
