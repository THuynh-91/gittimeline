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
    // The badge names the span it covers, and says whether anything is missing
    // from it. Matching the whole string would pin the fixture's years.
    await expect(page.getByTestId('quality-badge')).toContainText('entire repo');
    await expect(page.locator('.repo-id')).toContainText('acme/widget');
    const stats = await page.evaluate(() => window.__gittimeline.stats);
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
    expect(await page.evaluate(() => window.__gittimeline.stats!.commits)).toBe(56);
  });

  test('empty repository shows the dormant seed, not an error', async ({ page }) => {
    await routeGitHub(page, { ...sampleRepo(), commits: [], branches: [], tags: [] });
    await page.goto('/');
    await page.getByTestId('url-input').fill('acme/widget');
    await page.getByTestId('play-button').click();
    await waitForReady(page);
    await expect(page.getByTestId('caption')).toContainText('No commits yet');
    expect(await page.evaluate(() => window.__gittimeline.stats!.commits)).toBe(0);
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
    // Three of these are the size probe that runs before any history is
    // fetched: metadata, the commit count, and a sample of recent commits to
    // measure how much of this project's work arrives as merges.
    await routeGitHub(page, bigRepo(350), { rateLimitAfter: 6 });
    await page.goto('/');
    await page.getByTestId('url-input').fill('acme/widget');
    await page.getByTestId('play-button').click();
    await waitForReady(page);
    await expect(page.getByTestId('quality-badge')).toContainText('partial');
    await expect(page.locator('.banner')).toContainText('recent commits loaded');
    await expect(page.locator('.banner')).toContainText('request limit');
    const stats = await page.evaluate(() => window.__gittimeline.stats);
    expect(stats!.commits).toBe(200);
    expect(stats!.boundaries).toBe(1);
    const unknown = await page.evaluate(() => window.__gittimeline.events('UNKNOWN_SPAN').length);
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
    // Said once, in passing — a permanent bar for a thing that went right is
    // clutter over the stage.
    await expect(page.locator('.toast')).toContainText('from your last visit');
    await expect(page.locator('.banner')).toHaveCount(0);
    expect(await page.evaluate(() => window.__gittimeline.stats!.commits)).toBe(9);

    // Asking for it again does go to GitHub, and uses conditional requests.
    await page.getByTestId('settings-button').click();
    await page.getByTestId('refetch').click();
    await waitForReady(page);
    expect(mock.requests.length).toBeGreaterThan(firstVisit);
    expect(mock.conditional).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__gittimeline.stats!.commits)).toBe(9);
  });

  test('a pinned link re-fetches and reproduces the same plan', async ({ page }) => {
    await routeGitHub(page, sampleRepo());
    await page.goto('/#repo=acme/widget&autoplay=1&seed=zeta');
    await waitForReady(page);
    const hash1 = await page.evaluate(() => window.__gittimeline.planHash);
    // Opening the same pinned link again re-fetches and recompiles identically.
    await page.goto('/#repo=acme/widget&autoplay=1&seed=zeta');
    await page.reload();
    await waitForReady(page);
    expect(await page.evaluate(() => window.__gittimeline.planHash)).toBe(hash1);
  });

  test('a multi-page history is fetched whole, even when the cache answers a page', async ({ page }) => {
    /**
     * The regression this guards is invisible from the outside: every page
     * arrives and looks complete, but pagination stops early and the result is
     * labelled partial for no reason the viewer can see.
     *
     * A 304 carries no body and no Link header, so a page served from the
     * cache has to take its pagination from the cache entry. It did not — and
     * the size probe samples the same first page ingestion is about to walk,
     * so priming that one entry truncated every repository. mdBook went from
     * 3,296 commits to 401.
     */
    const mock = await routeGitHub(page, bigRepo(350));
    await page.goto('/');
    await page.getByTestId('url-input').fill('acme/widget');
    await page.getByTestId('play-button').click();
    await waitForReady(page);

    expect(mock.conditional, 'the probe primes a page that ingestion then revalidates').toBeGreaterThan(0);
    const stats = await page.evaluate(() => window.__gittimeline.stats);
    expect(stats!.commits, 'every page of the history is loaded').toBe(350);
    // The badge names the span it covers, and says whether anything is missing
    // from it. Matching the whole string would pin the fixture's years.
    await expect(page.getByTestId('quality-badge')).toContainText('entire repo');
  });

  test('pasting a repository URL replaces the field, but never mid-edit', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    const input = page.getByTestId('url-input');
    await page.evaluate(() => navigator.clipboard.writeText('https://github.com/acme/widget/tree/main/src'));

    // Into an empty field, a whole URL is normalised to owner/name.
    await input.click();
    await page.keyboard.press('Control+V');
    await expect(input).toHaveValue('acme/widget');

    // Over a full selection, likewise — that is a replacement either way.
    await input.fill('other/repo');
    await input.focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+V');
    await expect(input).toHaveValue('acme/widget');

    // But with the caret inside existing text it inserts, like any text field.
    // Swallowing the whole value here silently deleted what was being edited,
    // which reads as paste being broken rather than as normalisation.
    await input.fill('other/repo');
    await input.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Control+V');
    await expect(input).toHaveValue('other/repohttps://github.com/acme/widget/tree/main/src');
  });
});
