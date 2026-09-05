/**
 * Turn built artifacts into catalog entries.
 *
 *   node scripts/index-artifacts.mjs [--base URL] [--out DIR] [--open-seconds N]
 *                                    [--only SUBSTR,SUBSTR]
 *
 * `build-clone-dataset.mjs` writes each history and a small sidecar of facts
 * beside it. This assembles those into `index.json` and, for every one of them,
 * opens the artifact in a real browser — to prove it opens at all, to time how
 * long that takes, and to read off the three facts that only exist once a plan
 * has been composed: how long it runs, how many arrivals are in it, and how
 * those arrivals fall across the calendar.
 *
 * It used to capture a frame of the performance as well, and that picture was
 * the card. The argument for it was that a real frame is never an illustration.
 * The argument against it is what the frames look like at card size: a commit
 * graph is a wide, mostly horizontal texture, and a shelf of them is a shelf of
 * grey smears that says nothing about which project each one is. The card leads
 * with the owner's mark now — already downloaded here, for the glyph that used
 * to sit beside the title — so the capture is gone, and with it the twenty
 * minutes of software rasterising it cost on the largest entries.
 *
 * Those jobs are deliberately separate, and the order matters.
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
 * `plan` and `planBytes` come from the same open, and they are the answer to a
 * question the index used to get wrong by a wide margin: what does clicking
 * this cost? It used to answer with the size of the dataset, which stopped
 * being true the day plans began shipping precompiled. A plan is its own
 * download and is not reliably smaller than what it was composed from —
 * Kubernetes' 18 MB of history is a 30 MB plan — so a card quoting the dataset
 * was under-quoting most of the shelf and over-quoting the rest.
 *
 * Opening is a gate. An artifact that cannot be opened inside `--open-seconds`
 * is not a history anybody can watch, and listing it produces the worst thing
 * this catalog can do: a card that looks like all the others and then holds the
 * visitor's tab until they close it. Those are dropped, loudly.
 *
 * The owner's mark is a nice-to-have. Failing to fetch one costs the card its
 * picture — it falls back to the owner's initial set in the same plate — and
 * never the entry.
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
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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
// Not a budget for the picture — reading it is instant — but for the two
// frames drawn before it. Software rasterising is roughly linear in nodes, so
// Rust's quarter of a million cost about thirty-two seconds and Linux's third
// of a million rather more; four minutes leaves room for a machine slower than
// this one without letting a genuinely wedged tab sit here all afternoon.
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
 * which entry should be the largest thing on the page, and 1.5 million commits
 * of Linux is not a question ripgrep's two thousand can win.
 *
 * ripgrep lost the featured slot in that change and fell out of the list
 * entirely, which was not the same decision and was not meant. It is the
 * fastest thing here by an order of magnitude — half a second from click to
 * first frame — and a shelf whose cheapest entry is a two-and-a-half minute
 * download has nothing on it for somebody who only wants to see what this is.
 */
