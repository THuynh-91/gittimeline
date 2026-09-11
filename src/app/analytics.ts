/**
 * Google Analytics, and the rule that decides what is allowed to leave.
 *
 * This site's promise is that repository data never leaves the browser, and
 * the sign-in page states it as architecture rather than as policy: there is
 * no server of ours for anything to be sent to. An analytics endpoint puts one
 * back. So this module is the entirety of it — nothing else in `src/` touches
 * `gtag` or `dataLayer` — and everything it measures is a fact about the
 * *site*: how many people arrived, which pages they saw, which of the shipped
 * histories they opened, how often a performance was started.
 *
 * ## The allowlist, and why it is not a blocklist
 *
 * The one thing worth getting right is which repository names may be
 * transmitted. The answer is: only names this build already publishes. The
 * shipped catalog (`public/catalog/index.json`) lists public repositories that
 * anyone can download from this origin, so naming one in an event discloses
 * nothing the page did not already say aloud.
 *
 * Everything else — anything a visitor pasted, anything they imported from a
 * file — is reported as a *shape*: "a public repository", plus a coarse
 * commit-count bucket. Never `owner/name`.
 *
 * The direction matters more than the mechanism. A blocklist ("don't send
 * anything that looks private") fails open: every case nobody anticipated goes
 * out. An allowlist fails closed, and it fails closed exactly where the risk
 * is highest — a catalog that did not load leaves the list empty, so nothing
 * at all is named, and a private repository can never be on the list because a
 * private repository can never be shipped from this origin.
 *
 * One more turn of the same screw: a matched name is emitted using the
 * *catalog's* spelling rather than the visitor's. A string somebody typed is
 * never transmitted, even in the case where it happens to be correct.
 *
 * ## The URL is not safe to send either
 *
 * GA4 attaches `page_location` to every hit and fills it from `location.href`
 * unless it is given one. On this site the fragment is the router — a share
 * link is `#repo=owner/name` — so the default behaviour would ship a pasted
 * repository to Google on the very first pageview, and no amount of care over
 * event parameters would matter. Page views are therefore sent by hand
 * (`send_page_view: false`) against an origin-and-path location that carries
 * neither query nor fragment, and `planEvent` re-sanitizes it rather than
 * trusting its caller.
 *
 * ## When nothing is sent at all
 *
 * - `VITE_GA_ID` unset. That is local development, CI, and any fork that has
 *   not asked for analytics: no script is loaded, no cookie is set, no request
 *   is made, and every `track*` call below returns immediately.
 * - Do Not Track, or `navigator.globalPrivacyControl`. Both are a request not
 *   to be measured, and nothing here is important enough to argue with one.
 */

import { catalogUrl } from './catalogLocation';

// A route name and nothing else — never a repository, never a slug. `repos` is
// the page listing the signed-in viewer's own repositories; that a person
// looked at their own list is not a disclosure, and no name from it is sent.
export type PageView = 'landing' | 'player' | 'catalog' | 'signin' | 'repos';

/**
 * Where a performance came from, which is what decides how much may be said
 * about it.
 *
 * `repository` is a history read live from the public GitHub API. `artifact`
 * is a file: either one of ours, fetched from the catalog, or one a visitor
 * dropped in — and those two are told apart by the allowlist rather than by a
 * flag, because "is this one of the histories we ship" is the same question
 * the allowlist already answers.
 */
export type PerformanceSource = 'repository' | 'artifact' | 'demo' | 'fixture' | 'private';

export type AnalyticsEvent =
  | { kind: 'page_view'; view: PageView }
  | { kind: 'catalog_open'; slug: string; commits: number | null }
  | { kind: 'performance_start'; source: PerformanceSource; slug: string | null; commits: number | null }
  | { kind: 'sign_in' };

export interface PlannedEvent {
  name: string;
  params: Readonly<Record<string, string>>;
}

