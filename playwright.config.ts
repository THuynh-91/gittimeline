import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  /**
   * Built here, and not reused.
   *
   * `vite preview` serves whatever happens to be in `dist`, and reusing a
   * server that is already listening skips the build entirely — so a run could
   * report a green suite against a build made hours ago from a different
   * commit. It did: a test for an API added minutes earlier failed with "not a
   * function" while type-checking and linting were clean, because :4173 was
   * still serving a colleague's build.
   *
   * The cost is one build per run, about ten seconds. A suite that does not
   * necessarily describe the source it was run against is worth less than
   * that.
   */
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  /**
   * Silence, at the audio output rather than in the app.
   *
   * The soundtrack is three recorded tracks and the demo autoplays, so a suite
   * run plays music out of the machine's speakers for as long as it lasts.
   * Muting through the app's own `muted` setting would be simpler and is not
   * available: `fallback.spec.ts` asserts that setting moving false -> true ->
   * false, so seeding it would be seeding the thing under test.
   *
   * These switches silence the output device. Measured with the element the
   * app actually uses — `new Audio()`, never in the document, so querying the
   * DOM for it finds nothing — the track plays at `volume` 0.354 on all three
   * engines regardless; Chromium and Firefox simply do not pass it to the
   * speakers. **WebKit has no equivalent switch and was therefore audible.**
   * It was being covered by a helper each spec had to remember to call, and
   * two of fifteen did — which held only until a spec that plays something was
   * added to the WebKit project.
   *
   * So the real silencing is a fixture: `tests/e2e/muted.ts`, imported instead
   * of `@playwright/test`. It forces native media volume to zero and mutes
   * playback on every engine, below the app, so the stored settings and the volume
   * control behave exactly as they always did. These two switches stay as
   * belt and braces.
   */
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--mute-audio'] } } },
    /**
     * The interaction, fallback, clock and mute checks run on every engine.
     *
     * The travel slider is a styled range input, the one control whose
     * furniture every browser draws differently. The fallback ladder is the
     * other place engines disagree. And the clock, because the defect it
     * guards — a slow frame costing the show real time — was measured at 0.41x
     * on WebKit and 0.49x on Firefox and never once reproduced on Chromium.
     * Covering it on the fast engine only would have been covering it nowhere.
     * The mute regression reads native media state because a getter that says
     * zero does not establish silence, especially on WebKit.
     */
    { name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: { 'media.volume_scale': '0.0' } } }, testMatch: /(explore|fallback|clock|muted|branch-overview)\.spec\.ts/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /(explore|fallback|clock|muted|branch-overview)\.spec\.ts/ },
  ],
});
