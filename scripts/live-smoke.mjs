// Live, read-only smoke test against the real GitHub API (few requests, rate-aware).
// Usage: node scripts/live-smoke.mjs [owner/repo]   (preview server must be running on :4173)
import { chromium } from '@playwright/test';
const repo = process.argv[2] ?? 'octocat/Hello-World';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const requests = [];
page.on('request', (r) => { if (r.url().startsWith('https://api.github.com/')) requests.push(r.url()); });
await page.goto(`http://localhost:4173/#repo=${repo}&autoplay=1`);
try {
  await page.waitForFunction(() => window.__gitdance && (window.__gitdance.stats !== null || document.querySelector('[role="alertdialog"]')), null, { timeout: 90_000 });
} catch { /* fall through to reporting */ }
const stats = await page.evaluate(() => window.__gitdance.stats);
const phase = await page.evaluate(() => window.__gitdance.phase);
const badge = await page.locator('[data-testid="quality-badge"]').textContent().catch(() => null);
const banner = await page.locator('.banner').textContent().catch(() => null);
const alert = await page.locator('[role="alertdialog"]').textContent().catch(() => null);
await page.waitForTimeout(2500);
await page.screenshot({ path: 'scripts/_live.png' });
console.log(JSON.stringify({ repo, phase, badge, stats, banner, alert, requests: requests.length, errors }, null, 1));
await browser.close();
