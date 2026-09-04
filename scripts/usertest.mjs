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
  w.__audio = { contexts: 0, started: 0, onsets: [] };
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
          // Attribute each start to its voice so crowding can be traced.
          const st = new Error().stack || '';
          const names = ['piano', 'harp', 'woodwind', 'strings', 'brass', 'bass', 'timpani', 'crescendo', 'cymbal'];
          let who = '?';
          for (const line of st.split(String.fromCharCode(10))) {
            const m = names.find((n) => line.includes(' ' + n + ' ') || line.includes('at ' + n));
            if (m) { who = m; break; }
          }
          w.__audio.onsets.push({ t: args[0] ?? this.currentTime, who });
          return os(...args);
        };
        return o;
      };
    }
  };
});

const log = (...a) => console.log(...a);

await page.goto(base);
await page.waitForFunction(() => window.__gittimeline);
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

// A large repository asks what span to fetch before spending anything. Answer
// it the way the argument says: GD_SCOPE=2021 for one year, otherwise the lot.
const scope = process.env.GD_SCOPE ?? '';
const chooser = page.getByTestId('scope-chooser');
if (await chooser.waitFor({ timeout: 45000 }).then(() => true).catch(() => false)) {
  if (scope) {
    log(`scope chooser: taking ${scope}`);
    await page.getByRole('button', { name: scope, exact: true }).click();
  } else {
    log('scope chooser: taking the full history');
    await page.getByTestId('scope-full').click();
  }
}

try {
  // The demo is already loaded behind the landing page, so waiting for "stats
  // is not null" would return instantly. Wait for this repository specifically.
  await page.waitForFunction(
    (want) => window.__gittimeline.source?.slug.toLowerCase() === want || !!document.querySelector('[role="alertdialog"]'),
    repo.toLowerCase(),
    { timeout: 600000 },
  );
} catch {
  log('TIMED OUT waiting for', repo);
}
const loadMs = Date.now() - t0;
const alert = await page.locator('[role="alertdialog"]').textContent().catch(() => null);
if (alert) {
  log('ERROR CARD:', alert.replace(/\s+/g, ' ').slice(0, 240));
  await page.screenshot({ path: `${out}/user-error.png` });
  await browser.close();
  process.exit(1);
}

const stats = await page.evaluate(() => window.__gittimeline.stats);
const dur = await page.evaluate(() => window.__gittimeline.duration);
const badge = await page.locator('[data-testid="quality-badge"]').textContent();
log(`loaded ${await page.evaluate(() => window.__gittimeline.source?.slug)} in ${(loadMs / 1000).toFixed(1)}s using ${api} API requests · coverage ${badge}`);
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
const playing = await page.evaluate(() => ({ t: window.__gittimeline.time, playing: window.__gittimeline.playing }));
log(`  watched ${frames} samples over 9s: ${changed} distinct frames, playhead at ${playing.t.toFixed(1)}s, playing=${playing.playing}`);
log(`  audio: ${audio.contexts} context(s), ${audio.started} notes started`);
{
  // Fuse onsets within 30ms the way the ear does, then report the spacing.
  const ATTACK = new Set(['piano', 'harp', 'woodwind', 'timpani', 'brass', 'cymbal']);
  const byT = new Map();
  for (const o of audio.onsets) {
    if (!ATTACK.has(o.who)) continue;
    const k = Math.round(o.t * 1000);
    if (!byT.has(k)) byT.set(k, new Set());
    byT.get(k).add(o.who);
  }
  const raw = [...byT.keys()].sort((a, b) => a - b);
  const on = [];
  for (const t of raw) if (!on.length || t - on[on.length - 1] >= 30) on.push(t);
  const gaps = on.slice(1).map((t, i) => t - on[i]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const span = on.length > 1 ? (on[on.length - 1] - on[0]) / 1000 : 0;
  if (on.length > 2) {
    log(`  spacing: ${(on.length / span).toFixed(1)} attacks/s · median gap ${sorted[Math.floor(sorted.length / 2)]}ms · under 80ms ${gaps.filter((g) => g < 80).length} · longest silence ${Math.max(...gaps)}ms`);
  }
}

await page.evaluate(() => window.__gittimeline.pause());
for (const [name, f] of [['a', 0.3], ['b', 0.6], ['c', 0.9]]) {
  await page.evaluate((x) => window.__gittimeline.seek(window.__gittimeline.duration * x), f);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/user-${name}.png` });
}
log('errors:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
