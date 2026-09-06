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
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  /**
   * Silence, at the audio output rather than in the app.
   *
   * The soundtrack is three recorded tracks and the demo autoplays, so a suite
   * run — or any one-off probe — plays music out of the machine's speakers for
   * as long as it lasts. Muting through the app's own `muted` setting would be
   * simpler and is not available: `fallback.spec.ts` asserts that setting
   * moving false -> true -> false, so seeding it would be seeding the thing
   * under test. These switches work below the DOM: `el.volume` and the stored
   * settings behave exactly as they always did, and nothing comes out.
   *
   * WebKit has no equivalent launch switch, so it is muted a level up, by
   * refusing the audio files themselves — see `tests/e2e/helpers.ts`.
   */
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--mute-audio'] } } },
    // The travel slider is a styled range input, which is the one control whose
    // furniture every browser draws differently, and the fallback ladder is the
    // other place engines disagree. Those two specs run everywhere so it is
    // verified rather than assumed; the rest would only triple CI for nothing.
    { name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: { 'media.volume_scale': '0.0' } } }, testMatch: /(explore|fallback)\.spec\.ts/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /(explore|fallback)\.spec\.ts/ },
  ],
});
