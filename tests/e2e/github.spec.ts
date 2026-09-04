import { expect, test } from '@playwright/test';
import { routeGitHub, waitForReady } from './helpers';
import { sampleRepo, type MockRepo } from '../fixtures/mock-github';

function bigRepo(n: number): MockRepo {
  const shas: string[] = [];
  const commits = [];
  for (let i = 0; i < n; i++) {
    const sha = (i + 7).toString(16).padStart(40, '0');
    shas.push(sha);
    commits.push({ sha, parents: i ? [shas[i - 1]!] : [], message: `commit ${i}`, author: { name: `Dev ${i % 4}`, login: `dev${i % 4}`, id: i % 4, date: new Date(Date.UTC(2018, 0, 1, i)).toISOString() } });
  }
  return { owner: 'acme', name: 'widget', defaultBranch: 'main', commits, branches: [{ name: 'main', sha: shas[n - 1]! }], tags: [] };
}

test.describe('public repository ingestion (mocked GitHub)', () => {
  test('happy path: URL → prelude → truthful exact performance', async ({ page }) => {
    await routeGitHub(page, sampleRepo());
    await page.goto('/');
    await page.getByTestId('url-input').fill('https://github.com/acme/widget');
    await expect(page.locator('#url-hint')).toContainText('Reads acme/widget');
    await page.getByTestId('play-button').click();
    await waitForReady(page);
    await expect(page.getByTestId('quality-badge')).toHaveText('exact');
    await expect(page.locator('.repo-id')).toContainText('acme/widget');
    const stats = await page.evaluate(() => window.__gitdance.stats);
    expect(stats).toMatchObject({ commits: 9, merges: 1, threads: 3 });
    await page.getByTestId('help-button').click();
    await expect(page.getByTestId('panel-help')).toContainText('full known history');
    await expect(page.getByTestId('panel-help')).toContainText('trunk');
    await expect(page.getByTestId('panel-help')).toContainText('Mara Ekwueme');
  });

  test('paste detection normalizes the URL; Enter submits; Escape clears', async ({ page }) => {
    await routeGitHub(page, sampleRepo());
    await page.goto('/');
    const input = page.getByTestId('url-input');
    await input.focus();
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="url-input"]') as HTMLInputElement;
      const dt = new DataTransfer();
      dt.setData('text', 'https://github.com/acme/widget/tree/trunk/src?x=1');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(input).toHaveValue('acme/widget');
    await input.press('Escape');
    await expect(input).toHaveValue('');
    await input.fill('acme/widget');
    await input.press('Enter');
    await waitForReady(page);
    await expect(page.locator('.repo-id')).toContainText('acme/widget');
  });

  test('invalid, non-GitHub and not-found inputs are explained without crashing', async ({ page }) => {
    await routeGitHub(page, null);
    await page.goto('/');
    const input = page.getByTestId('url-input');
    await input.fill('https://gitlab.com/x/y');
    await expect(page.locator('#url-hint')).toContainText('public GitHub repositories only');
    await input.fill('github.com/only-owner');
    await expect(page.locator('#url-hint')).toContainText('owner and a name');
    await input.fill('github.com/nobody/nothing');
    await page.getByTestId('play-button').click();
    await expect(page.getByRole('alertdialog')).toContainText('Repository not available');
    await expect(page.getByRole('alertdialog')).toContainText('did not expose this repository publicly');
    await page.getByRole('button', { name: 'Play the demo instead' }).click();
    await waitForReady(page);
    expect(await page.evaluate(() => window.__gitdance.stats!.commits)).toBe(56);
  });

  test('empty repository shows the dormant seed, not an error', async ({ page }) => {
    await routeGitHub(page, { ...sampleRepo(), commits: [], branches: [], tags: [] });
    await page.goto('/');
    await page.getByTestId('url-input').fill('acme/widget');
    await page.getByTestId('play-button').click();
    await waitForReady(page);
    await expect(page.getByTestId('caption')).toContainText('No commits yet');
    expect(await page.evaluate(() => window.__gitdance.stats!.commits)).toBe(0);
  });

  test('rate limit before data explains the reset; rate limit mid-way yields a partial, labelled performance', async ({ page }) => {
    await routeGitHub(page, bigRepo(350), { rateLimitAfter: 0, resetAt: Math.floor(Date.now() / 1000) + 1500 });
    await page.goto('/');
    await page.getByTestId('url-input').fill('acme/widget');
    await page.getByTestId('play-button').click();
    await expect(page.getByRole('alertdialog')).toContainText('rate limit');
    await expect(page.getByRole('alertdialog')).toContainText('minutes');
    await expect(page.getByRole('alertdialog')).toContainText('cannot bypass');

    await page.unrouteAll();
    // Two of these are the size probe that runs before any history is fetched.
    await routeGitHub(page, bigRepo(350), { rateLimitAfter: 5 });
    await page.goto('/');
    await page.getByTestId('url-input').fill('acme/widget');
    await page.getByTestId('play-button').click();
    await waitForReady(page);
    await expect(page.getByTestId('quality-badge')).toHaveText('partial');
    await expect(page.locator('.banner')).toContainText('recent commits loaded');
    await expect(page.locator('.banner')).toContainText('request limit');
    const stats = await page.evaluate(() => window.__gitdance.stats);
    expect(stats!.commits).toBe(200);
    expect(stats!.boundaries).toBe(1);
    const unknown = await page.evaluate(() => window.__gitdance.events('UNKNOWN_SPAN').length);
    expect(unknown).toBe(1);
  });

  test('cancel during loading returns to the landing page', async ({ page }) => {
    await routeGitHub(page, bigRepo(2500));
    await page.goto('/');
    await page.getByTestId('url-input').fill('acme/widget');
    await page.getByTestId('play-button').click();
    await expect(page.getByTestId('prelude')).toBeVisible();
    await page.getByTestId('cancel-button').click();
    await expect(page.getByTestId('url-input')).toBeVisible();
  });

  test('a repository already loaded is reused, and a forced refresh revalidates', async ({ page }) => {
    const mock = await routeGitHub(page, sampleRepo());
    const open = async () => {
      await page.goto('/');
      await page.getByTestId('url-input').fill('acme/widget');
      await page.getByTestId('play-button').click();
      await waitForReady(page);
    };
    await open();
    const firstVisit = mock.requests.length;
    expect(firstVisit).toBeGreaterThan(0);

    // Second visit: nothing already fetched should be fetched again.
    await open();
    expect(mock.requests.length).toBe(firstVisit);
    await expect(page.locator('.banner')).toContainText('from your last visit');
    expect(await page.evaluate(() => window.__gitdance.stats!.commits)).toBe(9);

    // Asking for it again does go to GitHub, and uses conditional requests.
    await page.getByRole('button', { name: 'Fetch again' }).click();
    await waitForReady(page);
    expect(mock.requests.length).toBeGreaterThan(firstVisit);
    expect(mock.conditional).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__gitdance.stats!.commits)).toBe(9);
  });

  test('a pinned link re-fetches and reproduces the same plan', async ({ page }) => {
    await routeGitHub(page, sampleRepo());
    await page.goto('/#repo=acme/widget&autoplay=1&seed=zeta');
    await waitForReady(page);
    const hash1 = await page.evaluate(() => window.__gitdance.planHash);
    // Opening the same pinned link again re-fetches and recompiles identically.
    await page.goto('/#repo=acme/widget&autoplay=1&seed=zeta');
    await page.reload();
    await waitForReady(page);
    expect(await page.evaluate(() => window.__gitdance.planHash)).toBe(hash1);
  });
});
