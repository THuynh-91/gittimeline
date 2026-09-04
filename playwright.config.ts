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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The travel slider is a styled range input, which is the one control whose
    // furniture every browser draws differently, and the fallback ladder is the
    // other place engines disagree. Those two specs run everywhere so it is
    // verified rather than assumed; the rest would only triple CI for nothing.
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /(explore|fallback)\.spec\.ts/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /(explore|fallback)\.spec\.ts/ },
  ],
});
