import { expect, test } from './muted';
import { waitForReady } from './helpers';

/**
 * The second grant, and the ways a credential could escape it.
 *
 * A viewer signed in, went looking for private repositories, and found
 * nothing — because there was nothing: `signInWithGitHub` is called from one
 * place, the OAuth app requests no scopes, and the only control that can reach
 * a private repository was a box in Settings filed under "Large repositories"
 * with no mention of private access. The section that talked about private
 * repositories said "not yet".
 *
 * These are the properties of the control that replaced that, and every one of
 * them is a thing that has already gone wrong somewhere in this app:
 *
 *  - The Settings token field was `type="text"` seeded from the live token, so
 *    signing in and then opening Settings painted an OAuth credential in
 *    cleartext into the page and the accessibility tree.
 *  - `MyRepos`' Disconnect dropped the token and left every history fetched
 *    with it on the device.
 *  - A form containing a text input submits on Enter, and a default submission
 *    is a GET carrying the field's value in the query string. There is
 *    deliberately no form here; this checks Enter does not navigate.
 *
 * The token used below is a fixture string, not a credential, and nothing here
 * makes a network request to GitHub.
 */
const FIXTURE = 'github_pat_11EXAMPLEEXAMPLE_notarealtokenjustafixture';

test.describe('the private-repository grant', () => {
  test('is reachable from the sign-in page, and says what it needs', async ({ page }) => {
    await page.goto('/#sign-in');
    await waitForReady(page);
    const toggle = page.getByTestId('private-token-toggle');
    await expect(toggle, 'a second control exists on the page').toBeVisible();
    await expect(page.getByTestId('private-token-panel')).toHaveCount(0);
    // The section must not open with a refusal. It did: "Not yet — this is
    // what it will be" in bold, with this control underneath, and the person
    // who asked for the feature missed it after it shipped.
    const section = page.locator('section[aria-labelledby="private-heading"]');
    await expect(section).toContainText('Yes, with a token you scope yourself');
    await expect(toggle).toContainText('Set up private access');
    await toggle.click();
    const panel = page.getByTestId('private-token-panel');
    await expect(panel).toBeVisible();
    // The exact permission, because "make a token" without it is a shrug.
    await expect(panel).toContainText('Contents');
    await expect(panel).toContainText('Read-only');
    await expect(panel).toContainText('Only select repositories');
  });

  test('never renders the credential as text', async ({ page }) => {
    await page.goto('/#sign-in');
    await waitForReady(page);
    await page.getByTestId('private-token-toggle').click();
    const input = page.getByTestId('private-token-input');
    // Masked, so it is not in a screenshot, a screen share, or the a11y tree.
    await expect(input).toHaveAttribute('type', 'password');
    await expect(input).toHaveAttribute('autocomplete', 'off');

    await input.fill(FIXTURE);
    await page.getByTestId('private-token-apply').click();
    await expect(page.getByTestId('private-token-applied')).toBeVisible();

    // Gone from the field, so it is not sitting in component state behind a
    // collapsed disclosure for the rest of the session.
    await expect(input).toHaveValue('');

    // And nowhere in the rendered document, at all.
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    expect(html.includes(FIXTURE), 'the token is not in the DOM').toBe(false);
  });

  test('pressing Enter does not put the token in the URL', async ({ page }) => {
    await page.goto('/#sign-in');
    await waitForReady(page);
    await page.getByTestId('private-token-toggle').click();
    const before = page.url();
    await page.getByTestId('private-token-input').fill(FIXTURE);
    await page.getByTestId('private-token-input').press('Enter');
    await expect(page.getByTestId('private-token-applied')).toBeVisible();
    // A form submission would have reloaded with `?private-token=…` on it.
    expect(page.url()).toBe(before);
    expect(page.url().includes(FIXTURE)).toBe(false);
    expect(page.url().includes('github_pat')).toBe(false);
  });

  test('is not written to disk', async ({ page }) => {
    await page.goto('/#sign-in');
    await waitForReady(page);
    await page.getByTestId('private-token-toggle').click();
    await page.getByTestId('private-token-input').fill(FIXTURE);
    await page.getByTestId('private-token-apply').click();
    await expect(page.getByTestId('private-token-applied')).toBeVisible();

    const stored = await page.evaluate(async () => {
      const out: string[] = [JSON.stringify(localStorage), JSON.stringify(sessionStorage)];
      // Every value in every store of every database, which is where a
      // credential would have to be to survive the tab.
      const dbs = (await indexedDB.databases?.()) ?? [];
      for (const { name } of dbs) {
        if (!name) continue;
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const r = indexedDB.open(name);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        for (const store of [...db.objectStoreNames]) {
          const all = await new Promise<unknown[]>((res) => {
            const r = db.transaction(store, 'readonly').objectStore(store).getAll();
            r.onsuccess = () => res(r.result as unknown[]);
            r.onerror = () => res([]);
          });
          out.push(all.map((v) => { try { return JSON.stringify(v); } catch { return String(v); } }).join('\n'));
        }
        db.close();
      }
      return out.join('\n');
    });
    expect(stored.includes(FIXTURE), 'the token is not persisted anywhere').toBe(false);
    expect(stored.includes('github_pat'), 'no token-shaped string is persisted').toBe(false);
  });

  test('warns about a classic token without refusing it', async ({ page }) => {
    await page.goto('/#sign-in');
    await waitForReady(page);
    await page.getByTestId('private-token-toggle').click();
    const input = page.getByTestId('private-token-input');
    await expect(page.getByTestId('private-token-classic')).toHaveCount(0);
    await input.fill('ghp_notarealclassictokeneither00000000');
    // Said, because a classic token reaches every repository the account can;
    // not blocked, because that is the viewer's call and not this page's.
    await expect(page.getByTestId('private-token-classic')).toBeVisible();
    await expect(page.getByTestId('private-token-apply')).toBeEnabled();
  });
});
