import { expect, test } from './muted';
import type { Page } from '@playwright/test';
import { routeGitHub, shelfPresent, waitForReady } from './helpers';
import { bigRepo } from '../fixtures/mock-github';

/**
 * A small window and a zoomed window are the same width.
 *
 * That is the point these tests exist to hold on to. 1280x800 at 200% browser
 * zoom is 640x400 CSS pixels, so every rule written for a phone also fires on
 * a desktop where there is no shortage of screen at all — and two things were
 * being hidden on that basis which should not have been.
 */
test.describe('a narrow window', () => {
  test('the scope dialog can be read and closed at 320x568', async ({ page }) => {
    /**
     * `.prelude` centred its card with `justify-content: center` and no
     * scrolling. A card taller than the window is then centred *as overflow*:
     * the title goes above the top edge, the Close button below the bottom,
     * and a flex container's scrollable region does not extend past its start
     * edge — so neither can be reached, and scrolling does not help. A dialog
     * that cannot be closed by its own button is not a dialog.
     */
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/#selection');
    if (!(await shelfPresent(page))) test.skip(true, 'the shelf is unreachable from here');

    // Any card asks the scope question; the cheapest is the quickest to reach.
    const cheapest = await page.evaluate(async () => {
      const res = await fetch(window.__gittimeline.catalogUrl('index.json'));
      const list = ((await res.json()) as { entries: Array<{ slug: string; bytes: number }> }).entries;
      return list.reduce((a, b) => (b.bytes < a.bytes ? b : a)).slug;
    });
    await page.getByTestId(`catalog-${cheapest.replace('/', '-')}`).click();

    const dialog = page.getByTestId('scope-chooser');
    await expect(dialog).toBeVisible({ timeout: 30_000 });

    const size = page.viewportSize()!;
    for (const testId of ['scope-full', 'scope-cancel']) {
      const el = page.getByTestId(testId);
      await expect(el).toBeVisible();
      // Inside the window *after* being scrolled to, which is the whole
      // question — the failure was that scrolling did not help.
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox();
      expect(box, `${testId} has a box`).not.toBeNull();
      expect(box!.y, `${testId} is not above the window`).toBeGreaterThanOrEqual(-1);
      expect(box!.y + box!.height, `${testId} is not below the window`).toBeLessThanOrEqual(size.height + 1);
      expect(box!.x, `${testId} is not off the left`).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width, `${testId} is not off the right`).toBeLessThanOrEqual(size.width + 1);
    }

    // And the button does what it says, from where it is.
    await page.getByTestId('scope-cancel').click();
    await expect(dialog).toHaveCount(0);
  });

  test('the coverage badge survives, because it is a claim and not furniture', async ({ page }) => {
    /**
     * `.repo-id` was `display: none` below 720px, and it holds the coverage
     * badge — the app's own statement about whether this history is the whole
     * repository or part of it. It is also the last route to Help at that
     * width, since the badge opens it and the optional icon buttons are hidden
     * by the next rule down.
     */
    await page.goto('/');
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.loadFixture('12-merge-storm'));
    await waitForReady(page);
    await expect(page.getByTestId('quality-badge')).toBeVisible();

    for (const width of [640, 420, 360]) {
      await page.setViewportSize({ width, height: 720 });
      const badge = page.getByTestId('quality-badge');
      await expect(badge, `the badge is still there at ${width}px`).toBeVisible();
      const box = await badge.boundingBox();
      expect(box!.x + box!.width, `and inside the window at ${width}px`).toBeLessThanOrEqual(width + 1);
      // Nothing overflows sideways, however long a repository name is.
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `no sideways scroll at ${width}px`).toBeLessThanOrEqual(1);
    }

    // The route to Help is what the badge does as well as what it says.
    await page.getByTestId('quality-badge').click();
    await expect(page.getByTestId('panel-help')).toBeVisible();
  });
});

test.describe('the question a large repository asks', () => {
  /**
   * `ScopeChooser.tsx` holds two dialogs, and only one of them was a dialog.
   * The catalog one has `aria-modal`, a focus trap, focus placed on the card
   * and restored on close, and backdrop dismissal. The other — the one a large
   * or dense repository raises, including a private one, which is the path
   * where "what happens if you cancel" actually matters — had none of them:
   * Tab walked straight out into the dimmed page behind, focus started on
   * `<body>`, clicking the backdrop did nothing, and its Cancel had no test id,
   * which is why no test had ever pressed it.
   */
  const raise = async (page: Page) => {
    // Over `SCOPE_THRESHOLD`, so the question is asked rather than the history
    // simply played. The probe reads the count off a `Link` header, so this
    // costs one small response and not four thousand commits.
    await routeGitHub(page, bigRepo(4000));
    await page.goto('/');
    await waitForReady(page);
    await page.getByTestId('url-input').fill('acme/widget');
    await page.getByTestId('play-button').click();
    await expect(page.getByTestId('scope-chooser')).toBeVisible({ timeout: 30_000 });
  };

  test('is a dialog: it holds focus, and it can be left', async ({ page }) => {
    await raise(page);
    const dialog = page.getByTestId('scope-chooser');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Focus starts on the card, so the title and the cost are read before the
    // question rather than after it.
    const onCard = await page.evaluate(() => document.activeElement?.classList.contains('scope-card') ?? false);
    expect(onCard, 'focus starts inside the dialog').toBe(true);

    // Tab enough times to have escaped a four-control dialog several times
    // over, then check we are still in it.
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('[data-testid="scope-chooser"]'));
    expect(inside, 'and stays inside it').toBe(true);

    await expect(page.getByTestId('scope-cancel')).toBeVisible();
    await page.getByTestId('scope-cancel').click();
    await expect(dialog).toHaveCount(0);
  });

  test('the backdrop is a way out, not a dead end', async ({ page }) => {
    await raise(page);
    const dialog = page.getByTestId('scope-chooser');
    // The corner, which is backdrop on any viewport.
    await page.mouse.move(6, 6);
    await page.mouse.down();
    await page.mouse.up();
    await expect(dialog).toHaveCount(0);
  });
});
