import { expect, test } from './muted';
import type { Page } from '@playwright/test';
import { waitForReady } from './helpers';

/**
 * Disconnect, and whether it disconnects.
 *
 * The worry these were written for: "when a user disconnects it should
 * actually disconnect". There are three affordances that end a connection —
 * the sign-in page's Disconnect, the one `MyRepos` offers on a 401, and
 * replacing the token in Settings — and `private-grant.spec.ts` checks what
 * happens when a credential *arrives* without checking anything about what
 * happens when it leaves.
 *
 * The credential below is an obviously fake fixture string and every request
 * to api.github.com is intercepted, so nothing here reaches GitHub.
 */
const PAT = 'github_pat_11FIXTUREONLY_notarealtokenatall000000';

const listing = (name: string, over: Record<string, unknown> = {}) => ({
  full_name: `someone/${name}`,
  private: false,
  fork: false,
  archived: false,
  pushed_at: new Date().toISOString(),
  language: 'TypeScript',
  size: 90,
  description: null,
  ...over,
});

const REPOS = [listing('public-thing'), listing('secret-thing', { private: true, language: 'Rust' })];

/** Commits for the mocked repositories: small, linear, recognisable. */
const commits = (owner: string, name: string, n = 8) =>
  Array.from({ length: n }, (_, i) => {
    const sha = (i + 3).toString(16).padStart(40, 'b');
    const date = new Date(Date.UTC(2021, 0, 1 + i)).toISOString();
    return {
      sha,
      html_url: `https://github.com/${owner}/${name}/commit/${sha}`,
      commit: {
        message: `probe commit ${i}`,
        author: { name: `Probe Dev ${i % 2}`, email: 'dev@example.com', date },
        committer: { name: 'Probe Dev', email: 'dev@example.com', date },
      },
      author: { login: `probedev${i % 2}`, id: i % 2, avatar_url: 'https://avatars.githubusercontent.com/u/0' },
      parents: i ? [{ sha: (i + 2).toString(16).padStart(40, 'b') }] : [],
    };
  });

interface Seen {
  path: string;
  /** Whether the fixture credential was attached, without recording it. */
  authed: boolean;
}

/**
 * Route api.github.com and record whether each request carried the credential.
 *
 * Recording the *presence* of the header rather than its value is deliberate:
 * a test artifact should never contain a token, not even a fake one, in a
 * position where a real one could end up by a copy-and-paste.
 */
async function routeAll(page: Page, opts: { repoStatus?: number; repoBody?: unknown; rateLimited?: boolean } = {}) {
  const seen: Seen[] = [];
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const authed = !!req.headers()['authorization'];
    seen.push({ path: url.pathname, authed });
    const headers: Record<string, string> = {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'ETag, Link, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
      'x-ratelimit-limit': authed ? '5000' : '60',
      'x-ratelimit-remaining': opts.rateLimited ? '0' : authed ? '4997' : '57',
      'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800),
    };
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

    if (opts.rateLimited) return json({ message: 'API rate limit exceeded' }, 403);
    if (url.pathname === '/user/repos') return json(REPOS);
    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!m) return json({ message: 'Not Found' }, 404);
    const [, owner, name, rest = ''] = m as unknown as [string, string, string, string];
    if (opts.repoStatus) return json(opts.repoBody ?? { message: 'Bad credentials' }, opts.repoStatus);
    if (rest === '')
      return json({
        full_name: `${owner}/${name}`,
        default_branch: 'main',
        description: 'probe',
        created_at: '2021-01-01T00:00:00Z',
        pushed_at: '2021-02-01T00:00:00Z',
        size: 42,
        html_url: `https://github.com/${owner}/${name}`,
        private: name === 'secret-thing',
      });
    if (rest === '/commits') return json(commits(owner, name));
    if (rest === '/branches') return json([{ name: 'main', commit: { sha: (10).toString(16).padStart(40, 'b') } }]);
    if (rest === '/tags') return json([]);
    return json({ message: 'Not Found' }, 404);
  });
  return seen;
}

