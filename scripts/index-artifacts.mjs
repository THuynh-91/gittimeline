/**
 * Turn built artifacts into catalog entries.
 *
 *   node scripts/index-artifacts.mjs [--base URL] [--out DIR] [--open-seconds N]
 *                                    [--shot-seconds N] [--only SUBSTR,SUBSTR]
 *
 * `build-clone-dataset.mjs` writes each history and a small sidecar of facts
 * beside it. This assembles those into `index.json` and, for every one of them,
 * opens the artifact in a real browser: first to prove it opens at all and to
 * time how long that takes, and then to capture a frame of the actual
 * performance for its card. The picture on a catalog card is never an
 * illustration — it is that repository, at a moment it really passed through.
 *
 * Those three jobs are deliberately separate, and the order matters.
 *
 * The counts come from the sidecar, which cannot be wrong about them. They were
 * once read back off the page after loading, which meant CPython, Kubernetes
 * and VS Code were each recorded as having 56 commits — the landing demo's
 * numbers, sampled before the artifact had finished loading.
 *
 * `durationSeconds` is the exception, and it has to be: how long the
 * performance runs is not a fact about the repository at all, it is a fact
 * about the plan composed from it. Nothing on disk knows it until something has
 * composed one. So it is read off `window.__gittimeline.duration` at the moment
 * the entry opens — the same open that is being timed anyway — and it is the
 * number the card leads with, because "how long am I committing to watch" is
 * the question a visitor is actually asking of a shelf of these.
 *
 * Opening is a gate. An artifact that cannot be opened inside `--open-seconds`
 * is not a history anybody can watch, and listing it produces the worst thing
 * this catalog can do: a card that looks like all the others and then holds the
 * visitor's tab until they close it. Those are dropped, loudly.
 *
 * A thumbnail is a nice-to-have. Failing to get one costs a hatched placeholder
 * on the card, not the entry. The owner's logo is fetched under the same rule.
 *
 * `openSeconds` is written into the index and shown on the card past twenty
 * seconds or so. It is a real measurement on real hardware, so it is only ever
 * as representative as the machine that ran the build — but the shape of it is
 * stable, because what makes an entry slow is its merge density rather than
 * anything about the network. Point `--base` at a production preview rather
 * than a dev server; an unbundled build reports a wait no visitor will have.
 *
 * That measurement is taken by *clicking the card*, not by calling a loader.
 * The two stopped being the same journey the day plans began shipping
 * precompiled: a `.gtperf.gz` beside a dataset means the click skips
 * compilation entirely, and `loadArtifact`, which is handed a URL and nothing
 * else, cannot know that. Timing the loader would have quietly gone on
 * reporting the wait the app no longer has. The catalog the card comes from is
 * served to the page from here — one entry, this one — so the click does not
 * have to wait for the index it is helping to write.
 *
 * Every repository here is *pre-fetched*, and that word is load-bearing: the
 * catalog page used to list these as "projects that need a GitHub token", and
 * once they ship with the site that sentence is simply false. Opening one costs
 * a download and no API requests at all.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const flag = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const base = flag('base', 'http://localhost:5173');
const outDir = resolve(flag('out', 'public/catalog'));
// Deliberately generous. This is a "does it open at all" gate, not a taste
// judgement about how long is too long — the card carries the measured number,
// so a visitor decides that for themselves before clicking. What has to be kept
// out is the entry that opens for nobody.
const openBudget = Number(flag('open-seconds', '1800')) * 1000;
const shotBudget = Number(flag('shot-seconds', '120')) * 1000;
const only = (flag('only', '') || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * The shipped catalog. The first entry is given the whole width of the page;
 * the rest are a shelf beneath it, smallest first.
 *
 * Only whole histories. A partial — one year of a repository, or a recent span
 * — belongs behind the scope chooser where the app can say plainly what was
 * left out; on a catalog card it reads as the repository itself, which is a
 * quiet lie about what you are watching.
 *
 * Linux leads because the featured slot is a poster, not a doorway. It used to
 * hold ripgrep on the reasoning that the widest card should be the quickest to
 * open and the easiest to take in — which was sound while the first card was
 * also the one the end-to-end suite clicked, and while Linux could not be
 * opened at all. Neither is true now: the suite picks the cheapest entry on the
 * shelf by name rather than the first one by position, and a plan that used to
 * be uncompilable in a browser is a download. What is left is a choice about
 * which single frame should be the largest thing on the page, and 1.5 million
 * commits of Linux is not a question ripgrep's two thousand can win.
 */
