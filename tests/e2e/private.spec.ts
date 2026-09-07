import { expect, test } from '@playwright/test';
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