/** Everything on the device, as text, the way `private.spec.ts` reads it. */
const readEverything = () =>
  new Promise<string>((resolve) => {
    const idb = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
    void (idb.databases ? idb.databases() : Promise.resolve([])).then(async (dbs) => {
      let all = '';
      for (const entry of dbs) {
        const name = entry.name;
        if (!name) continue;
        const db = await new Promise<IDBDatabase | null>((ok) => {
          const req = indexedDB.open(name);
          req.onsuccess = () => ok(req.result);
          req.onerror = () => ok(null);
          req.onblocked = () => ok(null);
        });
        if (!db) continue;
        for (const store of Array.from(db.objectStoreNames)) {
          const rows = await new Promise<unknown[]>((ok) => {
            try {
              const req = db.transaction(store, 'readonly').objectStore(store).getAll();
              req.onsuccess = () => ok(req.result as unknown[]);
              req.onerror = () => ok([]);
            } catch {
              ok([]);
            }
          });
          all += rows
            .map((r) => {
              try {
                return JSON.stringify(r);
              } catch {
                return String(r);
              }
            })
            .join('\n');
        }
        db.close();
      }
      resolve(`${all}\n${JSON.stringify(localStorage)}\n${JSON.stringify(sessionStorage)}`);
    });
  });

/**
 * Apply the fixture token through the real control, and stay in the tab.
 *
 * One `goto` per test and in-app navigation afterwards, because a reload
 * discards exactly the in-memory state that "does disconnecting clear it"
 * is a question about. Two earlier probes of this reloaded between steps and
 * therefore could not see any of it.
 */
async function connectWithPat(page: Page) {
  await page.goto('/');
  await waitForReady(page);
  await page.getByTestId('signin-link').click();
  await page.getByTestId('private-token-toggle').click();
  await page.getByTestId('private-token-input').fill(PAT);
  await page.getByTestId('private-token-apply').click();
  await expect(page.getByTestId('private-token-applied')).toBeVisible();
}

/** Play one of the mocked repositories by clicking its row in the list. */
async function watchFromTheList(page: Page, slug: string) {
  await page.getByTestId('signin-to-repos').click();
  const row = page.getByTestId(`my-repo-${slug.replace('/', '-')}`);
  await row.waitFor();
  await row.click();
  await waitForReady(page);
  // Writes are fire-and-forget; a test that raced them would pass on a
  // broken build.
  await page.waitForTimeout(1500);
}

/** Leave the stage the way the player's own wordmark does. */
const backToStart = (page: Page) => page.getByLabel('Back to start').click();

