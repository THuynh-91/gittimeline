/**
 * A user test, not a unit test: drive the real interface the way a person
 * would — paste the token into the landing page, type a repository, press Play,
 * watch it, and record what actually happened.
 *
 *   GD_TOKEN=$(gh auth token) node scripts/usertest.mjs owner/repo <outdir>
 *
 * The token is typed into the page and never appears in a URL or a screenshot.
 */
import { chromium } from '@playwright/test';

const repo = process.argv[2] ?? 'BurntSushi/ripgrep';
const out = process.argv[3] ?? 'scripts';
const base = process.env.GD_BASE ?? 'http://localhost:4173/';
const token = process.env.GD_TOKEN ?? '';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push('console: ' + m.text());
});
let api = 0;
page.on('request', (r) => {
  if (r.url().startsWith('https://api.github.com/')) api++;
});

// Instrument Web Audio so we can prove whether the score actually sounds.
await page.addInitScript(() => {
  const w = window;
  w.__audio = { contexts: 0, started: 0 };
  const Orig = window.AudioContext;
  window.AudioContext = class extends Orig {
    constructor(...a) {
      super(...a);
      w.__audio.contexts++;
      const co = this.createOscillator.bind(this);
      this.createOscillator = () => {
        const o = co();
        const os = o.start.bind(o);
        o.start = (...args) => {
          w.__audio.started++;
          return os(...args);
        };
        return o;
      };
    }
  };
});

const log = (...a) => console.log(...a);

await page.goto(base);
await page.waitForFunction(() => window.__gitdance);
log('landing loaded');

if (token) {
  await page.getByTestId('token-disclosure').click();
  await page.getByTestId('landing-token').fill(token);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  log('token entered through the landing page');
}

await page.getByTestId('url-input').fill(repo);
const t0 = Date.now();
await page.getByTestId('play-button').click();

try {
  await page.waitForFunction(() => window.__gitdance.stats !== null || !!document.querySelector('[role="alertdialog"]'), null, { timeout: 300000 });
} catch {
  log('TIMED OUT');
}
const loadMs = Date.now() - t0;
const alert = await page.locator('[role="alertdialog"]').textContent().catch(() => null);
if (alert) {
  log('ERROR CARD:', alert.replace(/\s+/g, ' ').slice(0, 240));
  await page.screenshot({ path: `${out}/user-error.png` });
  await browser.close();
  process.exit(1);
}

const stats = await page.evaluate(() => window.__gitdance.stats);
const dur = await page.evaluate(() => window.__gitdance.duration);
const badge = await page.locator('[data-testid="quality-badge"]').textContent();
log(`loaded ${repo} in ${(loadMs / 1000).toFixed(1)}s using ${api} API requests · coverage ${badge}`);
log(`  ${stats.commits} commits, ${stats.merges} merges, ${stats.threads} threads, up to ${stats.maxConcurrentThreads} at once`);
log(`  show is ${dur.toFixed(0)}s`);

// Watch it play for real, sampling as a viewer would experience it.
let frames = 0;
let lastHash = '';
let changed = 0;
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(900);
  const h = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="stage-canvas"]');
    if (!c) return '';
    const off = document.createElement('canvas');
    off.width = 120;
    off.height = 80;
    const g = off.getContext('2d');
    g.drawImage(c, 0, 0, 120, 80);
    const d = g.getImageData(0, 0, 120, 80).data;
    let x = 2166136261;
    for (let k = 0; k < d.length; k += 4) {
      x ^= d[k] + d[k + 1] + d[k + 2];
      x = Math.imul(x, 16777619);
    }
    return (x >>> 0).toString(16);
  });
  frames++;
  if (h !== lastHash) changed++;
  lastHash = h;
}
const audio = await page.evaluate(() => window.__audio);
const playing = await page.evaluate(() => ({ t: window.__gitdance.time, playing: window.__gitdance.playing }));
log(`  watched ${frames} samples over 9s: ${changed} distinct frames, playhead at ${playing.t.toFixed(1)}s, playing=${playing.playing}`);
log(`  audio: ${audio.contexts} context(s), ${audio.started} notes started`);

await page.evaluate(() => window.__gitdance.pause());
for (const [name, f] of [['a', 0.3], ['b', 0.6], ['c', 0.9]]) {
  await page.evaluate((x) => window.__gitdance.seek(window.__gitdance.duration * x), f);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/user-${name}.png` });
}
log('errors:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
