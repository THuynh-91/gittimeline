import { test as base, expect } from '@playwright/test';

/**
 * `test`, with the speakers off. Import it instead of `@playwright/test`.
 *
 * The soundtrack is three recorded tracks and the demo autoplays, so a suite
 * run plays music out of the machine's speakers for as long as it lasts. The
 * launch switches in `playwright.config.ts` cover Chromium (`--mute-audio`)
 * and Firefox (`media.volume_scale`); WebKit has no equivalent, so it was
 * being silenced by a helper — `silenceWebkit(page)` — that each spec had to
 * remember to call. Two of fifteen did.
 *
 * That held only because WebKit ran two specs, neither of which played
 * anything. Adding the clock tests to it broke the arrangement immediately:
 * they call `play()`, on the engine with no launch switch, from a spec that
 * did not know it had to ask. Which is the whole problem with a convention
 * that has to be remembered — it is followed until the day it matters.
 *
 * So it is a fixture. Every page gets it, on every engine, whether or not the
 * spec knows about audio.
 *
 * Below the app, deliberately. `el.volume` reports and applies zero and
 * nothing else changes: the app's own `muted` setting, the stored levels and
 * the volume control all behave exactly as they always did, which matters
 * because `fallback.spec.ts` asserts that setting moving false -> true ->
 * false and seeding it would be seeding the thing under test. The network is
 * untouched too, so `music/index.json` still answers and the track credit
 * still says what is playing.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
      Object.defineProperty(proto, 'volume', {
        configurable: true,
        get: () => 0,
        set: () => {
          /* refused */
        },
      });
    });
    await use(page);
  },
});

export { expect };