/** Nameable repositories, keyed by their lower-cased slug, valued by the catalog's own spelling. */
export type Allowlist = ReadonlyMap<string, string>;

/**
 * What an off-catalog repository is called on the wire.
 *
 * The words are a claim, and the claim is only true while this app cannot read
 * a private repository at all: sign-in requests zero scopes (see `auth.ts`),
 * and the anonymous API answers 404 for anything not public. The day private
 * repositories are supported, this constant and the bucket beside it are the
 * lines that have to change — a private history may contribute that something
 * was watched and nothing else, not even its size.
 */
const OFF_CATALOG = 'a public repository';

/**
 * A private history contributes that something was watched. Nothing else.
 *
 * Not even its size: `commit_bucket` is a coarse number, but a coarse number
 * attached to a private repository is a fingerprint of it, and the whole
 * argument for sending anything at all is that nothing sent can be traced to
 * a repository somebody chose not to publish.
 */
const PRIVATE = 'a private repository';

/**
 * And what a file the visitor supplied is called.
 *
 * A `.gittimeline` artifact can be anything, including a private history
 * somebody exported, so it gets no name and no bucket. Its size would be a
 * fact about a repository we know nothing about.
 */
const IMPORTED = 'an imported history';

/* ---------------- the pure part: what an event is allowed to say ---------------- */

/** `owner/name`, both parts within GitHub's own character set and length. */
const SLUG = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

/**
 * Turn a list of catalog slugs into the allowlist.
 *
 * `index.json` is a build output rather than visitor input, but this is the
 * last gate before a string leaves the browser, so the shape is checked rather
 * than assumed. A malformed or over-long entry is dropped, not truncated: a
 * name that cannot be verified is a name that is not sent.
 */
export function buildAllowlist(slugs: Iterable<string>): Allowlist {
  const map = new Map<string, string>();
  for (const slug of slugs) if (typeof slug === 'string' && SLUG.test(slug)) map.set(slug.toLowerCase(), slug);
  return map;
}

/**
 * How big a history is, coarsely enough that the answer identifies nothing.
 *
 * Powers of ten, because the question analytics can usefully answer is "are
 * people bringing small projects or large ones", and any finer resolution is
 * a fingerprint rather than a measurement.
 */
export function commitBucket(commits: number | null): string | null {
  if (commits == null || !Number.isFinite(commits)) return null;
  if (commits < 100) return 'under 100';
  if (commits < 1_000) return '100–1k';
  if (commits < 10_000) return '1k–10k';
  if (commits < 100_000) return '10k–100k';
  if (commits < 1_000_000) return '100k–1M';
  return 'over 1M';
}

/**
 * A URL with everything but the origin and the path taken off.
 *
 * The fragment is the whole reason this exists: `#repo=owner/name`,
 * `#tip=<sha>` and `#fixture=…` are all in it, and GA4 would send the lot.
 * The query goes too — this app does not use it, so anything found there
 * arrived from somewhere else and is not ours to forward.
 */
export function safePageLocation(href: string): string {
  if (!href) return '';
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    // Not a URL we can take apart is not a URL we send.
    return '';
  }
}

/** What may be said about the repository behind an event, if anything. */
function repositoryParams(source: PerformanceSource, slug: string | null, commits: number | null, allow: Allowlist): Record<string, string> {
  // Synthetic histories are not repositories. The demo and the fixture corpus
  // are built in the browser out of a script in this repository; there is no
  // owner, no name and nothing to protect.
  if (source === 'demo' || source === 'fixture') return {};

  if (source === 'private') return { repository: PRIVATE };

  const named = slug ? allow.get(slug.toLowerCase()) : undefined;
  if (named) {
    const bucket = commitBucket(commits);
    return bucket ? { repository: named, commit_bucket: bucket } : { repository: named };
  }

  // Not in the catalog. What is left depends on how much we can honestly claim
  // to know: a live read from the public API is public by construction, a file
  // somebody handed us is not.
  if (source === 'artifact') return { repository: IMPORTED };
  const bucket = commitBucket(commits);
  return bucket ? { repository: OFF_CATALOG, commit_bucket: bucket } : { repository: OFF_CATALOG };
}

