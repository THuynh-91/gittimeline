import { expect, test } from '@playwright/test';
import { waitForReady } from './helpers';

/**
 * The page that answers "which of my repositories?".
 *
 * Signing in used to raise the request allowance and then hand somebody back
 * to a text box, which is a capability rather than a workflow. The list first
 * went at the foot of the sign-in page — a consent document several hundred
 * words long, with the demo performing behind it — so it landed 406px down a
 * 1,400px page and the main line was legible through the rows. Hence a page.
 *
 * The repositories are fabricated here. What is under test is the route, the
 * shape of the list and what the page says about privacy, none of which needs
 * a real credential — and a test that required one could not run in CI.
 */
const REPOS = [
  { full_name: 'someone/public-thing', private: false, fork: false, archived: false, pushed_at: new Date().toISOString(), language: 'TypeScript', stargazers_count: 3, size: 90, description: null },
  { full_name: 'someone/secret-thing', private: true, fork: false, archived: false, pushed_at: new Date(Date.now() - 2 * 86400000).toISOString(), language: 'Rust', stargazers_count: 0, size: 40, description: null },
  { full_name: 'someone/empty-thing', private: false, fork: false, archived: false, pushed_at: null, language: null, stargazers_count: 0, size: 0, description: null },
];

test.describe('your repositories', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**api.github.com/user/repos**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REPOS) }),
    );
  });

  test('is a route of its own, reachable and linkable', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
    // Nothing to offer until there is a credential, so no entry in the bar.
    await expect(page.getByTestId('repos-link')).toHaveCount(0);

    await page.evaluate(() => window.__gittimeline.setToken('token-for-the-test'));
    await expect(page.getByTestId('repos-link')).toBeVisible();
    await page.getByTestId('repos-link').click();
    await expect(page.getByTestId('repos-page')).toBeVisible();
    expect(new URL(page.url()).hash, 'the page has its own address').toBe('#your-repositories');

    // And it survives being followed directly, which is what a hash is for.
    await page.goto('/#your-repositories');
    await page.evaluate(() => window.__gittimeline.setToken('token-for-the-test'));
    await expect(page.getByTestId('repos-page')).toBeVisible();
  });

  test('lists what the credential can see, and says which are private', async ({ page }) => {
    await page.goto('/#your-repositories');
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.setToken('token-for-the-test'));
    const list = page.getByTestId('my-repos');
    await expect(list).toBeVisible();

    await expect(page.getByTestId('my-repo-someone-public-thing')).toBeVisible();
    await expect(page.getByTestId('my-repo-someone-secret-thing')).toBeVisible();
    // A repository with no commits has no history to perform.
    await expect(page.getByTestId('my-repo-someone-empty-thing')).toHaveCount(0);

    const secret = page.getByTestId('my-repo-someone-secret-thing');
    await expect(secret, 'a private repository is marked as one').toContainText(/private/i);
    await expect(page.getByTestId('my-repo-someone-public-thing')).not.toContainText(/private/i);
  });

  test('explains why a private repository may not be there', async ({ page }) => {
    await page.goto('/#your-repositories');
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.setToken('token-for-the-test'));
    const note = page.locator('.repos-note');
    await expect(note).toBeVisible();
    // The two claims that have to stay true, because the rest of the page's
    // credibility rests on them.
    await expect(note).toContainText(/no permissions/i);
    await expect(note).toContainText(/never written to this device/i);
  });

  test('the list is drawn over nothing — the stage does not show through it', async ({ page }) => {
    await page.goto('/#your-repositories');
    await waitForReady(page);
    await page.evaluate(() => window.__gittimeline.setToken('token-for-the-test'));
    await expect(page.getByTestId('my-repos')).toBeVisible();
    // The demo performs behind every page. An unbacked card let the main line
    // and its captions read straight through the repository names.
    const opaque = await page.evaluate(() => {
      const el = document.querySelector('.myrepos');
      if (!el) return null;
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1]!.split(',').map((n) => parseFloat(n));
      return { alpha: parts.length > 3 ? parts[3]! : 1 };
    });
    expect(opaque, 'the list has a background').not.toBeNull();
    expect(opaque!.alpha, 'and it is opaque').toBeGreaterThan(0.9);
  });
});
