import { expect, test } from './muted';
import { waitForReady } from './helpers';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Two statements the page makes about itself, and the checks that keep them
 * true.
 *
 * Both were added as prose with nothing asserting them, and a release review
 * pointed out that "neither sentence can drift from the deployment again" was
 * itself unguarded. One of the two was already wrong when it was written.
 */

test.describe('the analytics disclosure matches the build', () => {
  /**
   * The page prints one of two paragraphs depending on whether a measurement
   * id was compiled in. A local build has none, so the off copy is the one
   * that must appear, and nothing may be fetched or stored.
   *
   * It also used to decide this with a hand-copied regex, `/^G-[A-Z0-9]{6,}$/i`
   * against `analytics.ts`'s `/^G-[A-Z0-9]{4,20}$/`. An id of four or five
   * characters after `G-` was accepted by the module and rejected by the page,
   * so the module loaded gtag and set a cookie while the page said nothing
   * leaves at all. That is why the predicate is imported now rather than
   * restated, and why this asserts the *behaviour* alongside the wording.
   */
  test('says nothing leaves, and nothing does', async ({ page }) => {
    await page.goto('/#sign-in');
    await waitForReady(page);
    await expect(page.getByTestId('signin-page')).toContainText('Nothing leaves at all on this deployment');
    await expect(page.getByTestId('signin-page')).not.toContainText('counts visits with Google');

    // The claim, checked rather than trusted.
    expect(await page.evaluate(() => document.querySelectorAll('script[src*="googletagmanager"]').length),
      'no analytics script is fetched').toBe(0);
    expect((await page.context().cookies()).length, 'no cookie is set').toBe(0);
    expect(await page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag),
      'gtag never becomes available').toBe('undefined');
  });

  test('the page and the module agree on what a measurement id is', async () => {
    // A unit test covers `isMeasurementId` itself. This asserts the page does
    // not carry a second opinion about it, which is the defect that happened.
    const src = readFileSync('src/app/SignIn.tsx', 'utf8');
    expect(src, 'SignIn imports the predicate').toContain("isMeasurementId(String(import.meta.env.VITE_GA_ID");
    // Comments are stripped before looking for a second opinion, because the
    // comment explaining the defect quotes both regexes and a naive search
    // matches its own documentation. This assertion failed that way first.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, 'and does not restate the rule in code').not.toMatch(/\/\^G-\[A-Z0-9\]/);
  });
});

/**
 * A streamed history claims no number of open branches, because one cannot be
 * had from a window.
 *
 * Three mechanisms were tried and measured before this. Bare `open > 1` showed
 * "2" against a settled 426 on Linux. Adding `!buffering` looked fixed in one
 * trace and a poll under load still caught 8. Adding "does the plan cover the
 * clock" gave identical numbers, because the swapped-in window does cover the
 * clock while its thread list is still filling.
 *
 * So the assertion is not "the number is right" but **"there is no number"**,
 * which is the only claim a window can support. The history's total still
 * appears in the title, read from the summary rather than the resident window.
 */
test.describe('a streamed history claims no branch count', () => {
  for (const stem of ['torvalds-linux', 'kubernetes-kubernetes']) {
    test(`${stem}: no digit is printed across a window swap`, async ({ page }) => {
      test.skip(!existsSync(`dist/catalog/${stem}.pages/manifest.json`), 'requires a locally prepared catalog package');

      await page.goto('/#selection');
      await waitForReady(page);
      await page.getByTestId(`catalog-${stem}`).click();
      await page.getByTestId('scope-full').click({ timeout: 180_000 });
      await page.waitForFunction(() => window.__gittimeline.stats !== null, null, { timeout: 600_000 });
      await page.evaluate(() => { window.__gittimeline.pause(); window.__gittimeline.seek(window.__gittimeline.duration * 0.1); });
      await page.waitForFunction(() => window.__gittimeline.buffering === false, null, { timeout: 300_000 });
      await page.waitForTimeout(1000);

      const seen = await page.evaluate(async () => {
        const g = window.__gittimeline;
        g.pause();
        g.seek(g.duration * 0.9);
        const out: string[] = [];
        const t0 = performance.now();
        while (performance.now() - t0 < 6000) {
          const el = document.querySelector('[data-testid="open-threads"]');
          out.push(el?.textContent?.trim() ?? '(absent)');
          await new Promise((r) => setTimeout(r, 150));
        }
        return out;
      });

      const withDigits = [...new Set(seen.filter((t) => /\d/.test(t)))];
      expect(withDigits, 'no sample states a number of open branches').toEqual([]);
      // And it does say something, so this is not passing by drawing nothing.
      expect(seen.some((t) => /branches open/i.test(t)), 'the readout is still present').toBe(true);
    });
  }
});
