import { expect, test } from '@playwright/test';
import { waitForReady, stageHash } from './helpers';

test.describe('fallbacks, accessibility and layouts', () => {
  test('poster renderer shows exact topology and a navigable event list', async ({ page }) => {
    await page.goto('/#demo=1&renderer=poster&t=20');
    await waitForReady(page);
    await expect(page.getByTestId('poster')).toBeVisible();
    await expect(page.getByTestId('poster')).toContainText('Static poster mode');
    const paths = await page.locator('[data-testid="poster"] svg path').count();
    expect(paths).toBeGreaterThan(10);
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => window.__gittimeline.time)).toBeGreaterThan(20);
    await expect(page.locator('.banner')).toContainText('Canvas rendering is unavailable');
  });

  test('reduced motion and no-flash keep meaning with calmer transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#demo=1&autoplay=1');
    await waitForReady(page);
    // The operating system preference is honoured without any control to find.
    const cam = await page.evaluate(() => window.__gittimeline.camera);
    expect(cam!.punch).toBe(1);
    const types = await page.evaluate(() => [...new Set(window.__gittimeline.events().map((e) => e.type))]);
    expect(types).toContain('MAJOR_MERGE');
    expect(types).toContain('DIVERGENCE');
    await page.getByTestId('settings-button').click();
    await page.getByTestId('no-flash-toggle').click();
    await expect(page.getByTestId('no-flash-toggle')).toHaveAttribute('aria-checked', 'true');
    await page.evaluate(() => window.__gittimeline.seek(5));
    await page.waitForTimeout(100);
    const a = await stageHash(page);
    await page.waitForTimeout(600);
    expect(await stageHash(page)).not.toBe(a);
  });

  test('keyboard-only operation: every control is reachable and labelled', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    const labels: string[] = [];
    for (let i = 0; i < 22; i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName : '';
      });
      labels.push(label);
    }
    expect(labels.filter(Boolean).length).toBeGreaterThan(10);
    expect(labels.some((l) => /Play|Pause/.test(l))).toBe(true);
    expect(labels.some((l) => /timeline/i.test(l))).toBe(true);
    // Every button has an accessible name.
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => !(b.getAttribute('aria-label') || b.textContent?.trim())).length);
    expect(unnamed).toBe(0);
    // The stage has an accessible summary and a live region exists.
    await expect(page.getByTestId('stage-canvas')).toHaveAttribute('aria-label', /commits/);
    expect(await page.locator('[aria-live="polite"]').count()).toBeGreaterThanOrEqual(1);
  });

  test('mobile layout keeps the stage, timeline and controls usable without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto('/#demo=1&autoplay=1');
    await waitForReady(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByTestId('transport-play')).toBeVisible();
    await expect(page.getByTestId('timeline')).toBeVisible();
    const box = (await page.getByTestId('timeline').boundingBox())!;
    expect(box.width).toBeGreaterThan(300);
    await page.getByTestId('settings-button').click();
    await expect(page.getByTestId('panel-settings')).toBeVisible();
  });

  test('ultrawide layout and the final tableau', async ({ page }) => {
    await page.setViewportSize({ width: 2400, height: 700 });
    await page.goto('/#demo=1');
    await waitForReady(page);
    const dur = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((t) => window.__gittimeline.seek(t), dur - 0.2);
    await page.waitForTimeout(150);
    const cam = await page.evaluate(() => window.__gittimeline.camera);
    expect(cam!.state).toBe('tableau');
    await expect(page.getByTestId('caption')).toContainText('Present day');

    // And it is actually the whole picture, not merely labelled one.
    //
    // Reaching the state was the whole of this check, and the state was the
    // one part that worked: `camera.ts` writes the tail's frame from the
    // plan's bounds and the next few lines clamp it to `MAX_FRAME_W`, 2,600
    // world units, so the closing shot of a 15,936-unit demo was sixteen per
    // cent of it and the closing shot of mdBook was four. A test that asks
    // only for the name of the shot cannot tell those apart from the real
    // thing, which is why this went unnoticed through every run of this file.
    const shot = await page.evaluate(() => {
      const v = window.__gittimeline.view!;
      return { worldW: v.worldW, span: (v.geomMaxX ?? 0) - (v.geomMinX ?? 0) };
    });
    expect(shot.span, 'the demo has width to frame').toBeGreaterThan(1000);
    expect(shot.worldW / shot.span, 'the closing tableau frames the whole history').toBeGreaterThan(0.95);
  });

  test('gallery mode hides the chrome and loops', async ({ page }) => {
    await page.goto('/#demo=1&gallery=1');
    await waitForReady(page);
    await expect(page.locator('.app')).toHaveClass(/chrome-hidden/);
    expect(await page.evaluate(() => window.__gittimeline.playing)).toBe(true);
  });

  test('no console errors during a full run', async ({ page }, testInfo) => {
    // Long enough for an engine that composites in software.
    //
    // This waits for a thirty-second performance to finish, so it needs thirty
    // seconds of wall clock plus however far the engine is from real time —
    // and `dt` in the frame loop is clamped at 0.1s, so an engine under ten
    // frames a second advances the performance clock slower than the wall
    // clock and the show takes proportionally longer. Measured here at 1280x720,
    // deviceScaleFactor 2, after the renderer steps its resolution down:
    //
    //     chromium  60.1 fps  1.00x     webkit  5.5 fps  0.55x     firefox  15.3 fps  0.98x
    //
    // Chromium is given a GPU through ANGLE; the other two rasterise and
    // composite on the CPU in this harness, which a browser on a real machine
    // does not. So 0.55x is a fact about headless WebKit on a build server,
    // not about Safari — but it is a fact this test has to survive, and at the
    // default sixty seconds it did not: the run needed about fifty-five plus
    // load and timed out a few seconds short.
    //
    // The assertion is unchanged. What is under test is that a whole
    // performance plays without putting an error in the console, and that is
    // worth waiting for on the two engines whose console nothing else here
    // ever reads.
    if (testInfo.project.name !== 'chromium') testInfo.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/#demo=1&autoplay=1&dur=30');
    await waitForReady(page);
    await page.waitForFunction(() => !window.__gittimeline.playing && window.__gittimeline.time > 5, null, { timeout: 150_000 });
    expect(errors).toEqual([]);
  });

  test('the stage can be cleared, and the controls that clear it stay reachable', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    // The ledger prints commits as they land, so there has to be something in
    // it before it exists at all.
    await page.evaluate(() => window.__gittimeline.seek(12));
    await expect(page.getByTestId('commit-rail')).toBeVisible();
    await expect(page.locator('.band')).toBeVisible();

    // These two live at the bottom of a screen whose bottom 150px is the
    // transport band. Sitting inside it made them unclickable.
    await page.getByTestId('toggle-rail').click();
    await expect(page.getByTestId('commit-rail')).toHaveCount(0);

    await page.getByTestId('toggle-controls').click();
    await expect(page.getByTestId('timeline')).toHaveCount(0);
    await expect(page.getByTestId('transport-play')).toHaveCount(0);

    // But not your place in the history: the date says where you are, and the
    // travel slider is the only way to move once the performance is over.
    await expect(page.getByTestId('date-hero')).toBeVisible();

    // A control that hides itself along with what it hides is a trap.
    await expect(page.getByTestId('view-toggles')).toBeVisible();
    await page.getByTestId('toggle-controls').click();
    await expect(page.getByTestId('timeline')).toBeVisible();
  });

  test('music volume is reachable, and survives the controls being hidden', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    await expect(page.getByTestId('volume')).toBeVisible();

    const level = () => page.evaluate(() => JSON.parse(localStorage.getItem('gittimeline.settings.v1') ?? '{}'));
    await page.getByTestId('volume-range').fill('30');
    await expect.poll(async () => (await level()).effectsLevel).toBeCloseTo(0.3, 2);

    // Dragging to zero mutes, and the mute button restores the level you were
    // at rather than costing you the setting.
    await page.getByTestId('volume-range').fill('0');
    await expect.poll(async () => (await level()).muted).toBe(true);
    await page.getByTestId('volume-mute').click();
    await expect.poll(async () => (await level()).muted).toBe(false);
    await expect.poll(async () => (await level()).effectsLevel).toBeCloseTo(0.3, 2);

    // It lives with the view toggles because someone watching with the
    // transport cleared still needs to turn the music down.
    await page.getByTestId('toggle-controls').click();
    await expect(page.getByTestId('timeline')).toHaveCount(0);
    await expect(page.getByTestId('volume')).toBeVisible();
  });
});