const SHIPPED = [
  { slug: 'torvalds/linux', title: 'Linux', blurb: 'The largest history there is, and the one worth watching whole.' },
  { slug: 'rust-lang/mdBook', title: 'mdBook', blurb: 'A steady, long-running tool with a small core team.' },
  { slug: 'facebook/react', title: 'React', blurb: 'A decade of a framework much of the web is built on.' },
  { slug: 'nodejs/node', title: 'Node.js', blurb: 'A runtime maintained in the open by a very large group.' },
  { slug: 'python/cpython', title: 'CPython', blurb: 'The reference implementation of Python, back to 1990.' },
  { slug: 'kubernetes/kubernetes', title: 'Kubernetes', blurb: 'Pull requests arriving faster than almost anything else here.' },
  { slug: 'microsoft/vscode', title: 'VS Code', blurb: 'An editor built on a weekly release rhythm, in public.' },
  { slug: 'tensorflow/tensorflow', title: 'TensorFlow', blurb: 'A research codebase that became infrastructure.' },
  { slug: 'rust-lang/rust', title: 'Rust', blurb: 'A language and its compiler, landed through a merge queue.' },
  { slug: 'llvm/llvm-project', title: 'LLVM', blurb: 'Compiler infrastructure with decades of contributors behind it.' },
  { slug: 'chromium/chromium', title: 'Chromium', blurb: 'Larger than Linux: nearly two million commits.' },
];

const fileOf = (slug) => `${slug.replace('/', '-')}.gittimeline.gz`;
const indexPath = join(outDir, 'index.json');

/**
 * The owner's avatar, downloaded here rather than linked from the card.
 *
 * Hotlinking would not merely be against the spirit of a catalog that costs
 * GitHub nothing — it would not render. The page ships
 * `img-src 'self' data: blob:`, so an `avatars.githubusercontent.com` URL is
 * refused by the browser before a request leaves it, and the failure is silent:
 * a broken image on the one page whose whole promise is that it asks for
 * nothing. Fetched once here, it is a local file like the thumbnail beside it.
 *
 * `github.com/<login>.png` and *not* `avatars.githubusercontent.com/<login>`,
 * which looks like it works and does not. That host keys on a numeric user id;
 * given a login it answers 200 with a generic identicon, so eight of the twelve
 * owners below came back byte-for-byte identical — the same grey placeholder
 * under eight different names. A wrong logo that renders is worse than no logo,
 * because nothing about it looks like a failure.
 *
 * 96px for a mark drawn at twenty: enough for a retina card, about 3 KB each.
 * These sit next to a real frame of the performance and are not allowed to cost
 * anything next to it.
 */
