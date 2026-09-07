import { expect, test } from './muted';
import { waitForReady } from './helpers';

/**
 * The two things only a clock axis can answer.
 *
 * Every other Git tool is topological: main is the trunk by construction, so
 * "how much was happening at once" has no *now* to be asked about, and the gap
 * between two commits is not a quantity it holds. Here x is the clock, so both
 * are readings rather than calculations — and both were already drawn on the
 * stage and never once stated. See `PROPOSAL-mainline.md`.
 */
test.describe('what the time axis knows', () => {
  test('says how many branches are open, and it changes as the show runs', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.loadFixture('05-long-running-side-thread'));
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.pause());

    const duration = await page.evaluate(() => window.__gittimeline.duration);
    const readAt = async (f: number) => {
      await page.evaluate((t: number) => window.__gittimeline.seek(t), duration * f);
      const el = page.getByTestId('open-threads');
      if ((await el.count()) === 0) return 0;
      const text = (await el.textContent()) ?? '';
      return Number(text.match(/\d+/)?.[0] ?? 0);
    };

    // A fixture built around one thread that runs beside main for a long time,
    // so the count has to be more than one somewhere in the middle and cannot
    // be more than the plan's own peak anywhere.
    const counts = [await readAt(0.05), await readAt(0.3), await readAt(0.5), await readAt(0.7), await readAt(0.95)];
    const peak = await page.evaluate(() => window.__gittimeline.stats!.maxConcurrentThreads);
    expect(Math.max(...counts), 'more than one thread is open at some point').toBeGreaterThan(1);
    expect(Math.max(...counts), 'and never more than the plan says ever were').toBeLessThanOrEqual(peak);
    expect(new Set(counts).size, 'the number is a reading, not a constant').toBeGreaterThan(1);

    // Grammar, because a bare plural on "1" is the kind of thing nobody fixes.
    const one = counts.indexOf(1);
    if (one >= 0) {
      await readAt([0.05, 0.3, 0.5, 0.7, 0.95][one]!);
      await expect(page.getByTestId('open-threads')).toContainText(/\b1 branch open/);
    }
  });

  test('says how long a branch was open, on the thread it belongs to', async ({ page }) => {
    /**
     * Already drawn and never quantified: the distance between a thread's
     * start and its end *is* its lifetime, because x is the clock. A
     * topological tool knows the order of the commits and not the gap between
     * them, so this is not a sentence it can produce.
     */
    await page.goto('/');
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.loadFixture('05-long-running-side-thread'));
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.pause());
    const duration = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((d: number) => window.__gittimeline.seek(d), duration);

    // Through the rail, the way a viewer reaches a commit: it seeks to it and
    // selects it, which opens the inspector.
    const rail = page.getByTestId('commit-rail');
    await expect(rail).toBeVisible();
    await rail.locator('.rail-item').first().click();
    const panel = page.getByTestId('panel-inspector');
    await expect(panel).toBeVisible();

    // The thread row carries it, so it reads as a fact about that thread
    // rather than as a separate row of its own. By test id, because the
    // contributor row is also a `dd` holding a pill and comes first.
    const row = panel.getByTestId('thread-row');
    await expect(row).toContainText(/open (the same day|and merged the same day|\d)/i);

    // A whole fixture is held whole, so every thread's lifetime is knowable.
    // The claim is refused rather than approximated on a streamed entry where
    // an end falls outside the loaded pages, which is asserted at unit level
    // in `threadLifetime`; here what matters is that the sentence appears at
    // all and is not "0 days".
    await expect(row).not.toContainText('open 0 days');
  });
});