const SHIPPED = [
  { slug: 'torvalds/linux', title: 'Linux', blurb: 'The largest history there is, and the one worth watching whole.' },
  { slug: 'BurntSushi/ripgrep', title: 'ripgrep', blurb: 'A search tool grown by one author, then a community.' },
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

/**
 * A mark drawn by hand for this shelf, if there is one.
 *
 * The account avatar is the fallback and it is a poor one for a project that
 * has no organisation behind it: Linux has no GitHub org, so the shelf's
 * largest card fell back to `github.com/torvalds.png` and put a photograph of
 * a person's face on it. A penguin is what the project looks like to anyone
 * who has met it.
 *
 * These are checked in as SVGs beside the artifacts and they take precedence,
 * which is the whole point — this ran once already, fetched the avatars, and
 * quietly put the photograph back over a drawing that exists three files away.
 * A curated choice that a rebuild silently discards is not curated.
 */
const drawnMarks = readdirSync(outDir).filter((f) => f.startsWith('mark-') && f.endsWith('.svg'));
const drawnMarkFor = (slug) => {
  const [owner, repo] = slug.split('/');
  // Matched case-insensitively against the real directory listing, and the
  // name that comes back is the one on disk. `existsSync` would do the
  // matching too — on Windows, where it is case-insensitive — and hand back
  // the spelling that was asked for rather than the spelling that exists:
  // `mark-mdBook.svg` for a file called `mark-mdbook.svg`. That resolves
  // locally and 404s on Pages, which is the worst place for the difference to
  // first appear.
  for (const want of [`mark-${repo}.svg`, `mark-${owner}.svg`]) {
    const hit = drawnMarks.find((f) => f.toLowerCase() === want.toLowerCase());
    if (hit) return hit;
  }
  return null;
};

const logoFor = async (slug) => {
  const drawn = drawnMarkFor(slug);
  if (drawn) return drawn;
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
    // An avatar does not change, and this is the one fetch in the whole run
    // that leaves the machine. Two of eleven owners failed on a transient
    // `fetch failed` in a pass where the other nine came back fine, and
    // recording null for them would have taken two marks off the shelf on
    // account of a few seconds of somebody's Wi-Fi. What is already on disk is
    // from an earlier pass of this same script and is exactly what would have
    // been written now.
    const kept = existsSync(join(outDir, name));
    console.warn(`  ${owner}: logo not fetched (${err instanceof Error ? err.message : String(err)})${kept ? ' — keeping the one already on disk' : ''}`);
    // The thumbnail rule otherwise: this costs the card its mark, never the
    // entry. The card still carries the owner's name in monospace under the title.
    logoCache.set(owner, kept ? name : null);
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
  // An empty index is never an answer, only a symptom.
  //
  // `--base` defaults to a dev server that may not be running, and every entry
  // then fails to open with the same TypeError. That happened: a stale run
  // found nothing at :5173, dropped all twelve and wrote `{"entries": []}` over
  // a good index, so the shelf was simply gone — and nothing in the output said
  // so any louder than a list of drops nobody was reading. Refusing is the only
  // safe thing here, because the file it would overwrite is the product of an
  // hour of work this run cannot redo.
  if (!entries.length) {
    console.error(`
Refusing to write an empty ${indexPath}: nothing opened. Is a server running at ${base}?`);
    process.exitCode = 1;
    return;
  }
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
  let said;
  let nodes;
  let years;

  // Which of the two ways in the app took is not something to infer from what
  // happens to be on disk. The plan builder runs alongside this one, so a file
  // can appear between the check and the click; and a plan that is present can
  // still be declined for being a version behind, or for describing a length
  // this viewer did not ask for.
  //
  // The bytes are counted at the same time and for a related reason: what a
  // click pulls down stopped being the size of the artifact. A shipped plan is
  // its own download — for four of these it is *larger* than the dataset it
  // was composed from — and under eight megabytes the dataset is then fetched
  // a second time in the background to fill in the inspector.
  const planFile = file.replace(/\.gittimeline\.gz$/, '.gtperf.gz');
  let planServed = false;
  let planRefused = false;
  let transferred = 0;
  page.on('response', (res) => {
    if (!res.url().includes('/catalog/') || res.status() !== 200) return;
    if (res.url().endsWith(planFile)) planServed = true;
    transferred += Number(res.headers()['content-length'] ?? 0);
  });
  // `loadPrecompiledPlan` says this out loud exactly once, when a plan is
  // present and this build cannot read it. That is the failure worth catching:
  // a stale `.gtperf.gz` is served, downloaded in full, thrown away, and the
  // visitor then pays the compile they were supposed to have been spared.
  page.on('console', (msg) => {
    if (msg.text().includes('Precompiled performance could not be used')) planRefused = true;
  });

  // This one entry, served as though it were the whole shelf. It is what makes
  // the click above possible before the index the click is helping to write.
  await page.route('**/catalog/index.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        entries: [{ slug: spec.slug, title: spec.title, blurb: spec.blurb, scope: null, file, logo: null, bytes, commits: meta.commits }],
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
    // A card asks before it starts. Clicking one opens the scope chooser —
    // the whole history, or a range of years — and nothing loads until that
    // question is answered. This script is the only "visitor" that never
    // reads the question, so it has to answer it explicitly, and when it did
    // not it sat through the full open budget on every entry and then
    // reported that nothing opened. Twelve entries times fifteen minutes of
    // waiting for a dialog nobody was going to click.
    //
    // Always the whole history: the index is a description of the entry, and
    // the entry is the whole thing. The spans are cut from this same plan at
    // playback and cost nothing to offer, so there is nothing here to measure
    // about them.
    const chooser = page.getByTestId('scope-full');
    if (await chooser.isVisible({ timeout: 20_000 }).catch(() => false)) await chooser.click();
    // Wait for *this* repository, not merely for something to be loaded: the
    // landing demo is already playing behind the form, so anything that asks
    // whether a performance exists is answered yes before the click lands.
    await page.waitForFunction((s) => window.__gittimeline.source?.slug === s, spec.slug, { timeout: openBudget, polling: 250 });
    openSeconds = Number(((Date.now() - t0) / 1000).toFixed(1));
    const secs = await page.evaluate(() => window.__gittimeline.duration);
    // A performance of no length is not a performance, and writing a zero here
    // would put "0 s" on the card as though it were a measurement.
    durationSeconds = typeof secs === 'number' && secs > 0 ? Math.round(secs) : null;
    // Two more facts that only a loaded plan knows, off the open that is
    // happening anyway.
    //
    // `nodes` is the arrivals the choreography kept after routine pull requests
    // collapsed into ribbons, and against the duration it gives the pace — the
    // one number on a card that says whether a history can be *followed*. It
    // cannot be derived from the commit count: LLVM's 595,778 commits leave 894
    // arrivals and Rust's 339,084 leave 248,298.
    //
    // `years` is how long each calendar year of the plan runs, which is what
    // prices the span offered under every card. Also not derivable: the clock
    // gives every arrival the same beat, so a year's share of the running time
    // is its share of the commits and not its share of the calendar.
    const shape = await page.evaluate(() => ({ pace: window.__gittimeline.pace, years: window.__gittimeline.years }));
    nodes = typeof shape?.pace?.nodes === 'number' ? shape.pace.nodes : null;
    years = Array.isArray(shape?.years) && shape.years.length ? shape.years : null;
    // Which way in the app took, in the app's own words. A 200 for the
    // `.gtperf.gz` proves it was fetched and nothing more — the plan is
    // declined loudly when its engine or schema is a version behind, and
    // silently when the viewer has asked for a different length — so a build
    // that concluded "shipped plan" from the download alone would go on saying
    // so long after every visitor had started paying for the compile again.
    // These two sentences are the only place the app distinguishes them.
    said = await page
      .waitForFunction(() => document.querySelector('.toast')?.textContent || null, undefined, { timeout: 5000, polling: 100 })
      .then((h) => h.jsonValue())
      .catch(() => null);
  } catch (err) {
    // `page.close()` on a tab whose renderer has already died rejects, and an
    // unhandled rejection here would end the whole run on behalf of the one
    // entry that failed — which is exactly the coupling this script exists to
    // avoid everywhere else.
    await page.close().catch(() => {});
    drop(`${spec.slug}: DID NOT OPEN after ${((Date.now() - startedAt) / 1000).toFixed(0)}s of a ${openBudget / 1000}s budget — ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    continue;
  }

  await page.close().catch(() => {});

  // All three have to agree before this build will call an entry precompiled:
  // the file was served, the app did not complain about it, and the app said
  // it had one. Anything less and the card would promise a download that the
  // click does not actually take.
  const precompiled = planServed && !planRefused && /composed ahead of time/.test(said ?? '');
  if (planServed && !precompiled) {
    console.warn(`  ${spec.slug}: a plan was downloaded and NOT used — every visitor pays the compile. Rebuild it with build-performance.mjs.`);
  }

  const entry = {
    slug: spec.slug,
    title: spec.title,
    blurb: spec.blurb,
    scope: null,
    file,
    /**
     * The precompiled plan this click actually arrived through, and what it
     * weighs. Recorded so the card can say what opening it costs: the download
     * stopped being the dataset the day plans shipped, and for five of these
     * the plan is the larger of the two. Null where the entry still compiles
     * in the tab, which is the case the card has to warn about.
     *
     * Written for *description* only. `loadPrecompiledPlan` derives the
     * filename from the dataset rather than reading it from here, and must go
     * on doing so — that is what keeps indexing and precompiling from having
     * to happen in a particular order. An index written before a plan exists
     * is then stale about what a click costs, never about whether it works.
     */
    plan: precompiled ? planFile : null,
    planBytes: precompiled ? statSync(join(outDir, planFile)).size : null,
    logo,
    bytes,
    commits: meta.commits,
    merges: meta.merges ?? null,
    contributors: meta.contributors ?? null,
    refs: meta.refs ?? null,
    coverage: meta.coverage ?? 'exact',
    openSeconds,
    durationSeconds,
    nodes: nodes ?? null,
    years: years ?? null,
    builtAt: meta.builtAt ?? new Date().toISOString(),
  };
  entries.push(entry);
  writeIndex();
  console.log(
    `${spec.slug.padEnd(26)} ${String(entry.commits).padStart(9)} commits  ${(entry.bytes / 1e6).toFixed(1).padStart(6)} MB  ` +
      `${`${openSeconds}s`.padStart(7)} to open ${precompiled ? `from a ${(entry.planBytes / 1e6).toFixed(1)} MB plan` : 'by compiling here '}  ` +
      `${`${(transferred / 1e6).toFixed(1)} MB`.padStart(8)} pulled down  ` +
      `${`${durationSeconds ?? '?'}s`.padStart(6)} long  ` +
      `${(nodes && durationSeconds ? `${(nodes / durationSeconds).toFixed(1)}/s` : '?').padStart(6)}  ${years ? `${years.length} years` : 'no years'}`,
  );
}

await browser.close();
writeIndex();
console.log(`\n${entries.length} ${entries.length ? 'entries written' : 'entries — nothing written'}, ${entries.filter((e) => e.logo).length} with a mark, ${entries.filter((e) => e.years).length} offering years`);
for (const s of skipped) console.log(`  skipped — ${s}`);
