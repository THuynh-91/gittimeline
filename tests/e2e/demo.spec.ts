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
    expect(await page.evaluate(() => window.__gitdance.audioStarted)).toBe(true); // the score starts with the performance
    const stats = await page.evaluate(() => window.__gitdance.stats);
    expect(stats!.maxConcurrentThreads).toBeGreaterThanOrEqual(3);

    // The compiled plan contains every required motion event.
    const types = await page.evaluate(() => [...new Set(window.__gitdance.events().map((e) => e.type))]);
    for (const t of ['REPO_BIRTH', 'COMMIT_STEP', 'DIVERGENCE', 'PARALLEL_PHRASE', 'CONTRIBUTOR_HANDOFF', 'MERGE_APPROACH', 'MAJOR_MERGE', 'QUIET_GAP', 'TAG_LANDMARK', 'ERA_TRANSITION', 'REPO_PRESENT']) expect(types.includes(t), t).toBe(true);

    // Bodies travel between nodes: sample a parallel phrase and see ≥2 performers on distinct threads moving.
    const phrase = await page.evaluate(() => window.__gitdance.events('PARALLEL_PHRASE').sort((a, b) => b.end - b.start - (a.end - a.start))[0]!);
    await page.evaluate(() => window.__gitdance.pause());
    // Scan the phrase: performers dwell briefly at each node, so sample across it
    // rather than at a single instant.
    let best: Array<{ edge: number; body: string; thread: number; x: number; y: number }> = [];
    let bestAt = phrase.start;
    for (let k = 0; k <= 12; k++) {
      const t = phrase.start + ((phrase.end - phrase.start) * k) / 12;
      await page.evaluate((tt) => window.__gitdance.seek(tt), t);
      const bodies = await page.evaluate(() => window.__gitdance.bodies());
      const threads = new Set(bodies.filter((b) => b.body === 'performer').map((b) => b.thread));
      if (threads.size > new Set(best.filter((b) => b.body === 'performer').map((b) => b.thread)).size) {
        best = bodies;
        bestAt = t;
      }
    }
    expect(new Set(best.filter((b) => b.body === 'performer').map((b) => b.thread)).size).toBeGreaterThanOrEqual(2);

    // ...and those performers physically travel while time advances.
    await page.evaluate((tt) => window.__gitdance.seek(tt), bestAt);
    const posA = await page.evaluate(() => window.__gitdance.bodies());
    await page.evaluate((tt) => window.__gitdance.seek(tt), bestAt + 0.12);
    const posB = await page.evaluate(() => window.__gitdance.bodies());
    const moved = posA.filter((b1) => {
      const b2 = posB.find((b) => b.edge === b1.edge);
      return b2 && Math.hypot(b2.x - b1.x, b2.y - b1.y) > 0.5;
    });
    expect(moved.length).toBeGreaterThanOrEqual(2);
    await page.evaluate(() => window.__gitdance.play());

    // Merge approach → impact → release: the camera pushes in around the hit and then settles.
    const merge = await page.evaluate(() => window.__gitdance.events('MAJOR_MERGE')[0]!);
    await page.evaluate(() => window.__gitdance.pause());
    const sampleAt = async (t: number) => {
      await page.evaluate((tt) => window.__gitdance.seek(tt), t);
      await page.waitForTimeout(60);
      return page.evaluate(() => ({ cam: window.__gitdance.camera!, bodies: window.__gitdance.bodies() }));
    };
    // Approach: somewhere in the run-up, a body is physically travelling along
    // the merge edge toward the destination.
    let before = await sampleAt(merge.impact - 0.6);
    let approaching = 0;
    for (let dt = 1.6; dt >= 0.1; dt -= 0.1) {
      const s = await sampleAt(merge.impact - dt);
      const n = s.bodies.filter((b) => b.kind === 'merge').length;
      if (n > approaching) {
        approaching = n;
        before = s;
      }
    }
    expect(approaching).toBeGreaterThanOrEqual(1);
    expect(before.cam.state).not.toBe('release');
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

  test('sound and camera shortcuts work and the history is preserved', async ({ page }) => {
    await page.goto('/#demo=1&autoplay=1');
    await waitForReady(page);
    const hash = await page.evaluate(() => window.__gitdance.planHash);
    await expect(page.getByTestId('mute-button')).toHaveAttribute('aria-pressed', 'true'); // the score plays by default
    expect(await page.evaluate(() => window.__gitdance.audioStarted)).toBe(true);
    await page.keyboard.press('m');
    await expect(page.getByTestId('mute-button')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('m');
    await expect(page.getByTestId('mute-button')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('c');
    expect(await page.evaluate(() => window.__gitdance.manualCamera)).toBe(true);
    await page.keyboard.press('c');
    expect(await page.evaluate(() => window.__gitdance.manualCamera)).toBe(false);
    expect(await page.evaluate(() => window.__gitdance.zoomLocked)).toBe(true); // keeps the zoom the viewer chose
    await page.keyboard.press('c');
    expect(await page.evaluate(() => window.__gitdance.zoomLocked)).toBe(false);
    void hash;
    const stats = await page.evaluate(() => window.__gitdance.stats);
    expect(stats!.commits).toBe(56);
    // The stage keeps changing frame to frame.
    const a = await stageHash(page);
    await page.waitForTimeout(700);
    const b = await stageHash(page);
    expect(a).not.toBe(b);
  });

  test('the commit ledger, help panel and thread selection explain the performance', async ({ page }) => {
    await page.goto('/#demo=1&autoplay=1');
    await waitForReady(page);
    // The ledger prints commits as they land, and docks to the top by default.
    await expect(page.getByTestId('commit-rail')).toHaveClass(/dock-top/);
    await expect(page.getByTestId('commit-rail')).toContainText('Initial commit');
    // Help carries the coverage truth and the legend.
    await page.getByTestId('help-button').click();
    await expect(page.getByTestId('panel-help')).toContainText('exact');
    await expect(page.getByTestId('panel-help')).toContainText('Straight ivory line');
    await expect(page.getByTestId('panel-help')).toContainText('Contributors');
    await page.keyboard.press('Escape');
    // Threads can be walked from the keyboard and are announced.
    await page.keyboard.press('Space');
    await page.evaluate(() => window.__gitdance.seek(12));
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.sr-only[aria-live]')).toContainText('Thread');
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