/**
 * Turn an event into exactly the payload that will be transmitted.
 *
 * Pure, and it takes the allowlist as an argument rather than reading module
 * state, so the tests exercise the real decision instead of a rehearsal of it.
 * Everything that leaves this application passes through here.
 */
export function planEvent(event: AnalyticsEvent, allow: Allowlist, href: string): PlannedEvent {
  const page_location = safePageLocation(href);
  switch (event.kind) {
    case 'page_view':
      return { name: 'page_view', params: { page_location, view: event.view } };
    case 'catalog_open':
      // A card on the shelf is a history this build publishes, so it is public
      // whether or not the allowlist has finished loading — which is why this
      // is not `'artifact'`. The allowlist still decides whether it is named;
      // all `'repository'` changes is what it falls back to if it is not.
      return { name: 'catalog_open', params: { page_location, ...repositoryParams('repository', event.slug, event.commits, allow) } };
    case 'performance_start':
      return { name: 'performance_start', params: { page_location, source: event.source, ...repositoryParams(event.source, event.slug, event.commits, allow) } };
    case 'sign_in':
      /**
       * How many, and nothing else.
       *
       * No parameters at all -- not `page_location`, which every other event
       * here carries. The question this answers is "did anyone sign in", and
       * the count of a bare event answers it completely. Anything more would
       * be describing the account that signed in, which is not the question
       * and is not this application's to send.
       *
       * That includes which route they used. The OAuth round trip and a
       * hand-pasted token are both somebody signing in, and separating them
       * would say something about how a particular person chose to do it.
       */
      return { name: 'sign_in', params: {} };
  }
}

/* ---------------- consent, configuration ---------------- */

/** The parts of `navigator` that carry a refusal, so this can be tested without one. */
export interface PrivacySignals {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
  msDoNotTrack?: string | null;
}

/**
 * Whether the visitor has asked not to be measured.
 *
 * Three spellings because three eras of browser: `navigator.doNotTrack`,
 * `window.doNotTrack` (Safari's old placement) and `navigator.msDoNotTrack`.
 * Global Privacy Control is the current one and is a boolean. Any of them
 * saying yes is a no.
 */
export function privacyRefused(nav: PrivacySignals, win: { doNotTrack?: string | null }): boolean {
  if (nav.globalPrivacyControl === true) return true;
  const dnt = nav.doNotTrack ?? win.doNotTrack ?? nav.msDoNotTrack;
  return dnt === '1' || dnt === 'yes';
}

/**
 * A GA4 measurement id.
 *
 * It comes from the build environment and is interpolated into a script URL,
 * so the shape is verified rather than trusted. An unset variable also arrives
 * here as the literal string `undefined` often enough to be worth failing on.
 */
export function isMeasurementId(id: string): boolean {
  return /^G-[A-Z0-9]{4,20}$/.test(id);
}

/* ---------------- the impure part: the transport ---------------- */

declare global {
  interface Window {
    dataLayer?: unknown[];
    /**
     * Do Not Track, as older Safari and Internet Explorer exposed it. The
     * current spelling is `navigator.doNotTrack`, which the DOM library
     * already types; this one it does not, and a signal the browser is still
     * sending is not one to ignore because the type definitions moved on.
     */
    doNotTrack?: string | null;
  }
}

let started = false;
let enabled = false;
/** Null until the catalog has been read; every event waits for it rather than guessing. */
let allowlist: Allowlist | null = null;
const waiting: AnalyticsEvent[] = [];
/**
 * How many events may wait for the allowlist.
 *
 * The wait is one fetch of a file the page is about to request anyway, so this
 * is only a guard against an allowlist that never resolves — a load that hangs
 * must not turn into an array that grows for the life of the tab.
 */
