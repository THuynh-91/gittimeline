import { expect, test } from './muted';
import { waitForReady, shelfPresent } from './helpers';

/**
 * The catalog is the honest answer to "can I share my token so other people
 * get a higher rate limit". A token in the client is readable by anyone who
 * opens the network tab, so the fetching happens once at build time instead.
 * The property that matters is therefore not that it loads, but that it loads
 * having asked GitHub for nothing at all.
 */
test.describe('pre-fetched catalog', () => {
  test('a large history plays with no token and no GitHub requests', async ({ page }) => {
    const calls: string[] = [];
    await page.route('https://api.github.com/**', (route) => {
      calls.push(route.request().url());
      return route.abort();
    });

    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    const shelf = page.getByTestId('catalog');
    // A build without a catalog simply has no shelf; nothing here is a failure.
    if (!(await shelfPresent(page))) test.skip(true, 'no catalog built into this bundle');

    // The smallest history on the shelf, rather than a named one. The catalog
    // is rebuilt from whatever has been pre-fetched, and naming an entry here
    // meant the suite broke every time that list changed — which tests the
    // build script's contents, not the property under test.
    //
    // It used to be the first one, on the assumption that the shelf led with
    // its quickest entry. It leads with Linux now: the widest frame on the page
    // rather than the fastest thing on it, 1.5 million commits, and minutes of
    // composition in this tab on any build where the precompiled plan is
    // missing or a version behind. Clicking it here would hang this test on the
    // one entry least able to answer inside a timeout — and the property under
    // test is that a pre-fetched history plays having asked GitHub for nothing,
    // which the smallest artifact demonstrates exactly as well as the largest.
    const cheapest = await page.evaluate(async () => {
      const list = (await (await fetch(window.__gittimeline.catalogUrl('index.json'))).json()).entries as Array<{ slug: string; bytes: number }>;
      return list.reduce((a, b) => (b.bytes < a.bytes ? b : a)).slug;
    });
    await shelf.getByTestId(`catalog-${cheapest.replace('/', '-')}`).click();
    // The card opens the question; "Everything" is the answer that is the
    // whole repository, and the one this test is about.
    await page.getByTestId('scope-full').click();
    await waitForReady(page);

    const stats = await page.evaluate(() => window.__gittimeline.stats);
    expect(stats!.commits, 'a catalog entry is a real history').toBeGreaterThan(1000);
    expect(await page.evaluate(() => window.__gittimeline.mode)).toBe('player');
    expect(calls, 'the catalog must not touch GitHub').toEqual([]);
  });

  test('a single year plays out of the same plan, and the badge says so', async ({ page }) => {
    const calls: string[] = [];
    await page.route('https://api.github.com/**', (route) => {
      calls.push(route.request().url());
      return route.abort();
    });

    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    const shelf = page.getByTestId('catalog');
    if (!(await shelfPresent(page))) test.skip(true, 'no catalog built into this bundle');

    const cheapest = await page.evaluate(async () => {
      const list = (await (await fetch(window.__gittimeline.catalogUrl('index.json'))).json()).entries as Array<{ slug: string; bytes: number }>;
      return list.reduce((a, b) => (b.bytes < a.bytes ? b : a)).slug;
    });
    // A card has one action, and it is a question rather than a start: which
    // project is what the shelf asks, and how much of it is asked next.
    await shelf.getByTestId(`catalog-${cheapest.replace('/', '-')}`).click();
    const chooser = page.getByTestId('scope-chooser');
    await expect(chooser).toBeVisible();
    await expect(page.getByTestId('scope-full'), 'the whole history is the primary offer').toBeVisible();

    const track = chooser.getByTestId('scope-track');
    // An entry whose plan predates spans covers one year or none, and offers no
    // range: there is then nothing here to test rather than something broken.
    if (!(await track.isVisible({ timeout: 10_000 }).catch(() => false))) test.skip(true, 'this build indexed no years');
    // Both ends to the same year, which is the narrowest thing a range can be
    // and the one whose label the badge has to match exactly. Two clicks on
    // the same year is how the track says that.
    const first = track.locator('button').first();
    const year = (await first.getAttribute('data-testid'))!.replace('scope-year-', '');
    await first.click();
    await first.click();
    await expect(chooser.getByTestId('scope-range-runtime')).toContainText(year);
    await chooser.getByTestId('scope-full').click();
    await waitForReady(page);

    // The whole plan is loaded — a span is a window on it, not a smaller
    // download — so the duration is the whole history's and the clock is
    // somewhere inside it rather than at nought.
    const state = await page.evaluate(() => ({ time: window.__gittimeline.time, duration: window.__gittimeline.duration, pace: window.__gittimeline.pace }));
    expect(state.duration, 'the span plays the plan it was cut from').toBeGreaterThan(0);
    expect(state.pace!.perSecond, 'a span is never denser than the suite allows').toBeLessThanOrEqual(9);
    // The one thing on screen that distinguishes a span from a seek.
    await expect(page.getByTestId('quality-badge')).toHaveText(new RegExp(`${year}.*partial`));
    expect(calls, 'a span costs no GitHub requests either').toEqual([]);
  });

  /**
   * The date on screen must describe the playhead until somebody goes looking.
   *
   * At the final frame the camera settles by itself, and on a streamed history
   * it settles somewhere that is not the ending — so the explore control saw a
   * fraction of the picture on screen, decided the viewer must be travelling,
   * and handed the date readout to the camera's position. Nobody had touched
   * anything. Node announced September 2012 while the timeline said 2026-09-04:
   * fourteen years apart, with "Travelling the finished history" underneath it.
   *
   * The built-in demo never showed this, because it is held whole and its
   * whole picture fits — which is the one case the previous guard covered.
   */
  test('at the end, the date still describes the playhead', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    if (!(await shelfPresent(page))) test.skip(true, 'no catalog built into this bundle');

    const cheapest = await page.evaluate(async () => {
      const list = (await (await fetch(window.__gittimeline.catalogUrl('index.json'))).json()).entries as Array<{ slug: string; bytes: number }>;
      return list.reduce((a, b) => (b.bytes < a.bytes ? b : a)).slug;
    });
    await page.getByTestId('catalog').getByTestId(`catalog-${cheapest.replace('/', '-')}`).click();
    await page.getByTestId('scope-full').click();
    await waitForReady(page);
    const duration = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((t) => window.__gittimeline.seek(t), duration);
    await page.waitForFunction(() => !window.__gittimeline.buffering, null, { timeout: 120_000 });
    // Touch nothing else. Long enough for the closing shot to settle.
    await page.waitForTimeout(3000);

    const hero = (await page.getByTestId('date-hero').innerText()).replace(/\s+/g, ' ').trim();
    const slider = (await page.getByTestId('timeline').getAttribute('aria-valuetext')) ?? '';
    const year = (t: string) => { const m = t.match(/(19|20)\d{2}/); return m ? Number(m[0]) : NaN; };
    expect(year(hero), `date hero read "${hero}"`).not.toBeNaN();
    expect(year(slider), `timeline read "${slider}"`).not.toBeNaN();
    expect(Math.abs(year(hero) - year(slider)), `the hero says "${hero}", the timeline says "${slider}"`).toBeLessThanOrEqual(1);

    // And it must not claim the viewer is travelling when they are not.
    const caption = (await page.getByTestId('caption').innerText()).trim();
    expect(caption, 'nobody has touched the camera').not.toMatch(/travelling/i);
  });

  /**
   * A card predicts the experience, and the length is not a category.
   *
   * A first-time viewer read the shelf and concluded, correctly from what it
   * said, that its numbers mean nothing: Chromium's blurb says "larger than
   * Linux: nearly two million commits" and its card said 2 min 45 s, beside
   * Linux's 1,481,850 commits at 12 h. LLVM 595,778 at 2 min 35 s beside Rust
   * 339,084 at 8 h 58 min. And "all twelve cards carry the same duration
   * label: `LONG`" — which they did, because "long" was written as a unit for
   * the value above it and renders as a 9.5px uppercase caption, the shape of
   * a category name.
   *
   * The missing quantity is how many commits get a beat of their own, which is
   * what `compile.ts` builds the length out of. With it on the card the two
   * pairs above stop contradicting each other and start explaining each other,
   * and the check for that is arithmetic: every entry must land within a
   * factor of two of the same arrivals-per-second, because the choreographer
   * gives every arrival the same beat and the length follows from that.
   */
  test('a card says how many commits reach the stage, not just how many exist', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    if (!(await shelfPresent(page))) test.skip(true, 'no catalog built into this bundle');

    const labels = await page.locator('[data-testid="catalog"] .catalog-figure > span').allInnerTexts();
    const set = [...new Set(labels.map((l) => l.trim().toLowerCase()))];
    expect(set, 'no card is filed under a category called LONG').not.toContain('long');
    expect(set, 'the length says what it is').toContain('to watch');
    expect(set, 'and so does the number the length is made of').toContain('on stage');

    // Every card carries all three, so the trio can be compared across the
    // shelf rather than only within one card.
    const cards = await page.locator('[data-testid="catalog"] .catalog-card').count();
    const perCard = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="catalog"] .catalog-card')].map((c) =>
        [...c.querySelectorAll('.catalog-figure')].map((f) => ({
          value: (f.querySelector('b')?.textContent ?? '').trim(),
          label: (f.querySelector('span')?.textContent ?? '').trim().toLowerCase(),
        })),
      ),
    );
    expect(perCard.length).toBe(cards);
    for (const figs of perCard) {
      expect(figs.map((f) => f.label), 'three figures, in the order that reads as a sentence').toEqual(['to watch', 'commits', 'on stage']);
      for (const f of figs) expect(f.value, `${f.label} has a value`).not.toBe('');
    }

    // And the number on the card is the number the pacing is built from: one
    // beat each, so arrivals over seconds is the same constant everywhere.
    const paces = await page.evaluate(async () => {
      const list = (await (await fetch(window.__gittimeline.catalogUrl('index.json'))).json()).entries as Array<{ slug: string; durationSeconds: number | null }>;
      return list.filter((e) => e.durationSeconds).map((e) => ({ slug: e.slug, per: (e.durationSeconds! - 4.2) / 0.13 / e.durationSeconds! }));
    });
    for (const p of paces) expect(p.per, `${p.slug} lands its arrivals at the one pace this app has`).toBeGreaterThan(4);
    for (const p of paces) expect(p.per, `${p.slug} lands its arrivals at the one pace this app has`).toBeLessThanOrEqual(9);
  });

  /**
   * The year picker offers every year the plan covers, and one length is quoted
   * for the whole of it.
   *
   * Both halves were reported by the same first-time viewer and both had the
   * same cause, `spanFloor` in `Catalog.tsx`:
   *
   *  - "React's year picker only offers 13, 14, 15, 16, 17, 19 — no 2018,
   *    nothing after 2019 — while the pill at the top of the player says
   *    2013–2026 · ENTIRE REPO." Measured against the shipped index, the floor
   *    dropped four of React's ten years, two of mdBook's twelve (2016 and
   *    2024, both of which play, with commits in them), eleven of LLVM's
   *    twenty-one and eleven of Chromium's twenty.
   *  - "mdBook is 2 min 43 s on the card, 2 min 43 s in the modal header, *the
   *    whole history · 2 min 31 s* in the readout twenty pixels above the
   *    button." The readout summed the *offered* years, so it was short by
   *    exactly the twelve seconds the two dropped years hold.
   *
   * Asserted for every entry on the shelf rather than a named one, because
   * opening a card costs nothing — the question is asked before anything is
   * fetched — and because the entry that happens to have holes changes with
   * every build.
   */
  test('every year the plan covers is offered, and the whole of it is priced once', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    if (!(await shelfPresent(page))) test.skip(true, 'no catalog built into this bundle');

    const entries = await page.evaluate(async () => {
      const list = (await (await fetch(window.__gittimeline.catalogUrl('index.json'))).json()).entries as Array<{
        slug: string;
        durationSeconds: number | null;
        years: Array<[number, number]> | null;
      }>;
      const now = new Date().getUTCFullYear();
      return list.map((e) => ({
        slug: e.slug,
        durationSeconds: e.durationSeconds,
        // A year later than this one is not a year of anything; the app leaves
        // those out and so does this, for the same reason.
        years: (e.years ?? []).filter(([y]) => y <= now).map(([y]) => y),
      }));
    });

    /** The card's own wording for a length, so the two are compared as strings. */
    const runtime = (seconds: number) => {
      const s = Math.round(seconds);
      if (s < 60) return `${s} s`;
      const m = Math.floor(s / 60);
      if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
      return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
    };

    for (const e of entries) {
      if (e.years.length < 2 || !e.durationSeconds) continue;
      const card = page.getByTestId(`catalog-${e.slug.replace('/', '-')}`);
      await card.scrollIntoViewIfNeeded();
      await card.click();
      const chooser = page.getByTestId('scope-chooser');
      await expect(chooser).toBeVisible();

      const offered = (await chooser.locator('[data-year]').evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.year)))).sort((a, b) => a - b);
      expect(offered, `${e.slug} offers every year its plan covers`).toEqual([...e.years].sort((a, b) => a - b));

      // The dialog opens on the whole history, so this is the whole-history
      // price. It has to be the same string the card and the heading carry.
      const whole = runtime(e.durationSeconds);
      await expect(chooser.getByTestId('scope-range-runtime'), `${e.slug} prices the whole history once`).toContainText(whole);
      await expect(chooser.getByTestId('scope-full'), `${e.slug} offers it at that same length`).toContainText(whole);
      await expect(chooser.locator('h2').locator('..')).toContainText(whole);

      await chooser.getByTestId('scope-cancel').click();
      await expect(chooser).toHaveCount(0);
    }
  });

  /**
   * And the player's clock agrees with the card that started it.
   *
   * The fourth of the four figures the viewer counted for mdBook: "02:42 on the
   * player clock" against 2 min 43 s everywhere else. The plan runs 162.5s,
   * the index stores `Math.round` of it, and `fmtClock` floored — so a length
   * was being reported by the rule that belongs to a position.
   */
  test('the player clock agrees with the card that started it', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    if (!(await shelfPresent(page))) test.skip(true, 'no catalog built into this bundle');

    const cheapest = await page.evaluate(async () => {
      const list = (await (await fetch(window.__gittimeline.catalogUrl('index.json'))).json()).entries as Array<{ slug: string; bytes: number; durationSeconds: number | null }>;
      return list.reduce((a, b) => (b.bytes < a.bytes ? b : a));
    });
    await page.getByTestId('catalog').getByTestId(`catalog-${cheapest.slug.replace('/', '-')}`).click();
    await page.getByTestId('scope-full').click();
    await waitForReady(page);

    const secs = Math.round(cheapest.durationSeconds ?? 0);
    const expected = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    await expect(page.getByTestId('clock'), `the card said ${secs}s`).toContainText(`/ ${expected}`);
  });

  /**
   * The coverage pill on a phone, which needs a real history to reproduce.
   *
   * A first-time viewer at 390px: "the coverage pill `2015–2026 · ENTIRE REPO`
   * renders as a four-line vertical oval that overflows off the top of the
   * screen with the first line clipped". Measured before the fix, at 390x844
   * on mdBook: **80px wide, 72px tall, drawn at y = -11** inside a 50px bar.
   * `.quality` is a `<button>` and so `flex-shrink: 1`, and it carried no
   * `white-space` — so the truth claim was the element that gave way while the
   * repository name beside it was explicitly set to truncate.
   *
   * It is here rather than in `fallback.spec.ts` because the badge for a
   * *synthetic* history is the single word "generated", which fits on any
   * screen. Reproducing it takes a real history with a year range, and a
   * catalog entry is one that costs no requests to open.
   */
  for (const size of [
    { width: 390, height: 844 },
    { width: 360, height: 740 },
  ]) {
    test(`the coverage pill is one line inside the bar at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/');
      await page.getByTestId('catalog-link').click();
      if (!(await shelfPresent(page))) test.skip(true, 'no catalog built into this bundle');

      const cheapest = await page.evaluate(async () => {
        const list = (await (await fetch(window.__gittimeline.catalogUrl('index.json'))).json()).entries as Array<{ slug: string; bytes: number }>;
        return list.reduce((a, b) => (b.bytes < a.bytes ? b : a)).slug;
      });
      await page.getByTestId('catalog').getByTestId(`catalog-${cheapest.replace('/', '-')}`).click();
      await page.getByTestId('scope-full').click();
      await waitForReady(page);

      const badge = page.getByTestId('quality-badge');
      await expect(badge).toBeVisible();
      // A real span, so the case under test is actually reached: `generated`
      // never wrapped and never could.
      await expect(badge, 'this is the badge that used to wrap').toContainText(/entire repo|partial/);
      const b = (await badge.boundingBox())!;
      // The height bound is what catches the wrap: three lines of an 11px
      // pill measures 54px and four measures 72.
      expect(b.height, 'the coverage pill is one line').toBeLessThan(30);
      expect(b.y, 'and not clipped off the top of the screen').toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, 'and inside the window').toBeLessThanOrEqual(size.width + 1);
      const top = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chrome-top')));
      expect(b.y + b.height, 'and inside the bar it belongs to').toBeLessThanOrEqual(top + 1);
      // The repository name is still readable beside it, rather than having
      // been squeezed to an ellipsis to pay for the badge.
      const name = await page.locator('.repo-id strong').boundingBox();
      expect(name!.width, 'and the name it shares the bar with is still there').toBeGreaterThan(30);
    });
  }

  /**
   * A show that came off the shelf can get back to it.
   *
   * "No way back to the shelf from a running show. 'Back to start' is the only
   * exit and it lands on the landing page." Twelve histories, and from inside
   * one of them the only door led away from all of them.
   */
  test('a show that came off the shelf has a way back to it', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('catalog-link').click();
    if (!(await shelfPresent(page))) test.skip(true, 'no catalog built into this bundle');

    const cheapest = await page.evaluate(async () => {
      const list = (await (await fetch(window.__gittimeline.catalogUrl('index.json'))).json()).entries as Array<{ slug: string; bytes: number }>;
      return list.reduce((a, b) => (b.bytes < a.bytes ? b : a)).slug;
    });
    await page.getByTestId('catalog').getByTestId(`catalog-${cheapest.replace('/', '-')}`).click();
    await page.getByTestId('scope-full').click();
    await waitForReady(page);

    const back = page.getByTestId('player-back');
    await expect(back, 'the exit says where it goes').toContainText(/selection/i);
    await back.click();
    await expect(page.getByTestId('catalog-page')).toBeVisible();
    await expect(page.getByTestId('catalog')).toBeVisible();
  });

  test('every catalog entry is real, reachable and honestly described', async ({ page }) => {
    await page.goto('/');
    // Asked of wherever the shelf actually is. It used to be published with
    // the site, so `/catalog/` was a safe assumption; it is served from an
    // object store now, and that path returns the SPA's own `index.html` with
    // a 200 on it — so this failed as a JSON parse error rather than as a
    // missing file, which is a long way from the cause.
    const index = await page.evaluate(async () => {
      const r = await fetch(window.__gittimeline.catalogUrl('index.json'));
      return r.ok ? await r.json() : null;
    });
    if (!index) test.skip(true, 'no catalog built into this bundle');

    // `HEAD`, and the variable has always said so. A `GET` here asked for the
    // body of every artifact on the shelf, which was 85 MB while the shelf
    // stopped at LLVM and became 981 MB the moment Linux, Rust and Chromium
    // could be opened and joined it — a gigabyte pulled through the page to
    // establish twelve status codes, and a minute is not long enough to do it
    // in. What is being asserted is that the file is there and served, and a
    // `HEAD` is that assertion with none of the download.
    const fetched = (f: string) => page.evaluate(async (u) => (await fetch(window.__gittimeline.catalogUrl(u), { method: 'HEAD' })).status, f);

    for (const e of index.entries) {
      // Whatever the click will actually ask for.
      //
      // `e.file` is the name of a whole compiled history, and for a *packaged*
      // entry nothing ever downloads one: `loadCatalogEntry` turns that name
      // into `<slug>.pages/manifest.json` and streams the pages the playhead
      // reaches. So the publisher does not upload the monolith at all — it is
      // 199 MB for Linux alone — and this asserted a 404 on all twelve entries
      // while every one of them opens in milliseconds. The file was missing
      // and the shelf was fine, which is the wrong way round for a test to be
      // wrong: it reports a healthy shelf as broken and would say nothing at
      // all if the manifests vanished.
      const wanted = e.packaged ? e.file.replace(/\.gittimeline\.gz$/, '.pages/manifest.json') : e.file;
      expect(await fetched(wanted), `${e.slug} is served what opening it asks for`).toBe(200);
      // A card with a broken image is worse than a card with none, so a
      // thumbnail that is *claimed* has to resolve. Claiming none is allowed:
      // capturing a frame means compiling the whole history in a browser, and
      // the largest of these take minutes, so the card falls back to a drawn
      // placeholder rather than the entry falling out of the catalog.
      // The card's picture *is* the owner's mark now, so a claimed logo that
      // does not resolve is not a missing decoration — it is the whole image on
      // the card. The page's CSP allows no remote images either, so a logo that
      // is not a local file cannot be a logo at all.
      if (e.logo) {
        expect(await fetched(e.logo), `${e.slug} logo is served`).toBe(200);
      }
      // A claimed plan is the one field on a card that is a promise about the
      // click rather than a description of the repository: it is what the card
      // quotes as the cost of opening, and it is what says the wait is a
      // download rather than a compile. An index naming a plan that is not
      // served would put a size on the card that nothing is going to charge.
      if (e.plan) {
        expect(await fetched(e.plan), `${e.slug} plan is served`).toBe(200);
        expect(e.planBytes, `${e.slug} says what its plan weighs`).toBeGreaterThan(1000);
      }
      expect(e.commits, `${e.slug} has commits`).toBeGreaterThan(0);
      expect(e.bytes, `${e.slug} has bytes`).toBeGreaterThan(1000);
      // How long the performance runs is the fact the card leads with, so an
      // entry that does not carry one is an entry the shelf cannot describe.
      //
      // There is no upper bound to assert against any more, and the assertion
      // that used to be here — thirty-five minutes — is exactly the thing that
      // went wrong. A cap on length is a cap on how much can be shown, and
      // while it existed Linux's 332,279 arrivals were delivered inside it at
      // 158 a second. The pace below is what that assertion should always have
      // been: not how long a history takes, but whether it can be followed.
      expect(e.durationSeconds, `${e.slug} knows how long it runs`).toBeGreaterThan(0);
      expect(e.nodes, `${e.slug} says how many arrivals are in it`).toBeGreaterThan(0);
      expect(e.nodes / e.durationSeconds, `${e.slug} lands its arrivals slowly enough to be counted`).toBeLessThanOrEqual(9);
      // The years a card offers as spans. Each is a calendar year and a length
      // in seconds, and their lengths cannot add up to more than the whole —
      // a span is a window on this plan and never a longer show than the plan.
      if (e.years) {
        const total = (e.years as Array<[number, number]>).reduce((n, [, secs]) => n + secs, 0);
        expect(total, `${e.slug} spans fit inside the performance`).toBeLessThanOrEqual(e.durationSeconds + 1);
        for (const [y, secs] of e.years as Array<[number, number]>) {
          expect(y, `${e.slug} year ${y} is a year`).toBeGreaterThan(1969);
          expect(secs, `${e.slug} year ${y} has a length`).toBeGreaterThan(0);
        }
      }
      expect(typeof e.builtAt).toBe('string');
    }
  });
});
