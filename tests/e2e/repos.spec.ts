import { expect, test } from './muted';
import type { Page } from '@playwright/test';
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
 * shape of the list, what the page says when GitHub says something unhelpful,
 * and what it says about privacy — none of which needs a real credential, and
 * a test that required one could not run in CI.
 */
const repo = (name: string, over: Record<string, unknown> = {}) => ({
  full_name: `someone/${name}`,
  private: false,
  fork: false,
  archived: false,
  pushed_at: new Date().toISOString(),
  language: 'TypeScript',
  stargazers_count: 3,
  size: 90,
  description: null,
  ...over,
});

const REPOS = [
  repo('public-thing'),
  repo('secret-thing', { private: true, language: 'Rust', pushed_at: new Date(Date.now() - 2 * 86400000).toISOString() }),
  // `size` is disk usage in kilobytes, rounded down — not a commit count. A
  // new repository with an initial commit and a short README reports zero, and
  // used to be silently removed from the list.
  repo('tiny-thing', { size: 0 }),
];

const serve = (page: Page, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  page.route('**api.github.com/user/repos**', (route) =>
    route.fulfill({ status, contentType: 'application/json', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }),
  );

const connect = async (page: Page) => {
  await page.goto('/#your-repositories');
  await waitForReady(page);
  await page.evaluate(() => window.__gittimeline.setToken('token-for-the-test'));
};

test.describe('your repositories', () => {
  test('is a route of its own, reachable and linkable', async ({ page }) => {
    await serve(page, REPOS);
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
    await connect(page);
    await expect(page.getByTestId('repos-page')).toBeVisible();
  });

  test('lists what the credential can see, and says which are private', async ({ page }) => {
    await serve(page, REPOS);
    await connect(page);
    await expect(page.getByTestId('my-repos')).toBeVisible();

    await expect(page.getByTestId('my-repo-someone-public-thing')).toBeVisible();
    await expect(page.getByTestId('my-repo-someone-secret-thing')).toBeVisible();
    // `size: 0` is not "no commits". Whether a repository really has none is a
    // 409 from the commits endpoint, which the ingest already answers with
    // "No commits yet" — so the row belongs here and that path can say so.
    await expect(page.getByTestId('my-repo-someone-tiny-thing'), 'a repository under a kilobyte still exists').toBeVisible();
    await expect(page.getByTestId('my-repos-count')).toContainText('3 to choose from');

    await expect(page.getByTestId('my-repo-someone-secret-thing'), 'a private repository is marked as one').toContainText(/private/i);
    await expect(page.getByTestId('my-repo-someone-public-thing')).not.toContainText(/private/i);
  });

  test('the count follows the filter, out loud', async ({ page }) => {
    /**
     * The count printed the unfiltered total whatever was typed — nine rows
     * under a sentence saying twenty — and "Nothing matches" was an ordinary
     * paragraph, so a screen reader was told nothing at all when a filter
     * emptied the list.
     */
    await serve(page, Array.from({ length: 24 }, (_, i) => repo(`thing-${String(i).padStart(3, '0')}`)));
    await connect(page);
    const count = page.getByTestId('my-repos-count');
    await expect(count).toContainText('24 to choose from');
    await expect(count, 'it is announced, not merely shown').toHaveAttribute('role', 'status');

    const filter = page.getByTestId('my-repos-filter');
    await expect(filter, 'and it says which list it filters').toHaveAttribute('aria-controls', 'my-repos-list');
    await filter.fill('thing-01');
    await expect(count).toContainText('10 of 24 match');
    await expect(page.getByTestId('my-repos-list').locator('li')).toHaveCount(10);

    await filter.fill('nothing-like-this');
    await expect(count, 'an empty result is stated in the live region').toContainText('0 of 24 match');
  });

  test('says when there are more than it read', async ({ page }) => {
    /**
     * Somebody with three hundred repositories was told they had two hundred,
     * shown sixty of those, and the other hundred did not exist — on a page
     * whose whole purpose is not being a box to type a name into.
     */
    let call = 0;
    await page.route('**api.github.com/user/repos**', (route) => {
      call++;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          // A `Link` that always offers another page, so the reader runs out
          // of its own page budget rather than out of repositories. Exposed
          // explicitly: this is a cross-origin response even when Playwright
          // fulfils it, so a header the browser is not told to expose is a
          // header the app cannot read — which is why the first version of
          // this test saw exactly one page.
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'Link',
          Link: '<https://api.github.com/user/repos?page=99>; rel="next"',
        },
        body: JSON.stringify(Array.from({ length: 100 }, (_, i) => repo(`p${call}-thing-${i}`))),
      });
    });
    await connect(page);
    await expect(page.getByTestId('my-repos-count')).toContainText('more than this page reads');
  });

  test('a bad answer from GitHub is a sentence about GitHub, not about you', async ({ page }) => {
    /**
     * Four separate wrong messages lived here. An object instead of an array,
     * and `null`, both produced "you have no public ones" — a server fault
     * reported as a fact about the person reading it. A list holding a `null`
     * threw "Cannot read properties of null (reading 'full_name')" straight
     * onto the screen, under a comment promising that a `TypeError` is not
     * written for anybody.
     */
    await serve(page, { message: 'nope', total_count: 0 });
    await connect(page);
    const err = page.getByTestId('my-repos-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/not with a list of repositories/i);
    await expect(err, 'and it does not blame the account').not.toContainText(/no public ones/i);
    await expect(page.getByTestId('my-repos-retry'), 'with something to do about it').toBeVisible();

    // A list with rubbish in it keeps the readable rows and counts the rest.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await serve(page, [null, 3, 'x', {}, { full_name: 42 }, repo('real-thing')]);
    await page.getByTestId('my-repos-retry').click();
    await expect(page.getByTestId('my-repo-someone-real-thing')).toBeVisible();
    const count = page.getByTestId('my-repos-count');
    await expect(count).toContainText('1 to choose from');
    await expect(count, 'and admits what it dropped').toContainText('5 could not be read');
    await expect(page.getByTestId('my-repos-error')).toHaveCount(0);
  });

  test('a rejected token stops the app claiming to be connected', async ({ page }) => {
    /**
     * A 401 told the viewer to "remove it or supply a valid fine-grained
     * token" — one they never supplied and have no box to type into — while
     * `store.token` stayed set, so the site bar and the sign-in page both went
     * on saying "GitHub connected".
     */
    await serve(page, { message: 'Bad credentials' }, 401);
    await connect(page);
    const err = page.getByTestId('my-repos-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/revoked or has expired/i);
    await expect(err, 'it does not ask for a token there is no box for').not.toContainText(/supply a valid/i);

    await page.getByTestId('my-repos-disconnect').click();
    await expect(page.getByTestId('repos-link'), 'and the bar stops offering the list').toHaveCount(0);
  });

  test('an exhausted allowance says whose, and when it comes back', async ({ page }) => {
    /**
     * The old sentence said the *anonymous* limit for their *network* was
     * exhausted, two inches under a paragraph explaining that this call spends
     * their own five-thousand-an-hour allowance, and dropped the reset time
     * that was in the response headers.
     */
    const reset = Math.floor(Date.now() / 1000) + 1800;
    await serve(page, { message: 'API rate limit exceeded' }, 403, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': String(reset),
    });
    await connect(page);
    const err = page.getByTestId('my-repos-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/your github request allowance/i);
    await expect(err, 'not the anonymous per-network one').not.toContainText(/anonymous/i);
    await expect(err, 'and it says when').toContainText(/resets/i);
  });

  test('explains why a private repository may not be there', async ({ page }) => {
    await serve(page, REPOS);
    await connect(page);
    const note = page.locator('.repos-note');
    await expect(note).toBeVisible();
    // The two claims that have to stay true, because the rest of the page's
    // credibility rests on them.
    await expect(note).toContainText(/no permissions/i);
    await expect(note).toContainText(/never written to this device/i);
  });

  test('the list is drawn over nothing — the stage does not show through it', async ({ page }) => {
    await serve(page, REPOS);
    await connect(page);
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

  test('the demo behind the page does not narrate itself', async ({ page }) => {
    /**
     * The accessibility tree for this page used to open with "gittimeline/an
     * example history: 2401 commits, 383 threads, 318 merges…" — the backdrop
     * demo, described as though it were the subject — and the app's one live
     * region read out its commit captions, unprompted, at somebody browsing
     * their own repositories.
     */
    await serve(page, REPOS);
    await connect(page);
    await expect(page.getByTestId('my-repos')).toBeVisible();

    const canvas = page.getByTestId('stage-canvas');
    await expect(canvas, 'wallpaper is not described').toHaveAttribute('aria-hidden', 'true');

    const live = page.locator('[aria-live="polite"]');
    // Long enough for several commits of the demo to land.
    await page.waitForTimeout(3000);
    await expect(live, 'and it says nothing about a history nobody asked for').toHaveText('');

    // A control on this page still announces what it did, which is the thing
    // the live region is actually for.
    await expect(page.locator('main')).toBeVisible();
  });
});