test.describe('disconnecting', () => {
  test('stops the credential being sent at all', async ({ page }) => {
    /**
     * The assertion that matters most, and the only one that cannot be
     * satisfied by tidying the interface: after Disconnect, does the next
     * request to GitHub still carry the token?
     */
    const seen = await routeAll(page);
    await connectWithPat(page);
    await watchFromTheList(page, 'someone/public-thing');
    expect(seen.length, 'the connected session made authenticated requests').toBeGreaterThan(0);
    expect(seen.every((s) => s.authed), 'every request while connected carried the credential').toBe(true);

    await backToStart(page);
    await page.getByTestId('signin-link').click();
    await page.getByTestId('signout-github').click();
    await expect(page.getByTestId('signin-github')).toBeVisible();

    const before = seen.length;
    await page.getByTestId('signin-back').click();
    await page.getByTestId('url-input').fill('someone/public-thing');
    await page.getByTestId('play-button').click();
    await waitForReady(page);
    await page.waitForTimeout(1000);

    const after = seen.slice(before);
    expect(after.length, 'the repository was fetched again from scratch').toBeGreaterThan(0);
    expect(after.some((s) => s.authed), 'nothing after Disconnect carries the credential').toBe(false);
  });

  test('takes the histories fetched with it off the device', async ({ page }) => {
    /**
     * "Disconnecting means disconnecting." Anything fetched while connected
     * was fetched with a credential that is now gone, and leaving it on the
     * device makes "revoke" a word about GitHub rather than about this
     * machine. Read off the disk rather than trusted to the code.
     */
    await routeAll(page);
    await connectWithPat(page);
    await watchFromTheList(page, 'someone/public-thing');
    expect(await page.evaluate(readEverything), 'a public history is cached while connected').toContain('someone/public-thing');

    await backToStart(page);
    await page.getByTestId('signin-link').click();
    await page.getByTestId('signout-github').click();
    await expect(page.getByTestId('signin-github')).toBeVisible();
    await page.waitForTimeout(1500);

    const disk = await page.evaluate(readEverything);
    expect(disk, 'the cached history is gone').not.toContain('someone/public-thing');
    for (const c of commits('someone', 'public-thing').slice(0, 4)) {
      expect(disk, 'and so are its commits').not.toContain(c.commit.message);
    }
    expect(disk, 'and no token-shaped string was ever there').not.toContain('github_pat');
  });

  test('empties the list, the bar and the row of what was watched', async ({ page }) => {
    await routeAll(page);
    await connectWithPat(page);
    await watchFromTheList(page, 'someone/public-thing');
    await backToStart(page);
    // Recents are what the landing page paints in plain sight.
    await expect(page.getByTestId('ways')).toContainText('public-thing');
    await expect(page.getByTestId('repos-link')).toBeVisible();

    await page.getByTestId('signin-link').click();
    await page.getByTestId('signout-github').click();
    await expect(page.getByTestId('signin-github')).toBeVisible();

    // The list itself, on its own page.
    await expect(page.getByTestId('repos-link'), 'the bar stops offering the list').toHaveCount(0);
    await page.goto('/#your-repositories');
    await waitForReady(page);
    await expect(page.getByTestId('my-repos'), 'and the list is not rendered').toHaveCount(0);
    await expect(page.getByTestId('repos-connect'), 'the page says you are not connected').toBeVisible();

    await page.getByTestId('repos-back').click();
    await expect(page.getByTestId('ways'), 'and nothing is offered back').not.toContainText('public-thing');
    await expect(page.locator('.ways-label')).toHaveText('Try');
  });

  test('a private repository opened from the list is not written down', async ({ page }) => {
    /**
     * `private.spec.ts` proves this for a slug typed into the landing box.
     * The list is the other way in and the one the sign-in page sends people
     * to, and nothing covered it — the row's own click handler is where the
     * decision not to fill the landing input lives, so it is a path with its
     * own logic.
     */
    await routeAll(page);
    await connectWithPat(page);
    await watchFromTheList(page, 'someone/secret-thing');
    expect(await page.evaluate(() => window.__gittimeline.source)).toEqual({ provider: 'github', slug: 'someone/secret-thing' });

    const disk = await page.evaluate(readEverything);
    for (const secret of ['someone/secret-thing', 'secret-thing']) {
      expect(disk, `"${secret}" is not on the device`).not.toContain(secret);
    }
    for (const c of commits('someone', 'secret-thing').slice(0, 4)) {
      expect(disk, 'no commit message').not.toContain(c.commit.message);
    }

    // And its name is not left in the landing box for whoever looks next.
    await backToStart(page);
    await expect(page.getByTestId('url-input')).toHaveValue('');
    await expect(page.getByTestId('ways')).not.toContainText('secret-thing');
  });

  /**
   * ## Fixed, and these are the guards
   *
   * These four arrived from a QA pass as `test.fail`, each asserting the
   * behaviour the app's own words promise and each failing on its stated
   * assertion rather than on a timeout. All four are fixed now, so the
   * annotations are off and these are ordinary tests: the applied note is
   * derived from the token rather than tracked as a flag, a 401 drops the
   * credential instead of going on re-sending it, the third token box is
   * masked like the other two, and a disconnect clears the landing box.
   */
  test.describe('what Disconnect and a rejected token do', () => {
    test('the sign-in page stops saying a token is in use', async ({ page }) => {
      await routeAll(page);
      await connectWithPat(page);
      // Sanity: the note is what a connected page says.
      await expect(page.getByTestId('private-token-applied')).toBeVisible();

      await page.getByTestId('signout-github').click();
      await expect(page.getByTestId('signin-github'), 'the page agrees it is disconnected').toBeVisible();
      // …while three inches below, the private-access panel still reads
      // "In use for this tab. Your repositories now lists what it can see."
      await expect(page.getByTestId('private-token-applied'), 'nothing still claims the token is in use').toHaveCount(0);
    });
  });

  test.describe('open defects: a token rejected mid-performance', () => {
    test('does not leave the app claiming to be connected', async ({ page }) => {
      /**
       * `MyRepos` learned this — a 401 there disconnects and says the token
       * was revoked — and the player path did not. A token revoked at GitHub
       * mid-session produces "Token rejected · GitHub rejected the token.
       * Remove it or supply a valid fine-grained token", with no box to remove
       * it in, while the site bar, the sign-in page and Settings all go on
       * saying the connection is live and every later request re-sends the
       * dead credential.
       */
      await routeAll(page);
      await connectWithPat(page);
      await page.getByTestId('signin-back').click();

      // Now GitHub rejects it, exactly as it would after a revoke.
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await routeAll(page, { repoStatus: 401, repoBody: { message: 'Bad credentials' } });

      await page.getByTestId('url-input').fill('someone/public-thing');
      await page.getByTestId('play-button').click();
      await expect(page.locator('.error-card')).toContainText(/token/i);
      // There is no control on this card that can drop the credential the
      // message is about: the inline token box only appears for a rate limit.
      await expect(page.locator('.error-card .token-inline'), 'nowhere to act on what it just told you').toHaveCount(0);

      // Leave by the card's own Back button and look at the bar.
      await page.locator('.error-card .actions button', { hasText: 'Back' }).click();
      await expect(page.getByTestId('site-bar')).toBeVisible();
      await expect(page.getByTestId('repos-link'), 'the bar stops offering the signed-in list').toHaveCount(0);
    });
  });

  test.describe('open defects: the rate-limit escape hatch', () => {
    test('does not paint the credential as cleartext', async ({ page }) => {
      /**
       * The Settings field was `type="text"` seeded from the live token and
       * was fixed. The third token box — the one offered inside the
       * rate-limit error card, which is where the app itself says most people
       * meet this — is still `type="text"`, so a credential typed into it is
       * painted into the page, the accessibility tree and any screenshot or
       * screen share of that dialog.
       */
      await routeAll(page, { rateLimited: true });
      await page.goto('/');
      await waitForReady(page);
      await page.getByTestId('url-input').fill('someone/public-thing');
      await page.getByTestId('play-button').click();
      const box = page.locator('.token-inline input');
      await expect(box).toBeVisible();
      await expect(box, 'masked, like the other two').toHaveAttribute('type', 'password');
    });
  });

  test.describe('open defects: what the landing page still names', () => {
    test('forgets the repository that was being watched', async ({ page }) => {
      /**
       * Clicking a public row fills the landing box, deliberately, as a
       * convenience — and Disconnect does not empty it. So the box still
       * names the last repository of the session that was just ended, on the
       * first page the next person at this browser sees, until the tab is
       * reloaded. The comment on that click handler reasons about exactly
       * this exposure for a private repository and stops there.
       */
      await routeAll(page);
      await connectWithPat(page);
      await watchFromTheList(page, 'someone/public-thing');
      await backToStart(page);
      await expect(page.getByTestId('url-input')).toHaveValue('someone/public-thing');

      await page.getByTestId('signin-link').click();
      await page.getByTestId('signout-github').click();
      await expect(page.getByTestId('signin-github')).toBeVisible();
      await page.getByTestId('signin-back').click();
      await expect(page.getByTestId('url-input'), 'the box does not name the ended session').toHaveValue('');
    });
  });
});