const MAX_WAITING = 50;

export function analyticsEnabled(): boolean {
  return enabled;
}

/**
 * Start measuring, if this build is configured to and the visitor has not
 * refused.
 *
 * Called once, from `main.tsx`, before anything renders — early enough that
 * the first page view is not lost, and outside the controller so that the
 * application's orchestration has no opinion about analytics existing.
 */
export function initAnalytics(): void {
  if (started) return;
  started = true;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const id = String(import.meta.env.VITE_GA_ID ?? '');
  if (!isMeasurementId(id)) return;
  if (privacyRefused(navigator, window)) return;

  enabled = true;
  void readCatalogAllowlist();
  install(id);
}

export function trackPageView(view: PageView): void {
  emit({ kind: 'page_view', view });
}

/**
 * A card on the shelf was clicked.
 *
 * Separate from `performance_start` because the two answer different
 * questions: this is what people chose, that is what they got. Chromium is 222
 * megabytes, and the gap between the click and the first frame is the most
 * useful thing this catalog could learn about itself.
 */
export function trackCatalogOpen(slug: string, commits: number | null): void {
  emit({ kind: 'catalog_open', slug, commits });
}

/** A performance was loaded into the player and began. */
export function trackPerformanceStart(source: PerformanceSource, slug: string | null, commits: number | null): void {
  emit({ kind: 'performance_start', source, slug, commits });
}

/**
 * Somebody signed in. A count, and nothing else; see `planEvent`.
 *
 * Called from both routes a token can arrive by -- the OAuth return in
 * `auth.ts` and a pasted token in `SignIn.tsx` -- because both are a person
 * signing in. It cannot double-count a returning visitor: the token is never
 * written to storage, so there is no session to restore and every sign-in is
 * a fresh act.
 */
export function trackSignIn(): void {
  emit({ kind: 'sign_in' });
}

function emit(event: AnalyticsEvent): void {
  if (!enabled) return;
  if (!allowlist) {
    if (waiting.length < MAX_WAITING) waiting.push(event);
    return;
  }
  send(planEvent(event, allowlist, location.href));
}

function send(planned: PlannedEvent): void {
  push('event', planned.name, planned.params);
}

/**
 * Read the shipped catalog, which is the allowlist.
 *
 * Deliberately its own fetch rather than a value handed in by the component
 * that renders the shelf. A call site that forgets to seed the list would fail
 * *open* under any other arrangement, and the browser has this file cached by
 * the time either of them asks for it.
 *
 * Every failure ends in an empty list, so a catalog that could not be read
 * means nothing is named — which is the same answer as "this build ships no
 * catalog", and the right one in both cases.
 */
async function readCatalogAllowlist(): Promise<void> {
  const slugs: string[] = [];
  try {
    const res = await fetch(catalogUrl('index.json'));
    if (res.ok) {
      const body: unknown = await res.json();
      const entries = body && typeof body === 'object' ? (body as { entries?: unknown }).entries : null;
      if (Array.isArray(entries)) {
        for (const e of entries) {
          const slug = e && typeof e === 'object' ? (e as { slug?: unknown }).slug : null;
          if (typeof slug === 'string') slugs.push(slug);
        }
      }
    }
  } catch {
    /* no catalog: nothing may be named, which is the safe answer */
  }
  allowlist = buildAllowlist(slugs);
  for (const event of waiting.splice(0)) send(planEvent(event, allowlist, location.href));
}

/**
 * Load gtag.js and configure it.
 *
 * The bootstrap is written out rather than pasted from Google's snippet for
 * two reasons. The snippet is an inline `<script>`, and this page's CSP allows
 * none; creating the element from here loads it by `src`, which the policy
 * permits without `unsafe-inline`. And the configuration has to be different
 * from the default — automatic page views would send the fragment, which is
 * where this app keeps the repository.
 *
 * `dataLayer` entries are arrays rather than the `arguments` object Google's
 * snippet pushes. gtag.js only ever indexes them and reads `length`, which an
 * array satisfies, and an array is something this file can be strict about.
 */
