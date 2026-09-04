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
    expect(await page.evaluate(() => window.__gitdance.time)).toBeGreaterThan(20);
    await expect(page.locator('.banner')).toContainText('Canvas rendering is unavailable');
  });

  test('reduced motion and no-flash keep meaning with calmer transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#demo=1&autoplay=1');
    await waitForReady(page);
    // The operating system preference is honoured without any control to find.
    const cam = await page.evaluate(() => window.__gitdance.camera);
    expect(cam!.punch).toBe(1);
    const types = await page.evaluate(() => [...new Set(window.__gitdance.events().map((e) => e.type))]);
    expect(types).toContain('MAJOR_MERGE');
    expect(types).toContain('DIVERGENCE');
    await page.getByTestId('settings-button').click();
    await page.getByTestId('no-flash-toggle').click();
    await expect(page.getByTestId('no-flash-toggle')).toHaveAttribute('aria-checked', 'true');
    await page.evaluate(() => window.__gitdance.seek(5));
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
    const dur = await page.evaluate(() => window.__gitdance.duration);
    await page.evaluate((t) => window.__gitdance.seek(t), dur - 0.2);
    await page.waitForTimeout(150);
    const cam = await page.evaluate(() => window.__gitdance.camera);
    expect(cam!.state).toBe('tableau');
    await expect(page.getByTestId('caption')).toContainText('Present day');
  });

  test('gallery mode hides the chrome and loops', async ({ page }) => {
    await page.goto('/#demo=1&gallery=1');
    await waitForReady(page);
    await expect(page.locator('.app')).toHaveClass(/chrome-hidden/);
    expect(await page.evaluate(() => window.__gitdance.playing)).toBe(true);
  });

  test('no console errors during a full run', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/#demo=1&autoplay=1&dur=30');
    await waitForReady(page);
    await page.waitForFunction(() => !window.__gitdance.playing && window.__gitdance.time > 5, null, { timeout: 60_000 });
    expect(errors).toEqual([]);
  });
});