const LOGO_PX = 96;
// rust-lang owns two entries here, and an owner's avatar is fetched once for
// however many of its repositories are on the shelf.
const logoCache = new Map();
const logoFor = async (slug) => {
  const owner = slug.split('/')[0];
  if (logoCache.has(owner)) return logoCache.get(owner);
  const name = `logo-${owner}.png`;
  try {
    const res = await fetch(`https://github.com/${owner}.png?size=${LOGO_PX}`, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    // An error page is bytes too. Nothing this small is an avatar, and writing
    // it would put a file on disk that the card would then fail to draw.
    if (bytes.length < 256) throw new Error(`${bytes.length} bytes is not an avatar`);
    writeFileSync(join(outDir, name), bytes);
    logoCache.set(owner, name);
  } catch (err) {
    // The thumbnail rule again: this costs the card its mark, never the entry.
    // The card still carries the owner's name in monospace under the title.
    console.warn(`  ${owner}: no logo — ${err instanceof Error ? err.message : String(err)}`);
    logoCache.set(owner, null);
  }
  return logoCache.get(owner);
};

// `--only` rebuilds a few entries without spending twenty minutes on the rest,
// so the previous index is carried forward for everything it does not name.
let previous = new Map();
if (only.length && existsSync(indexPath)) {
  try {
    for (const e of JSON.parse(readFileSync(indexPath, 'utf8')).entries ?? []) previous.set(e.slug, e);
  } catch {
    previous = new Map();
  }
}

const browser = await chromium.launch({
  // Rust alone settles at 2.5 GB while it lays out a quarter of a million
  // nodes, and the two below it are several times that. The default heap is not
  // a budget these can be held to, and running out of it is a dead tab rather
  // than a slow one.
  args: ['--js-flags=--max-old-space-size=8192'],
});
const entries = [];
const skipped = [];

/**
 * Record a dropped entry, and say so at the moment it is dropped.
 *
 * Collecting these for the summary at the end was its own small lie: a run that
 * has been going for half an hour prints nothing at all when the entry it is on
 * fails, so an entry that died in ninety seconds and one that is still working
 * look identical from outside. Rust dropped out of a full pass exactly this
 * way, and the reason was not readable until the run that followed it had also
 * finished.
 */
const drop = (reason) => {
  skipped.push(reason);
  console.warn(`  DROPPED ${reason}`);
};

/**
 * Write `index.json` after every entry rather than once at the end.
 *
 * A full pass is the better part of an hour and spends almost all of it on the
 * last two entries, which are also the two most likely to take the tab down
 * with them: Linux and Chromium are a million nodes each. Accumulating in
 * memory until the final line would put eleven entries that had already been
 * opened, timed and photographed at the mercy of the twelfth. Written as it
 * goes, the worst an interruption costs is the entry it happened on.
 */
const writeIndex = () => {
  // In SHIPPED order rather than the order they happened to finish in, which is
  // what `--only` and every interrupted run would otherwise leave behind.
  const ordered = [...entries].sort((a, b) => SHIPPED.findIndex((s) => s.slug === a.slug) - SHIPPED.findIndex((s) => s.slug === b.slug));
  writeFileSync(indexPath, `${JSON.stringify({ entries: ordered }, null, 2)}\n`);
};

for (const spec of SHIPPED) {
  if (only.length && !only.some((o) => spec.slug.toLowerCase().includes(o))) {
    const kept = previous.get(spec.slug);
    if (kept) entries.push(kept);
    else drop(`${spec.slug}: not selected by --only and not in the previous index`);
    continue;
  }

  const file = fileOf(spec.slug);
  const path = join(outDir, file);
  if (!existsSync(path)) {
    skipped.push(`${spec.slug}: not built yet`);
    continue;
  }

  // Facts from the builder, which cannot be wrong about them. Without a sidecar
  // there is no honest way to say how big this history is, and a card that
  // cannot say what it is has no business being the thing you choose between.
  let meta = null;
  const metaPath = path.replace(/\.gittimeline\.gz$/, '.meta.json');
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      meta = null;
    }
  }
  if (typeof meta?.commits !== 'number') {
    drop(`${spec.slug}: no .meta.json — rebuild it with build-clone-dataset.mjs`);
    continue;
  }

  // Before the open rather than after it, because the open is the part that
  // takes half an hour and dies, and this is a two-kilobyte download.
  const logo = await logoFor(spec.slug);

  const bytes = statSync(path).size;
  const page = await browser.newPage({ viewport: { width: 1200, height: 420 } });
  page.setDefaultTimeout(30000);
  // Taken before the page is even loaded, so that a drop can report how long it
  // really lasted. An entry that dies in ninety seconds and one that exhausts a
  // thirty-minute budget are different failures and want different fixes.
  const startedAt = Date.now();
  let openSeconds;
  let durationSeconds;
  let poster = null;
  let posterBytes = 0;

  // Which of the two ways in the app took is not something to infer from what
  // happens to be on disk. The plan builder runs alongside this one, so a file
  // can appear between the check and the click; and a plan that is present can
  // still be declined for being a version behind, or for describing a length
  // this viewer did not ask for. A 200 for the `.gtperf.gz` is the app itself
  // answering, which is the only answer worth printing.
  //
  // The bytes are counted at the same time and for a related reason: what a
  // click pulls down stopped being the size of the artifact. A shipped plan is
  // its own download, larger than the dataset it was composed from, and under
  // thirty megabytes the dataset is then fetched a second time to fill in the
  // inspector. This is printed rather than indexed — `loadPrecompiledPlan` sets
  // out why `index.json` deliberately knows nothing about plans — but a build
  // that cannot say what a card costs has no business claiming it is cheap.
  const planFile = file.replace(/\.gittimeline\.gz$/, '.gtperf.gz');
  let precompiled = false;
  let transferred = 0;
  page.on('response', (res) => {
    if (!res.url().includes('/catalog/') || res.status() !== 200) return;
    if (res.url().endsWith(planFile)) precompiled = true;
    transferred += Number(res.headers()['content-length'] ?? 0);
  });

  // This one entry, served as though it were the whole shelf. It is what makes
  // the click above possible before the index the click is helping to write.
  await page.route('**/catalog/index.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        entries: [{ slug: spec.slug, title: spec.title, blurb: spec.blurb, scope: null, file, poster: null, logo: null, bytes, commits: meta.commits }],
      }),
    }),
  );

  try {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByTestId('catalog-link').click();
    const card = page.getByTestId(`catalog-${spec.slug.replace('/', '-')}`);
    await card.waitFor({ state: 'visible' });
    const t0 = Date.now();
    await card.click();
    // Wait for *this* repository, not merely for something to be loaded: the
    // landing demo is already playing behind the form, so anything that asks
    // whether a performance exists is answered yes before the click lands.
    await page.waitForFunction((s) => window.__gittimeline.source?.slug === s, spec.slug, { timeout: openBudget, polling: 250 });
    openSeconds = Number(((Date.now() - t0) / 1000).toFixed(1));
    const secs = await page.evaluate(() => window.__gittimeline.duration);
    // A performance of no length is not a performance, and writing a zero here
    // would put "0 s" on the card as though it were a measurement.
    durationSeconds = typeof secs === 'number' && secs > 0 ? Math.round(secs) : null;
  } catch (err) {
    // `page.close()` on a tab whose renderer has already died rejects, and an
    // unhandled rejection here would end the whole run on behalf of the one
    // entry that failed — which is exactly the coupling this script exists to
    // avoid everywhere else.
    await page.close().catch(() => {});
    drop(`${spec.slug}: DID NOT OPEN after ${((Date.now() - startedAt) / 1000).toFixed(0)}s of a ${openBudget / 1000}s budget — ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    continue;
  }

  try {
    // Everything except the stage comes off, or the card is a picture of the
    // interface rather than of the history.
    await page.addStyleTag({ content: '.rail,.band,.banner,.toast,.topbar,.follow-btn,.view-toggles,.prelude{display:none!important}' });

    // The widest parallel phrase is the moment the picture is most alive —
    // several threads open at once, trails lit, camera pulled back. The final
    // tableau is deliberately quiet and dim, which makes a near-black card.
    await page.evaluate(() => {
      const g = window.__gittimeline;
      const widest = g.events('PARALLEL_PHRASE').sort((a, b) => b.end - b.start - (a.end - a.start))[0];
      g.seek(widest ? widest.start + (widest.end - widest.start) * 0.6 : g.duration * 0.72);
      g.play();
    });
    await page.waitForTimeout(1100);
    // Then stopped, so the frame that gets read is a settled one.
    await page.evaluate(() => window.__gittimeline.pause());
    await page.waitForTimeout(350);

    // Read out of the canvas rather than photographed through the browser.
    //
    // `page.screenshot` and `locator.screenshot` both go through the
    // compositor, and the stage is a `desynchronized: true` 2D canvas — a
    // low-latency surface the compositor does not own in the ordinary way.
    // Below about forty thousand nodes that capture returns fine; above it, it
    // does not return at all. Kubernetes, at 125,973 nodes, sat through a
    // two-minute screenshot timeout and produced nothing, which is where six of
    // these thumbnails were being lost.
    //
    // `toDataURL` reads the backing store straight out of the canvas with no
    // compositor involved, so it costs the same on Chromium's 1.8 million
    // commits as it does on ripgrep's two thousand.
    //
    // JPEG, not PNG: the stage is a dark photographic gradient with fine
    // strokes over it, which PNG stores at ~220 KB a frame and JPEG at a
    // fraction of that with no visible difference at card size.
    const dataUrl = await Promise.race([
      page.evaluate(
        () =>
          new Promise((resolve) => {
            // Two frames, so what is read is a frame the renderer has finished
            // rather than one it is halfway through.
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const c = document.querySelector('[data-testid="stage-canvas"]');
                resolve(c instanceof HTMLCanvasElement ? c.toDataURL('image/jpeg', 0.82) : null);
              }),
            );
          }),
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`canvas read exceeded ${shotBudget / 1000}s`)), shotBudget)),
    ]);
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('stage canvas produced no image');
    const shot = Buffer.from(dataUrl.slice('data:image/jpeg;base64,'.length), 'base64');
    // A canvas that has been cleared but not drawn still encodes, to about a
    // kilobyte of flat black. That is a broken card wearing a picture, which is
    // worse than the hatched placeholder the card falls back to.
    if (shot.length < 3000) throw new Error(`frame is blank (${shot.length} bytes)`);
    poster = `${spec.slug.replace('/', '-')}.jpg`;
    writeFileSync(join(outDir, poster), shot);
    posterBytes = shot.length;
  } catch (err) {
    console.warn(`  ${spec.slug}: no thumbnail — ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  } finally {
    await page.close().catch(() => {});
  }

  const entry = {
    slug: spec.slug,
    title: spec.title,
    blurb: spec.blurb,
    scope: null,
    file,
    poster,
    posterBytes,
    logo,
    bytes,
    commits: meta.commits,
    merges: meta.merges ?? null,
    contributors: meta.contributors ?? null,
    refs: meta.refs ?? null,
    coverage: meta.coverage ?? 'exact',
    openSeconds,
    durationSeconds,
    builtAt: meta.builtAt ?? new Date().toISOString(),
  };
  entries.push(entry);
  writeIndex();
  console.log(
    `${spec.slug.padEnd(26)} ${String(entry.commits).padStart(9)} commits  ${(entry.bytes / 1e6).toFixed(1).padStart(6)} MB  ` +
      `${`${openSeconds}s`.padStart(7)} to open ${precompiled ? 'from a shipped plan' : 'by compiling here '}  ` +
      `${`${(transferred / 1e6).toFixed(1)} MB`.padStart(8)} pulled down  ` +
      `${`${durationSeconds ?? '?'}s`.padStart(6)} long  ${poster ? `${(posterBytes / 1024).toFixed(0)} KB jpg` : 'no thumbnail'}`,
  );
}

await browser.close();
writeIndex();
console.log(`\n${entries.length} entries written, ${entries.filter((e) => e.poster).length} with thumbnails`);
for (const s of skipped) console.log(`  skipped — ${s}`);
