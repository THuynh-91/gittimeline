import { expect, test } from './muted';
import { waitForReady } from './helpers';
import { existsSync } from 'node:fs';

/**
 * The caption describes the moment the date above it describes.
 *
 * They are two lines a viewer reads together, and on every scrub of a streamed
 * history they disagreed. `docs/status.md` section 0c records `MAY 2026` over a
 * caption dated `2005-05-08` on the live build of Linux — twenty-one years —
 * and four fixes made in the area, none of which changed the symptom.
 *
 * The cause was one line, and it is worth stating here because the shape of it
 * is what made it invisible for two days. `prepareCatalogWindow` decides where
 * the caption walk resumes in a newly assembled window, and it decided by
 * asking `opts.seek !== false && !player.playing`. But `opts.seek` does not
 * mean "this is a seek"; it means "move the playhead when this window lands".
 * `player.beforeSeek` — the one path that is unambiguously a seek — passes
 * `seek: false` **because** the clock has already been moved and must not be
 * moved twice. So the flag read false for every scrub of a streamed entry, the
 * walk was started at `findIndex(impact > t)`, and from there it could only
 * ever describe moments *after* the playhead. Measured on the build before the
 * fix, Kubernetes paused at 45% with the covering window resident: `captionPtr`
 * 452 of 727 events, 209 eligible events at or before the clock, and the walk
 * consuming none of them — 79 calls to `updateCaption` over 3.3 s all
 * returning at `want === held`. Running the clock for 700 ms moved `t` past
 * event 452 and the caption corrected itself immediately, which is why it kept
 * looking like a race.
 *
 * Only reachable on a streamed history. `beforeSeek` returns early without
 * fetching when the target is inside the loaded window, so a whole plan — the
 * demo, a fixture, anything compiled from a pasted URL — never took the branch
 * that planted the pointer. That is why the suite was green.
 *
 * Compared by *month*, not by year. This test run against the old decision
 * disagreed at all nine samples, by 18, 9, 9, 10, 12, 13, 18, 22 and 24
 * months — but six of those nine are within a calendar year of the hero, so a
 * year-granularity assertion would have passed on two thirds of the samples it
 * was written for. After the fix all nine land in the hero's own month, and so
 * do ten of ten on a wider sweep (`x/cap-diag.mjs`) and three of three on
 * Linux.
 *
 * Local packages only, and one engine. A streamed entry is 5,213 pages behind
 * a manifest, and the property under test is about the plan a window swap
 * assembles rather than about anything an engine draws differently.
 */
const WITHIN_MONTHS = 1;

/** The last date in a caption; an aggregate span carries two. */
function captionMonth(caption: string): number | null {
  const all = [...caption.matchAll(/(\d{4})-(\d{2})-\d{2}/g)];
  const last = all[all.length - 1];
  return last ? Number(last[1]) * 12 + Number(last[2]) - 1 : null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The hero reads "June2017" once the day is dropped on a multi-year history. */
function heroMonth(hero: string): number | null {
  const m = hero.match(/([A-Z][a-z]+)\s*(\d{4})/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!);
  return month < 0 ? null : Number(m[2]) * 12 + month;
}

for (const stem of ['kubernetes-kubernetes']) {
  test(`${stem}: every scrub is captioned with the moment it landed on`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'A streamed package is one engine; the caption walk is not engine-specific.');
    test.skip(!existsSync(`public/catalog/${stem}.pages/manifest.json`), 'Requires locally prepared catalog packages.');
    // Downloading and assembling 5,213 pages, ten times over.
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    await waitForReady(page);
    await page.getByTestId('catalog-cta').click();
    await page.getByTestId(`catalog-${stem}`).click();
    await page.getByTestId('scope-full').click();
    await page.waitForFunction((s) => window.__gittimeline.source?.slug.replace('/', '-') === s && window.__gittimeline.stats !== null, stem, { timeout: 300_000 });

    const rows: Array<{ at: string; hero: string; caption: string; months: number | null }> = [];
    for (const at of [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95]) {
      await page.evaluate((f) => {
        window.__gittimeline.pause();
        window.__gittimeline.seek(window.__gittimeline.duration * f);
      }, at);
      /**
       * Settled means "the plan in hand describes the clock", not "buffering
       * is false".
       *
       * `store.buffering` is recomputed in the frame loop, so the first ask
       * after a seek still returns the value from before it and a wait on
       * `buffering === false` falls straight through. That is not a nicety:
       * it left three of ten reads in `x/cap-diag.mjs` looking at the window
       * from the *previous* scrub, where the caption is correctly the best
       * that plan can offer and the disagreement is the loading state rather
       * than this defect. While a window is genuinely mid-flight the viewer is
       * told so, under "Loading this part of history...".
       */
      await page.waitForFunction(() => {
        const g = window.__gittimeline;
        const w = g.view?.window;
        return !g.buffering && !!w && g.time >= w.start - 8 && g.time < w.end + 8;
      }, null, { timeout: 300_000 });
      // Read once, immediately, which is what a visitor sees. Reading twice is
      // what hid this originally: the second read arrives after another window
      // has landed and re-run the walk.
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => ({
        hero: (document.querySelector('[data-testid="date-hero"]')?.textContent ?? '').trim(),
        caption: (document.querySelector('[data-testid="caption"]')?.textContent ?? '').trim(),
      }));
      const h = heroMonth(r.hero);
      const c = captionMonth(r.caption);
      rows.push({ at: `${Math.round(at * 100)}%`, hero: r.hero, caption: r.caption, months: h != null && c != null ? Math.abs(h - c) : null });
    }

    // A caption without a date in it cannot be compared, and a few of them
    // legitimately have none — "Present day — N live tips" is the plan's last
    // word and names no commit. Most of them must be datable, or this test is
    // asserting nothing while reporting a pass.
    const datable = rows.filter((r) => r.months != null);
    expect(datable.length, `captions carrying a date: ${JSON.stringify(rows.map((r) => ({ at: r.at, caption: r.caption.slice(0, 60) })))}`).toBeGreaterThanOrEqual(rows.length - 2);

    const disagreeing = datable.filter((r) => r.months! > WITHIN_MONTHS);
    expect(
      disagreeing.map((r) => `${r.at}: hero ${r.hero} vs caption ${r.caption.slice(0, 70)} (${r.months} months apart)`),
      'the caption and the hero describe the same moment',
    ).toEqual([]);
  });
}

