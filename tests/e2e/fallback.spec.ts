import { expect, test } from './muted';
import { waitForReady, stageHash, silenceWebkit } from './helpers';

// WebKit takes no mute switch, so the soundtrack is refused rather than
// silenced. Chromium and Firefox are muted at the audio output in
// `playwright.config.ts` and load the music normally.
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'webkit') await silenceWebkit(page);
});

test.describe('fallbacks, accessibility and layouts', () => {
  test('poster renderer shows exact topology and a navigable event list', async ({ page }) => {
    await page.goto('/#demo=1&renderer=poster&t=20');
    await waitForReady(page);
    await expect(page.getByTestId('poster')).toBeVisible();
    await expect(page.getByTestId('poster')).toContainText('Static poster mode');
    const paths = await page.locator('[data-testid="poster"] svg path').count();
    expect(paths).toBeGreaterThan(10);
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => window.__gittimeline.time)).toBeGreaterThan(20);
    await expect(page.locator('.banner')).toContainText('Canvas rendering is unavailable');
  });

  test('reduced motion and no-flash keep meaning with calmer transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#demo=1&autoplay=1');
    await waitForReady(page);
    // The operating system preference is honoured without any control to find.
    const cam = await page.evaluate(() => window.__gittimeline.camera);
    expect(cam!.punch).toBe(1);
    const types = await page.evaluate(() => [...new Set(window.__gittimeline.events().map((e) => e.type))]);
    expect(types).toContain('MAJOR_MERGE');
    expect(types).toContain('DIVERGENCE');
    await page.getByTestId('settings-button').click();
    await page.getByTestId('no-flash-toggle').click();
    await expect(page.getByTestId('no-flash-toggle')).toHaveAttribute('aria-checked', 'true');
    await page.evaluate(() => window.__gittimeline.seek(5));
    await page.waitForTimeout(100);
    const a = await stageHash(page);
    await page.waitForTimeout(600);
    expect(await stageHash(page)).not.toBe(a);
  });

  test('keyboard-only operation: every control is reachable and labelled', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    const labels: string[] = [];
    for (let i = 0; i < 22; i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName : '';
      });
      labels.push(label);
    }
    expect(labels.filter(Boolean).length).toBeGreaterThan(10);
    expect(labels.some((l) => /Play|Pause/.test(l))).toBe(true);
    expect(labels.some((l) => /timeline/i.test(l))).toBe(true);
    // Every button has an accessible name.
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => !(b.getAttribute('aria-label') || b.textContent?.trim())).length);
    expect(unnamed).toBe(0);
    // The stage has an accessible summary and a live region exists.
    await expect(page.getByTestId('stage-canvas')).toHaveAttribute('aria-label', /commits/);
    expect(await page.locator('[aria-live="polite"]').count()).toBeGreaterThanOrEqual(1);
  });

  /**
   * Two of the three things a phone player got wrong, at 390x844 and 360x740.
   *
   * A first-time viewer on a phone reported three defects with three separate
   * causes. Two of them are here:
   *
   *  1. "The caption truncates to `formation · Ta...`". `.date-meta
   *     .caption-line` had `max-width: 60vw`, which is 234px of a 362px line —
   *     so the sentence explaining what just happened was given 65% of the
   *     room it had and clipped in the middle of a word.
   *  2. "The speed control is gone" — `.speed` was in the same
   *     `display: none` rule as `.icon-btn.optional`, which also took Help.
   *     Help is where the legend lives, so the only explanation of the picture
   *     was unreachable at this width rather than merely hidden.
   *
   * The third is the coverage pill wrapping to four lines and hanging off the
   * top of the screen, and it is in `catalog.spec.ts` rather than here: the
   * badge for a *synthetic* history is the single word "generated", which fits
   * on any screen, so this file cannot reach the case. It takes a real history
   * with a year range, which is what a catalog entry is.
   *
   * Both widths, because 390 is an iPhone and 360 is most of Android.
   */
  for (const size of [
    { width: 390, height: 844 },
    { width: 360, height: 740 },
  ]) {
    test(`the phone player fits its own chrome at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/#demo=1&autoplay=1');
      await waitForReady(page);
      // Somewhere with a caption in it. Measuring the empty caption at t=0
      // would report zero width whatever the stylesheet says, which is a pass
      // or a fail for the wrong reason depending on which way the assertion
      // points.
      await page.evaluate(() => window.__gittimeline.seek(12));
      await expect(page.getByTestId('caption')).not.toBeEmpty();

      // The caption gets a line of its own rather than 60% of a shared one.
      // Measured as a share of the band's inner width, so it does not depend
      // on how long any particular caption happens to be.
      const share = await page.evaluate(() => {
        const cap = document.querySelector('[data-testid="caption"]') as HTMLElement | null;
        const band = document.querySelector('.band') as HTMLElement | null;
        if (!cap || !band) return 0;
        const inner = band.clientWidth - parseFloat(getComputedStyle(band).paddingLeft) - parseFloat(getComputedStyle(band).paddingRight);
        return cap.getBoundingClientRect().width / inner;
      });
      expect(share, 'the caption has the width of the band, not 60vw of the window').toBeGreaterThan(0.9);

      // Speed, and the route to the explanation of the picture.
      await expect(page.locator('.speed'), 'playback speed is reachable on a phone').toBeVisible();
      const help = page.getByTestId('help-button');
      await expect(help, 'and so is Help, which is where the legend lives').toBeVisible();
      const hb = (await help.boundingBox())!;
      expect(hb.x, 'Help is not off the left').toBeGreaterThanOrEqual(-1);
      expect(hb.x + hb.width, 'Help is not off the right').toBeLessThanOrEqual(size.width + 1);
      await help.click();
      await expect(page.getByTestId('panel-help')).toContainText('Straight ivory line');
    });
  }

  test('mobile layout keeps the stage, timeline and controls usable without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto('/#demo=1&autoplay=1');
    await waitForReady(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByTestId('transport-play')).toBeVisible();
    await expect(page.getByTestId('timeline')).toBeVisible();
    const box = (await page.getByTestId('timeline').boundingBox())!;
    expect(box.width).toBeGreaterThan(300);

    /**
     * Every control in the top bar inside the window, checked directly.
     *
     * `scrollWidth - clientWidth` above cannot see this: `body` is
     * `overflow: hidden`, so content pushed past the right edge produces no
     * scrollable overflow and the measurement reads zero. Restoring the
     * repository name to this bar put `.icon-buttons` at x=369 with a width of
     * 114 in a 390px window — Settings entirely off-screen — and the only
     * symptom was the click below timing out after a minute while Playwright
     * reported the button visible, enabled and stable.
     */
    const width = page.viewportSize()!.width;
    for (const id of ['mute-button', 'settings-button']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.x, `${id} is not off the left`).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.width, `${id} is not off the right`).toBeLessThanOrEqual(width + 1);
    }

    await page.getByTestId('settings-button').click();
    await expect(page.getByTestId('panel-settings')).toBeVisible();
  });

  test('ultrawide layout and the final tableau', async ({ page }) => {
    await page.setViewportSize({ width: 2400, height: 700 });
    await page.goto('/#demo=1');
    await waitForReady(page);
    const dur = await page.evaluate(() => window.__gittimeline.duration);
    await page.evaluate((t) => window.__gittimeline.seek(t), dur - 0.2);
    await page.waitForTimeout(150);
    const cam = await page.evaluate(() => window.__gittimeline.camera);
    expect(cam!.state).toBe('tableau');
    await expect(page.getByTestId('caption')).toContainText('Present day');

    // And it is actually the whole picture, not merely labelled one.
    //
    // Reaching the state was the whole of this check, and the state was the
    // one part that worked: `camera.ts` writes the tail's frame from the
    // plan's bounds and the next few lines clamp it to `MAX_FRAME_W`, 2,600
    // world units, so the closing shot of a 15,936-unit demo was sixteen per
    // cent of it and the closing shot of mdBook was four. A test that asks
    // only for the name of the shot cannot tell those apart from the real
    // thing, which is why this went unnoticed through every run of this file.
    const shot = await page.evaluate(() => {
      const v = window.__gittimeline.view!;
      return { worldW: v.worldW, span: (v.geomMaxX ?? 0) - (v.geomMinX ?? 0) };
    });
    expect(shot.span, 'the demo has width to frame').toBeGreaterThan(1000);
    expect(shot.worldW / shot.span, 'the closing tableau frames the whole history').toBeGreaterThan(0.95);
  });

  test('gallery mode hides the chrome and loops', async ({ page }) => {
    await page.goto('/#demo=1&gallery=1');
    await waitForReady(page);
    await expect(page.locator('.app')).toHaveClass(/chrome-hidden/);
    expect(await page.evaluate(() => window.__gittimeline.playing)).toBe(true);
  });

  test('no console errors during a full run', async ({ page }, testInfo) => {
    // Long enough for an engine that composites in software.
    //
    // This waits for a thirty-second performance to finish, so it needs thirty
    // seconds of wall clock plus however far the engine is from real time —
    // and `dt` in the frame loop is clamped at 0.1s, so an engine under ten
    // frames a second advances the performance clock slower than the wall
    // clock and the show takes proportionally longer. Measured here at 1280x720,
    // deviceScaleFactor 2, after the renderer steps its resolution down:
    //
    //     chromium  60.1 fps  1.00x     webkit  5.5 fps  0.55x     firefox  15.3 fps  0.98x
    //
    // Chromium is given a GPU through ANGLE; the other two rasterise and
    // composite on the CPU in this harness, which a browser on a real machine
    // does not. So 0.55x is a fact about headless WebKit on a build server,
    // not about Safari — but it is a fact this test has to survive, and at the
    // default sixty seconds it did not: the run needed about fifty-five plus
    // load and timed out a few seconds short.
    //
    // The assertion is unchanged. What is under test is that a whole
    // performance plays without putting an error in the console, and that is
    // worth waiting for on the two engines whose console nothing else here
    // ever reads.
    if (testInfo.project.name !== 'chromium') testInfo.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/#demo=1&autoplay=1&dur=30');
    await waitForReady(page);
    await page.waitForFunction(() => !window.__gittimeline.playing && window.__gittimeline.time > 5, null, { timeout: 150_000 });
    expect(errors).toEqual([]);
  });

  test('the stage can be cleared, and the controls that clear it stay reachable', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    // The ledger prints commits as they land, so there has to be something in
    // it before it exists at all.
    await page.evaluate(() => window.__gittimeline.seek(12));
    await expect(page.getByTestId('commit-rail')).toBeVisible();
    await expect(page.locator('.band')).toBeVisible();

    // These two live at the bottom of a screen whose bottom 150px is the
    // transport band. Sitting inside it made them unclickable.
    await page.getByTestId('toggle-rail').click();
    await expect(page.getByTestId('commit-rail')).toHaveCount(0);

    await page.getByTestId('toggle-controls').click();
    await expect(page.getByTestId('timeline')).toHaveCount(0);
    await expect(page.getByTestId('transport-play')).toHaveCount(0);

    // But not your place in the history: the date says where you are, and the
    // travel slider is the only way to move once the performance is over.
    await expect(page.getByTestId('date-hero')).toBeVisible();

    // A control that hides itself along with what it hides is a trap.
    await expect(page.getByTestId('view-toggles')).toBeVisible();
    await page.getByTestId('toggle-controls').click();
    await expect(page.getByTestId('timeline')).toBeVisible();
  });

  test('music volume is reachable, and survives the controls being hidden', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    await expect(page.getByTestId('volume')).toBeVisible();

    const level = () => page.evaluate(() => JSON.parse(localStorage.getItem('gittimeline.settings.v1') ?? '{}'));
    await page.getByTestId('volume-range').fill('30');
    await expect.poll(async () => (await level()).effectsLevel).toBeCloseTo(0.3, 2);

    // Dragging to zero mutes, and the mute button restores the level you were
    // at rather than costing you the setting.
    await page.getByTestId('volume-range').fill('0');
    await expect.poll(async () => (await level()).muted).toBe(true);
    await page.getByTestId('mute-button').click();
    await expect.poll(async () => (await level()).muted).toBe(false);
    await expect.poll(async () => (await level()).effectsLevel).toBeCloseTo(0.3, 2);

    // It lives with the view toggles because someone watching with the
    // transport cleared still needs to turn the music down.
    await page.getByTestId('toggle-controls').click();
    await expect(page.getByTestId('timeline')).toHaveCount(0);
    await expect(page.getByTestId('volume')).toBeVisible();
  });

  /**
   * One mute control, and no emoji among the drawn icons.
   *
   * A first-time viewer reported "two separate mute controls, and a `🔊` emoji
   * sitting among otherwise hand-drawn icons". Both were true: the top bar's
   * speaker and the band's `.vbtn.icon` toggled the same boolean, and the
   * second one was rendered as a system emoji at whatever weight the machine's
   * font happened to have, beside 1.7px stroked paths.
   *
   * The top bar's is the one that stays, because it is the one `M` presses and
   * the one drawn in the same hand as its neighbours. Nothing is lost: the
   * slider still mutes at zero and unmutes on the way back up.
   */
  test('there is one mute control, and no emoji in the chrome', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);

    const muteControls = await page.evaluate(() =>
      [...document.querySelectorAll('button')].filter((b) => /\b(un)?mute\b/i.test(b.getAttribute('aria-label') ?? '')).map((b) => b.getAttribute('data-testid') ?? b.className),
    );
    expect(muteControls, 'exactly one control mutes the music').toEqual(['mute-button']);

    // Every glyph in the chrome is drawn by us. Emoji presentation ranges,
    // rather than a list of the two that were here, because the next one would
    // be a different codepoint. `️` is checked on its own rather than
    // inside the class: a variation selector *combines* with the character
    // before it, which is precisely what `no-misleading-character-class`
    // exists to stop being written into a set.
    const emoji = await page.evaluate(() => {
      const bad: string[] = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const t = n.textContent ?? '';
        if (/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|\u{FE0F}/u.test(t)) bad.push(t.trim().slice(0, 40));
      }
      return bad;
    });
    expect(emoji, 'the player chrome is drawn, not typeset in emoji').toEqual([]);
  });

  /**
   * The key to the picture, which used to be opt-in and on a phone absent.
   *
   * Measured on a first-time viewer: "I'd watched ninety seconds of unexplained
   * wobbling before I found it, and only because I clicked every icon in the
   * bar." The legend was a `<dl>` inside the Help panel behind a `?` that is
   * `display: none` under 720px.
   *
   * So it opens itself once, and the test is that it opens itself *once*: a key
   * that came back on every history would be the nag this is trying not to be.
   */
  test('the key to the picture opens itself once, and comes back when asked', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);

    const strip = page.getByTestId('stage-key');
    await expect(strip, 'a first-time viewer is shown the key without asking').toBeVisible();
    // The marks, not a paragraph about them.
    for (const label of ['the main line', 'a real branch', 'a person', 'a merge', 'not loaded']) {
      await expect(strip).toContainText(label, { ignoreCase: true });
    }
    expect(await strip.locator('svg').count(), 'each entry is the mark itself, drawn').toBeGreaterThanOrEqual(5);

    await page.getByTestId('stage-key-close').click();
    await expect(strip).toHaveCount(0);
    await expect
      .poll(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('gittimeline.settings.v1') ?? '{}'))).seenStageKey)
      .toBe(true);

    // Back on request, from Settings.
    //
    // It was a KEY pill in the band, and the owner asked for it to go: "I like
    // the key, but keep it hidden in the setting, not an actual button." The
    // showing-itself-once is the part that mattered and it stays; a permanent
    // third pill competing with the picture for the rest of the show does not.
    await page.getByTestId('settings-button').click();
    await page.getByTestId('key-toggle').click();
    await expect(strip).toBeVisible();
    await page.getByTestId('key-toggle').click();
    await expect(strip).toHaveCount(0);
    await page.keyboard.press('Escape');

    // And no pill on the stage at any width, which is the thing that was asked
    // for and would otherwise creep back.
    await expect(page.getByTestId('toggle-key')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('toggle-key')).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 720 });

    // And not again by itself, on this history or the next one.
    await page.reload();
    await waitForReady(page);
    await expect(page.getByTestId('stage-key'), 'a returning viewer is not shown it again').toHaveCount(0);
  });

  /**
   * The scrubber tooltip, no longer talking to itself.
   *
   * A first-time viewer: "the scrubber tooltip prints raw pairs — `merge:
   * merge` and `present: present` beside legitimate ones like `tag: v0.5.1`".
   * `events.ts` writes `kind: 'merge', label: 'merge'` and `kind: 'present',
   * label: 'present'`, and `tooltipAt` printed `${kind}: ${label}` for all
   * three kinds without noticing that two of them say the same word twice.
   */
  test('the scrubber names a landmark once', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    const strip = page.getByTestId('timeline');
    const box = (await strip.boundingBox())!;

    // Swept across the whole strip, because which pixel column holds a merge
    // is a fact about the demo's choreography and not something to hard-code.
    const seen = new Set<string>();
    for (let i = 1; i < 40; i++) {
      await strip.hover({ position: { x: (box.width * i) / 40, y: box.height / 2 } });
      for (const line of await page.locator('.timeline .tip .dim').allInnerTexts()) seen.add(line.trim());
    }

    const lines = [...seen];
    expect(lines.some((l) => /merge/i.test(l)), `landmarks appear at all; saw ${JSON.stringify(lines.slice(0, 12))}`).toBe(true);
    // The general form, not the two instances: any `x: x` is the same defect.
    const doubled = lines.filter((l) => /^([a-z]+):\s*(.*\b)?\1\b/i.test(l));
    expect(doubled, 'no landmark is named twice in one line').toEqual([]);
  });

  /**
   * The landing page's second action offers something, rather than reporting a
   * state.
   *
   * It read **"Selection ready to watch →"**. A first-time viewer: *"I clicked
   * it because it was the only thing left, not because it offered me
   * anything."* "Selection" is this project's own word for its shelf and means
   * nothing to somebody who has never seen it — it could as easily be about a
   * text cursor — and "ready to watch" is a status line, not an invitation.
   *
   * Asserted as a shape rather than as a string: it has to start with a verb
   * addressed to the reader, and it may not be the old noun phrase. Anything
   * that satisfies both is a better button than the one that was there.
   */
  test('the way to the shelf offers something rather than reporting a state', async ({ page }) => {
    await page.goto('/');
    const cta = page.getByTestId('catalog-cta');
    await expect(cta).toBeVisible();
    const label = (await cta.innerText()).replace(/\s+/g, ' ').trim();
    expect(label, `the button reads "${label}"`).toMatch(/^watch\b/i);
    expect(label, 'and not the status line it used to be').not.toMatch(/^selection/i);
    await cta.click();
    await expect(page.getByTestId('catalog-page')).toBeVisible();
  });

  /**
   * A running show has a way out that is not the landing page.
   *
   * "No way back to the shelf from a running show. 'Back to start' is the only
   * exit and it lands on the landing page." The demo did not come off the
   * shelf, so here the exit goes where the wordmark went; `catalog.spec.ts`
   * covers the case where there is a shelf to return to.
   */
  test('a running show has a labelled way out', async ({ page }) => {
    await page.goto('/#demo=1');
    await waitForReady(page);
    const back = page.getByTestId('player-back');
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute('aria-label', /back to/i);
    await back.click();
    await expect(page.getByTestId('url-input')).toBeVisible();
  });
});