/**
 * Push a gtag command the way gtag.js actually reads them.
 *
 * `dataLayer.push(['config', id])` does **nothing**. Google's own snippet is
 * `function gtag(){dataLayer.push(arguments)}` and gtag.js identifies a
 * command by receiving an `arguments` object; a plain array is treated as a
 * Tag-Manager-style data push and silently ignored. So the config was ignored,
 * every event was ignored, and nothing was ever sent.
 *
 * Measured on a build with a real measurement id, watching the network:
 *
 *     app pushing arrays      -> 0 requests to /g/collect, 0 cookies
 *     the same calls, as args -> 1 request, `_ga` and `_ga_<id>` set
 *
 * This was never caught because no measurement id had ever been configured, so
 * `initAnalytics` returned at `isMeasurementId` and the transport was never
 * reached. The unit tests cover `planEvent`, which decides *what* to send, and
 * a broken `send` still satisfies them. The lesson is that a module gated
 * behind configuration is untested until something turns the configuration on.
 */
function push(...args: unknown[]): void {
  // eslint-disable-next-line prefer-rest-params
  (function gtag(this: void) { window.dataLayer?.push(arguments); } as (...a: unknown[]) => void)(...args);
}

function install(id: string): void {
  window.dataLayer = window.dataLayer ?? [];
  push('js', new Date());
  push(
    'config',
    id,
    {
      // Sent by hand, from `trackPageView`, so the location is ours to choose.
      send_page_view: false,
      page_location: safePageLocation(location.href),
      // The referrer never carries a fragment — browsers strip it — but it can
      // carry a query, and the same rule applies to it as to our own URL.
      page_referrer: safePageLocation(document.referrer),
      // No advertising features. This measures whether the site is used, and
      // remarketing audiences are not that.
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      /**
       * The exact hostname, not the registrable domain.
       *
       * gtag defaults to `'auto'`, which walks up from the current host and
       * sets the cookie on the highest domain it can, so that a cookie set on
       * `www.example.com` is readable from `shop.example.com`. That is the
       * right default and it is wrong here: this site is served from
       * `thuynh-91.github.io`, and `github.io` is on the Public Suffix List,
       * so `.github.io` is not a domain anyone may set a cookie on -- if it
       * were, any GitHub Pages site could read every other one's cookies.
       *
       * Chromium and WebKit refuse it quietly. **Firefox logs it**, once per
       * cookie per navigation, and a visitor who opens the console on a page
       * they were just sent sees:
       *
       *     Cookie "_ga_P95G05P1BJ" has been rejected for invalid domain.
       *
       * Found by `x/launch-check.mjs`, which drives the deployed site in all
       * three engines and treats a console error as a failure. Five on the
       * landing page, nine after pressing Play demo. Measurement worked
       * throughout -- gtag falls back to the exact host -- so this was never a
       * data problem, only a page that talked about itself in red.
       *
       * `'none'` asks for the exact hostname and no walking up, which is what
       * a single-host static site wants anyway.
       */
      cookie_domain: 'none',
      /**
       * One console line is left, deliberately.
       *
       * WebKit occasionally reports the Content Security Policy refusing
       * `googletagmanager.com/td`, which is Google's own sampled tag
       * diagnostics and carries none of this site's measurement. It appeared
       * once in twelve deployed-site journeys and then not at all in three
       * further attempts with a `securitypolicyviolation` listener attached,
       * so it is sampled rather than constant.
       *
       * Not fixed, on purpose. The fix would be widening `img-src` in
       * `index.html` to a host it does not currently need -- and the directive
       * could not even be confirmed, because the violation would not reproduce.
       * Broadening a security policy to silence a rare log line, without being
       * able to verify the change works, is the wrong trade twice over. The CSP
       * refusing a beacon this site never asked for is the policy working.
       */
    },
  );

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}