/**
 * And the branch count is not computed on the plan for a different moment.
 *
 * `DateBar` counts `perf.threads` at `t`, and across a streamed seek those are
 * two different moments: `store.perf` holds the window for where the viewer
 * *was* until the new one lands, so every thread in it that merged between the
 * old time and the new one reads as closed and the number collapses. That is
 * the "3 branches open at 90% of Linux, down from 355 at 75% with 2,317 nodes
 * still resident" in `proposal-picture-and-claim.md` §7 — reproducible to the
 * digit by polling across the seek instead of after it, and not a bad count
 * but a count of the wrong moment.
 *
 * Measured on Kubernetes before the fix, polled every 150 ms from the seek:
 * 1 then 113 at 75%, **4 then 107 at 90%**, 15 then 72 at 95%. Linux is worse
 * because its swap is slower — 3 for 2.7 seconds and then 426.
 *
 * Asserted as "absent while the stage cannot draw the clock", which is the
 * fix, rather than as "never smaller than the settled value", which would
 * pass on a build that happened to collapse upwards.
 */
for (const stem of ['kubernetes-kubernetes']) {
  test(`${stem}: the branch count is absent until the plan describes the clock`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'A streamed package is one engine.');
    test.skip(!existsSync(`public/catalog/${stem}.pages/manifest.json`), 'Requires locally prepared catalog packages.');
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    await waitForReady(page);
    await page.getByTestId('catalog-cta').click();
    await page.getByTestId(`catalog-${stem}`).click();
    await page.getByTestId('scope-full').click();
    await page.waitForFunction((s) => window.__gittimeline.source?.slug.replace('/', '-') === s && window.__gittimeline.stats !== null, stem, { timeout: 300_000 });

    const bad: string[] = [];
    let sawBuffering = false;
    let sawSettledCount = 0;
    for (const at of [0.75, 0.9, 0.95]) {
      await page.evaluate((f) => {
        window.__gittimeline.pause();
        window.__gittimeline.seek(window.__gittimeline.duration * f);
      }, at);
      // Polled across the swap rather than after it, which is the whole point:
      // waiting for the plan to land is what hid this.
      for (let i = 0; i < 30; i++) {
        const r = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="open-threads"]');
          const g = window.__gittimeline;
          const w = g.view?.window;
          return {
            text: el ? (el.textContent ?? '').trim() : null,
            buffering: g.buffering,
            covered: !!w && g.time >= w.start - 8 && g.time < w.end + 8,
          };
        });
        if (r.buffering) {
          sawBuffering = true;
          if (r.text != null) bad.push(`${Math.round(at * 100)}%: "${r.text}" while the stage cannot draw the clock`);
        } else if (r.covered && r.text != null) sawSettledCount++;
        if (r.covered && !r.buffering && i > 6) break;
        await page.waitForTimeout(150);
      }
    }
    // Both halves have to have happened, or the assertion below is vacuous:
    // a build that never buffers has nothing to hide, and one that never
    // settles has nothing to show.
    expect(sawBuffering, 'a seek into an unloaded page does make the stage wait').toBe(true);
    expect(sawSettledCount, 'and the readout comes back once the plan covers the clock').toBeGreaterThan(0);
    expect(bad, 'the branch count is never computed on a plan for another moment').toEqual([]);
  });
}
