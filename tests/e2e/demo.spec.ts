import { expect, test } from '@playwright/test';
import { waitForReady, stageHash } from './helpers';

/**
 * The built-in demo is the minimum visual acceptance test: it must be an
 * unmistakably animated performance with travelling bodies, parallel
 * motion, staged merges and a directed camera — not a line reveal.
 */
test.describe('built-in demo performance', () => {
  test('landing shows one input, one action, and the demo performing behind it', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('url-input')).toBeVisible();
    await expect(page.getByTestId('play-button')).toBeVisible();
    await expect(page.getByText('Fetched from GitHub, rendered on your device', { exact: false }).first()).toBeVisible();
    await waitForReady(page);
    expect(await page.evaluate(() => window.__gitdance.mode)).toBe('landing');
    const a = await stageHash(page);
    await page.waitForTimeout(900);
    const b = await stageHash(page);
    expect(a).not.toBe(b); // the stage is alive behind the form
  });

  test('pressing Play launches a continuously animated performance with the full motion language', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
    await page.getByTestId('play-button').click();
    await page.waitForFunction(() => window.__gitdance.mode === 'player' && window.__gitdance.playing);
    expect(await page.evaluate(() => window.__gitdance.audioStarted)).toBe(true); // the score starts on the Play gesture
    const stats = await page.evaluate(() => window.__gitdance.stats);
    expect(stats!.maxConcurrentThreads).toBeGreaterThanOrEqual(3);

    // The compiled plan contains every required motion event.
    const types = await page.evaluate(() => [...new Set(window.__gitdance.events().map((e) => e.type))]);
    for (const t of ['REPO_BIRTH', 'COMMIT_STEP', 'DIVERGENCE', 'PARALLEL_PHRASE', 'CONTRIBUTOR_HANDOFF', 'MERGE_APPROACH', 'MAJOR_MERGE', 'QUIET_GAP', 'TAG_LANDMARK', 'ERA_TRANSITION', 'REPO_PRESENT']) expect(types.includes(t), t).toBe(true);

    // Bodies travel between nodes: sample a parallel phrase and see ≥2 performers on distinct threads moving.
    const phrase = await page.evaluate(() => window.__gitdance.events('PARALLEL_PHRASE').sort((a, b) => b.end - b.start - (a.end - a.start))[0]!);
    await page.evaluate(() => window.__gitdance.pause());
    await page.evaluate((t) => window.__gitdance.seek(t), (phrase.start + phrase.end) / 2);
    await page.waitForTimeout(100);
    const bodies1 = await page.evaluate(() => window.__gitdance.bodies());
    await page.evaluate(() => window.__gitdance.play());
    const threads1 = new Set(bodies1.filter((b) => b.body === 'performer').map((b) => b.thread));
    expect(threads1.size).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(160);
    const bodies2 = await page.evaluate(() => window.__gitdance.bodies());
    const threads2 = new Set(bodies2.filter((b) => b.body === 'performer').map((b) => b.thread));
    expect(threads2.size).toBeGreaterThanOrEqual(2); // still several performers on distinct threads
    const moved = bodies1.filter((b1) => {
      const b2 = bodies2.find((b) => b.edge === b1.edge);
      return b2 && Math.hypot(b2.x - b1.x, b2.y - b1.y) > 1;
    });
    expect(moved.length).toBeGreaterThanOrEqual(1); // and they physically travelled

    // Merge approach → impact → release: the camera pushes in around the hit and then settles.
    const merge = await page.evaluate(() => window.__gitdance.events('MAJOR_MERGE')[0]!);
    await page.evaluate(() => window.__gitdance.pause());
    const sampleAt = async (t: number) => {
      await page.evaluate((tt) => window.__gitdance.seek(tt), t);
      await page.waitForTimeout(60);
      return page.evaluate(() => ({ cam: window.__gitdance.camera!, bodies: window.__gitdance.bodies() }));
    };
    const before = await sampleAt(merge.impact - 1.2);
    expect(before.bodies.filter((b) => b.kind === 'merge' || b.kind === 'secondary').length).toBeGreaterThanOrEqual(1); // approach phase: a body is converging
    expect(['convergence', 'ensemble', 'overview', 'split']).toContain(before.cam.state);
    const atImpact = await sampleAt(merge.impact);
    expect(atImpact.cam.punch).toBeGreaterThan(before.cam.punch); // push-in at the hit
    expect(atImpact.cam.state).toBe('impact');
    let settled = false;
    for (let dt = 0.5; dt <= 4; dt += 0.25) {
      const s = await sampleAt(merge.impact + dt);
      if (s.cam.punch <= before.cam.punch + 0.005) {
        settled = true;
        break;
      }
    }
    expect(settled).toBe(true); // release: the camera settles again
    await page.evaluate(() => window.__gitdance.play());

    // The camera pulls back for a divergence.
    const split = await page.evaluate(() => window.__gitdance.events('DIVERGENCE')[0]!);
    await page.evaluate((t) => window.__gitdance.seek(t), split.impact);
    await page.waitForTimeout(80);
    const camSplit = await page.evaluate(() => window.__gitdance.camera);
    expect(camSplit!.punch).toBeLessThanOrEqual(1);

    // Frames keep changing while playing.
    await page.evaluate(() => window.__gitdance.seek(5));
    const h1 = await stageHash(page);
    await page.waitForTimeout(500);
    const h2 = await stageHash(page);
    expect(h1).not.toBe(h2);
    expect(await page.evaluate(() => window.__gitdance.time)).toBeGreaterThan(5.2);
  });

  test('pause freezes an inspectable state and resume continues without discontinuity', async ({ page }) => {
    await page.goto('/#demo=1&autoplay=1');
    await waitForReady(page);
    await page.waitForFunction(() => window.__gitdance.time > 6);
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    const t1 = await page.evaluate(() => window.__gitdance.time);
    const h1 = await stageHash(page);
    await page.waitForTimeout(600);
    const t2 = await page.evaluate(() => window.__gitdance.time);
    const h2 = await stageHash(page);
    expect(t2).toBe(t1);
    expect(h2).toBe(h1); // exact freeze — no side effects accumulate while paused
    await expect(page.getByTestId('transport-play')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    const t3 = await page.evaluate(() => window.__gitdance.time);
    expect(t3).toBeGreaterThan(t1 + 0.2);
    expect(t3).toBeLessThan(t1 + 1.5);
  });

  test('seeking is coherent via keyboard, landmarks and the timeline', async ({ page }) => {
    await page.goto('/#demo=1&autoplay=1');
    await waitForReady(page);
    await page.keyboard.press('Space'); // pause
    await page.evaluate(() => window.__gitdance.seek(10));
    await page.keyboard.press('ArrowRight');
    const afterStep = await page.evaluate(() => window.__gitdance.time);
    expect(afterStep).toBeGreaterThan(10);
    await page.keyboard.press('Shift+ArrowRight');
    const afterLandmark = await page.evaluate(() => window.__gitdance.time);
    expect(afterLandmark).toBeGreaterThan(afterStep);
    await page.keyboard.press('Home');
    expect(await page.evaluate(() => window.__gitdance.time)).toBe(0);
    const timeline = page.getByTestId('timeline');
    const box = (await timeline.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const mid = await page.evaluate(() => window.__gitdance.time);
    const dur = await page.evaluate(() => window.__gitdance.duration);
    expect(Math.abs(mid - dur / 2)).toBeLessThan(dur * 0.06);
    await expect(page.getByTestId('clock')).toContainText('/');
    // hovering shows the bucket tooltip with honest measures
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await expect(page.locator('.timeline .tip')).toContainText('commit');
  });

  test('mute, camera and reduced-motion shortcuts work and the same history is preserved', async ({ page }) => {
    await page.goto('/#demo=1&autoplay=1');
    await waitForReady(page);
    const hash = await page.evaluate(() => window.__gitdance.planHash);
    await page.keyboard.press('m');
    await expect(page.getByTestId('mute-button')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('m');
    await expect(page.getByTestId('mute-button')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('c');
    expect(await page.evaluate(() => window.__gitdance.manualCamera)).toBe(true);
    await page.keyboard.press('c');
    expect(await page.evaluate(() => window.__gitdance.manualCamera)).toBe(false);
    await page.keyboard.press('r');
    await expect(page.getByTestId('motion-button')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForFunction((h) => window.__gitdance.planHash !== h, hash);
    await waitForReady(page);
    const stats = await page.evaluate(() => window.__gitdance.stats);
    expect(stats!.commits).toBe(37);
    const cam = await page.evaluate(() => window.__gitdance.camera);
    expect(cam!.punch).toBe(1);
    // still animated in reduced motion (steady transitions), but calmer
    const a = await stageHash(page);
    await page.waitForTimeout(700);
    const b = await stageHash(page);
    expect(a).not.toBe(b);
    await page.keyboard.press('r');
  });

  test('panels: events stream, data truth, inspector via keyboard, share link', async ({ page }) => {
    await page.goto('/#demo=1&autoplay=1');
    await waitForReady(page);
    await page.keyboard.press('e');
    await expect(page.getByTestId('panel-events')).toBeVisible();
    await expect(page.getByTestId('event-list')).toContainText('peels away');
    await expect(page.getByTestId('event-list')).toContainText('merge');
    await page.keyboard.press('Escape');
    await page.keyboard.press('i');
    await expect(page.getByTestId('panel-data')).toContainText('exact');
    await expect(page.getByTestId('panel-data')).toContainText('Bright ivory path');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Space'); // pause so captions stop announcing
    await page.evaluate(() => window.__gitdance.seek(12));
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.sr-only[aria-live]')).toContainText('Thread');
    await page.getByTestId('share-button').click();
    await expect(page.getByTestId('share-link')).toContainText('demo=1');
    await expect(page.getByTestId('share-link')).toContainText('t=');
  });

  test('a share link restores the position and a fixture can be loaded from the hash', async ({ page }) => {
    await page.goto('/#demo=1&t=12.5&dur=90&seed=abc');
    await waitForReady(page);
    expect(Math.abs((await page.evaluate(() => window.__gitdance.time)) - 12.5)).toBeLessThan(0.11);
    expect(await page.evaluate(() => window.__gitdance.playing)).toBe(false);
    await page.goto('/#fixture=07-octopus-merge&autoplay=1');
    await page.reload();
    await waitForReady(page);
    const types = await page.evaluate(() => window.__gitdance.events('OCTOPUS_MERGE').length);
    expect(types).toBe(1);
  });
});
