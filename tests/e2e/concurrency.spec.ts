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
      // Absent means one or none: the readout is gated above one, so its
      // absence is a reading rather than a failure to find it.
      if ((await el.count()) === 0) return 1;
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

    // And it stays quiet when it would only say that main exists.
    //
    // "1 branch open" is a readout announcing the obvious, and one is the
    // value it takes for most of a linear stretch. The scrubber tooltip
    // already had this rule — it mentions concurrency only above one — so
    // the chrome agrees with it now.
    const quiet = counts.indexOf(1);
    if (quiet >= 0) {
      await readAt([0.05, 0.3, 0.5, 0.7, 0.95][quiet]!);
      await expect(page.getByTestId('open-threads'), 'one open branch is not news').toHaveCount(0);
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

test.describe('a caption nobody can read', () => {
  /**
   * The date can jump years in one frame, and the app has always had the
   * sentence that explains it — `QUIET_GAP`, "Quiet span of 11.4 years
   * passes". It was never seen.
   *
   * Two reasons, both fixed. A caption's dwell was however much *runtime* the
   * plan gave the thing it describes, and runtime is paid per visible arrival,
   * so a stretch with nothing left after aggregation gets almost none — Node
   * crosses eleven years in 0.077 performance-seconds. And the caption walk
   * consumed every event up to the clock in one pass and kept only the last,
   * so the interesting one was created and discarded in the same tick.
   */
  test('a gap notice survives the frame it was created in', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
    // `11-dense-linear-burst` is the one fixture in the corpus that carries a
    // `QUIET_GAP` — checked across ten of them and the demo, which have none,
    // because a gap needs more than three weeks between consecutive commits
    // and most fixtures are written tight.
    await page.evaluate(() => window.__gittimeline.loadFixture('11-dense-linear-burst'));
    await waitForReady(page);

    const gaps = await page.evaluate(() => window.__gittimeline.events('QUIET_GAP'));
    test.skip(gaps.length === 0, 'this fixture has no quiet span to cross');

    // Land the clock a hair past the gap in one jump — which is exactly what a
    // slow frame does, and what used to lose the caption.
    const target = gaps[0]!.impact;
    await page.evaluate((t: number) => {
      window.__gittimeline.pause();
      window.__gittimeline.seek(t + 0.01);
    }, target);

    await expect(page.getByTestId('caption'), 'the sentence explaining the jump is on screen').toContainText(/quiet span of/i);

    // And it stays long enough to read. Anything less salient must not take
    // the line out from under it.
    await page.waitForTimeout(600);
    await expect(page.getByTestId('caption')).toContainText(/quiet span of/i);
  });

  /**
   * ...but it does not keep the line for the rest of the show.
   *
   * The fix above gave the explaining captions an unconditional override plus
   * a `holdsFloor` flag that stopped anything later in the same walk taking the
   * line back. Within one frame's batch that is right. Across a seek the walk
   * consumes every event up to the clock in one pass, so on the face of it the
   * last quiet span in a history could outrank everything after it.
   *
   * Stated as a property rather than as a regression: this was checked against
   * `751b7de`, the commit that introduced the flag, and **passed there too**,
   * so no version of the app is known to have failed it. It is here because
   * the rule is worth holding — a caption describes what just happened, and a
   * gap from the middle of a history is not that — and because `captionRank`
   * now decides it by ranking rather than by a flag, which is a thing that can
   * be got wrong again.
   */
  test('a gap notice does not outrank everything that follows it', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.loadFixture('11-dense-linear-burst'));
    await waitForReady(page);
    const gaps = await page.evaluate(() => window.__gittimeline.events('QUIET_GAP'));
    test.skip(gaps.length === 0, 'this fixture has no quiet span to cross');

    await page.evaluate((t: number) => {
      window.__gittimeline.pause();
      window.__gittimeline.seek(t + 0.01);
    }, gaps[0]!.impact);
    await expect(page.getByTestId('caption')).toContainText(/quiet span of/i);

    // Back to the start and then to the end in one jump, which is the walk
    // that matters: the pointer resets only on a *backward* seek, so this is
    // the one pass that holds the gap and everything after it together. That
    // is where the override used to win — the gap took the line, the flag
    // stopped anything later taking it back, and the closing sentence lost to
    // a quiet span from the middle of the history.
    await page.evaluate(() => window.__gittimeline.seek(0));
    // A frame has to run in between, or the pointer never rewinds: it is reset
    // inside the caption walk from the clock it is called with, and two seeks
    // back to back are two clocks with no walk between them.
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__gittimeline.seek(window.__gittimeline.duration - 0.2));
    await expect(page.getByTestId('caption'), 'the show has moved on from the gap').not.toContainText(/quiet span of/i);
  });

  /**
   * The plan's last word gets the line.
   *
   * `REPO_PRESENT` — "Present day · N live tips" — is the final event in every
   * plan, and it won by position while the walk kept whichever event it ended
   * on. Ranking the walk by salience took that away without noticing: on the
   * demo it sits at impact 67.11 with a `MAJOR_MERGE` at 66.81 above it on
   * salience, so the closing shot was captioned with a merge three seconds
   * earlier and the closing sentence never appeared at all. Caught by the
   * ultrawide tableau test in `fallback.spec.ts`, which asks for it in passing;
   * this asks for it on purpose, and at the two ways of arriving at the end.
   */
  test('the closing sentence is not in competition', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    const dur = await page.evaluate(() => window.__gittimeline.duration);

    // Arrived at by a seek, which covers the whole history in one walk.
    await page.evaluate((t: number) => {
      window.__gittimeline.pause();
      window.__gittimeline.seek(t);
    }, dur - 0.2);
    await expect(page.getByTestId('caption')).toContainText('Present day');

    // And arrived at by playing into it from just before, where the six events
    // that land at impact 66.81 are crossed a frame or two earlier and one of
    // them outranks it on salience.
    await page.evaluate((t: number) => {
      window.__gittimeline.seek(t);
      window.__gittimeline.play();
    }, dur - 2.4);
    await expect(page.getByTestId('caption')).toContainText('Present day', { timeout: 15000 });
  });
});
