import { expect, test } from './muted';
import { type Page } from '@playwright/test';
import { routeGitHub, waitForReady } from './helpers';
import { sampleRepo } from '../fixtures/mock-github';

/**
 * A private history leaves nothing behind.
 *
 * The sign-in page and the repositories page both promise this in so many
 * words — "never written to this device — not its commits, not its name, not
 * in the list of what you have watched" — and until this file nothing checked
 * it. `RepoProbe.isPrivate` had been declared, documented and carried out of
 * the probe for exactly this purpose, and never once read: a private history
 * was cached like any other, and its slug went into the recents list that the
 * landing page paints in plain sight.
 *
 * The test reads the database rather than the code, because what is on the
 * disk is the claim. Everything a viewer could recognise is looked for: the
 * owner, the name, an author, and a commit message.
 */

/** Every string in every store of every one of our databases. */
const readEverything = () =>
  new Promise<string>((resolve) => {
    const idb = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
    const listed = idb.databases ? idb.databases() : Promise.resolve([]);
    void listed.then(async (dbs) => {
      const names = dbs.map((d) => d.name).filter((n): n is string => !!n);
      let all = '';
      for (const name of names) {
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
          // Structured-clone values can hold anything; a lossy stringify is
          // the point — we are looking for recognisable text, not for shape.
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
      resolve(all + '\n' + JSON.stringify(localStorage));
    });
  });

test('a private history is watched but not written down', async ({ page }) => {
  await routeGitHub(page, sampleRepo(), { private: true });
  await page.goto('/');
  await waitForReady(page);
  await page.evaluate(() => window.__gittimeline.setToken('token-for-the-test'));
  await page.getByTestId('url-input').fill('acme/widget');
  await page.getByTestId('play-button').click();
  await waitForReady(page);

  // It played. The point is not that private repositories are refused.
  expect(await page.evaluate(() => window.__gittimeline.stats), 'the history performs').not.toBeNull();
  expect(await page.evaluate(() => window.__gittimeline.source)).toEqual({ provider: 'github', slug: 'acme/widget' });

  // Writes are fire-and-forget, so give the ones that would have happened
  // time to happen. A test that raced them would pass on a broken build.
  await page.waitForTimeout(1500);

  const disk = await page.evaluate(readEverything);
  for (const secret of ['acme/widget', 'acme', 'widget']) {
    expect(disk, `"${secret}" is not on the device`).not.toContain(secret);
  }
  // The commit texts the fixture carries, which is what an author or a message
  // leaking would look like.
  const commits = sampleRepo().commits;
  for (const c of commits.slice(0, 8)) {
    expect(disk, 'no commit message').not.toContain(c.message);
    expect(disk, 'no author name').not.toContain(c.author.name);
    expect(disk, 'no commit sha').not.toContain(c.sha);
  }

  // And nothing to click on when you come back.
  //
  // This line was `expect(getByTestId('recent-list')).toHaveCount(0)`, and
  // `recent-list` occurred exactly once in the whole repository — in the
  // assertion. It passed for a public repository whose name *was* recorded and
  // *was* painted on the landing page, which is precisely the situation it
  // exists to catch. An assertion against a test id nothing carries is worse
  // than no assertion: it reads as though it is holding something.
  await page.goto('/');
  await waitForReady(page);
  const ways = page.getByTestId('ways');
  await expect(ways).toBeVisible();
  // The row is always there — it offers suggestions when there are no
  // recents — so what is under test is what is *in* it. `title` carries the
  // full slug and the visible label carries the bare name; check both.
  await expect(ways, 'the private slug is not offered back').not.toContainText('widget');
  const titles = await ways.locator('button').evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''));
  expect(titles.join(' '), 'nor in any tooltip').not.toContain('acme/widget');
  await expect(ways.locator('.ways-label'), 'and there is nothing to come back to').toHaveText('Try');
});

test('a public history in the same session still is', async ({ page }) => {
  /**
   * The counterweight. Writing nothing at all would satisfy the test above
   * and break the cache the whole app depends on, so the same measurement has
   * to show the ordinary case still recording.
   */
  await routeGitHub(page, sampleRepo(), { private: false });
  await page.goto('/');
  await waitForReady(page);
  await page.getByTestId('url-input').fill('acme/widget');
  await page.getByTestId('play-button').click();
  await waitForReady(page);
  await page.waitForTimeout(1500);

  const disk = await page.evaluate(readEverything);
  expect(disk, 'a public repository is kept, so a revisit costs nothing').toContain('acme/widget');
});

