import { expect, test } from '@playwright/test';
import { routeGitHub, waitForReady } from './helpers';
import { sampleRepo } from '../fixtures/mock-github';

/**
 * The promise on the sign-in page, checked against the wire.
 *
 * `tests/unit/analytics.test.ts` proves the redaction rule; this proves it is
 * the rule the running application actually applies, and it watches the one
 * channel a unit test cannot see: the request itself. GA4 fills
 * `page_location` from `location.href` unless it is told otherwise, and on
 * this site the fragment is the router — `#repo=owner/name` — so a default
 * configuration would have leaked every shared repository through a parameter
 * nobody wrote.
 *
 * The repository arrives here two ways for that reason: once in the URL, and
 * once typed into the box.
 */

/** Every host a tag manager, a collector or an advertising pixel could use. */
const GOOGLE = /(^|\.)(google-analytics\.com|googletagmanager\.com|analytics\.google\.com|google\.com|doubleclick\.net)$/;

/** The mock repository, in every spelling a request could carry it. */
const SECRETS = ['acme/widget', encodeURIComponent('acme/widget'), 'acme%2Fwidget'];

test.describe('analytics privacy', () => {
  test('a repository the visitor supplied never reaches a Google endpoint', async ({ page }) => {
    const bound: string[] = [];
    await page.route(
      (url) => GOOGLE.test(url.hostname),
      async (route) => {
        const req = route.request();
        bound.push(`${req.url()}\n${req.postData() ?? ''}`);
        // Answered here rather than allowed out: this suite must not depend on
        // the network, and gtag.js must not run and drain `dataLayer` before
        // the assertions below can read what was queued into it.
        await route.fulfill({ status: 204, body: '' });
      },
    );
    await routeGitHub(page, sampleRepo());

    // A shared link. The slug is in the fragment, which is exactly where the
    // default `page_location` would have found it.
    await page.goto('/#repo=acme/widget&autoplay=1');
    await waitForReady(page);
    expect(await page.evaluate(() => location.href), 'the page really is holding the slug').toContain('acme/widget');

    // And typed in, from a clean URL, so the event parameters are on their own.
    await page.goto('/');
    await page.getByTestId('url-input').fill('acme/widget');
    await page.getByTestId('play-button').click();
    await waitForReady(page);

    const queued = await page.evaluate(() => JSON.stringify(window.dataLayer ?? []));
    const wire = [...bound, queued].join('\n');
    for (const secret of SECRETS) expect(wire, `nothing Google-bound may carry ${secret}`).not.toContain(secret);

    // Whether anything was measured at all depends on this build. Both answers
    // are correct; only one of them is correct for the build in hand, and an
    // assertion that passes either way would not be an assertion.
    const configured = await page.evaluate(() => (window.dataLayer ?? []).some((e) => Array.isArray(e) && e[0] === 'config'));
    if (!configured) {
      expect(bound, 'an unconfigured build measures nothing').toEqual([]);
      return;
    }

    // Configured, so the absence of the slug above has to be the redaction
    // working rather than nothing having happened. The repository was measured;
    // it was measured as a shape.
    expect(bound.length, 'a configured build loads the tag').toBeGreaterThan(0);
    const started = await page.evaluate(() =>
      (window.dataLayer ?? [])
        .filter((e): e is [string, string, Record<string, string>] => Array.isArray(e) && e[0] === 'event' && e[1] === 'performance_start')
        .map((e) => e[2]),
    );
    expect(started.length).toBeGreaterThan(0);
    for (const params of started) {
      expect(params.repository).toBe('a public repository');
      expect(params.commit_bucket).toBeTruthy();
    }
  });

  test('with no measurement id the module is inert', async ({ page }) => {
    // VITE_GA_ID is unset in development and in CI, and the module must then
    // be as absent as if it had never been imported — no script, no cookie, no
    // `dataLayer`. A no-op that still loads a tag manager is not a no-op.
    const bound: string[] = [];
    await page.route(
      (url) => GOOGLE.test(url.hostname),
      async (route) => {
        bound.push(route.request().url());
        await route.fulfill({ status: 204, body: '' });
      },
    );
    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    await page.getByTestId('catalog-back').click();

    const configured = await page.evaluate(() => (window.dataLayer ?? []).some((e) => Array.isArray(e) && e[0] === 'config'));
    test.skip(configured, 'this build has a measurement id, so silence is not the expected behaviour');

    expect(bound).toEqual([]);
    expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0);
    expect(await page.evaluate(() => window.dataLayer === undefined)).toBe(true);
  });
});