test.describe('a repository that changes visibility', () => {
  /**
   * The guarantee used to be evaluated once, at the moment a history was
   * fetched, and never asked again — so a repository watched while it was
   * public and then made private kept its dataset, kept its cached pages with
   * their author addresses, kept its name in the row the landing page paints,
   * and replayed from the disk with no token and no requests at all.
   *
   * Which is the argument this app already makes against caching a private
   * history at all: keeping it leaves the history playable with no credential,
   * so removing the app's access in GitHub revokes nothing that was already
   * taken. Changing a repository's visibility is the other way people revoke.
   */
  const watchIt = async (page: Page) => {
    await page.goto('/');
    await waitForReady(page);
    await page.getByTestId('url-input').fill('acme/widget');
    await page.getByTestId('play-button').click();
    await waitForReady(page);
    await page.waitForTimeout(1200);
  };

  test('is taken off the device once GitHub stops answering for it', async ({ page }) => {
    // One context throughout, so one origin and one IndexedDB — which is the
    // situation being tested. A fresh profile cannot see this at all, which is
    // why the test above could not.
    await routeGitHub(page, sampleRepo(), { private: false });
    await watchIt(page);
    expect(await page.evaluate(readEverything), 'a public history is kept').toContain('acme/widget');

    // Now it is private, exactly as if somebody had changed the setting.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await routeGitHub(page, sampleRepo(), { private: true });

    await page.goto('/');
    await waitForReady(page);
    await page.getByTestId('url-input').fill('acme/widget');
    await page.getByTestId('play-button').click();
    // The probe answers "private", which evicts what the earlier visit wrote.
    await page.waitForTimeout(2500);

    const disk = await page.evaluate(readEverything);
    expect(disk, 'the dataset and its pages are gone').not.toContain('acme/widget');
    for (const c of sampleRepo().commits.slice(0, 5)) {
      expect(disk, 'and so are the commits').not.toContain(c.message);
      expect(disk, 'and the author addresses').not.toContain(c.author.name);
    }
  });

  test('stops replaying from the disk when it is no longer readable', async ({ page }) => {
    /**
     * The harder half. The cached-dataset path serves without a request, so
     * without a check it would replay a now-private history forever, with no
     * token, offline. It serves first and asks afterwards — one view later
     * than perfect, which is the best available without costing a request on
     * every revisit — and then takes it off the device.
     */
    await routeGitHub(page, sampleRepo(), { private: false });
    await watchIt(page);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    // 404 is what GitHub says to a caller who may not see a repository, and it
    // is indistinguishable from deletion. Both mean the same thing here.
    await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' }));

    await page.goto('/');
    await waitForReady(page);
    await page.getByTestId('url-input').fill('acme/widget');
    await page.getByTestId('play-button').click();
    // It plays from the cache — that is the fast path working — and then the
    // check lands.
    await expect(page.locator('.banner')).toContainText(/no longer readable/i, { timeout: 15_000 });

    const disk = await page.evaluate(readEverything);
    expect(disk, 'nothing of it is left').not.toContain('acme/widget');

    // And it is not offered back on the landing page.
    const ways = page.getByTestId('ways');
    await expect(ways).not.toContainText('widget');
  });

  test('a network failure is not an answer', async ({ page }) => {
    /**
     * Offline is the case the cache exists for. A repository must not be
     * evicted because a train went into a tunnel.
     */
    await routeGitHub(page, sampleRepo(), { private: false });
    await watchIt(page);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('https://api.github.com/**', (route) => route.abort('internetdisconnected'));

    await page.goto('/');
    await waitForReady(page);
    await page.getByTestId('url-input').fill('acme/widget');
    await page.getByTestId('play-button').click();
    await waitForReady(page);
    await page.waitForTimeout(2500);

    expect(await page.evaluate(readEverything), 'still there, because nothing said otherwise').toContain('acme/widget');
  });
});
