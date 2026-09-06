import type { Page } from '@playwright/test';
import { mockGitHub, type MockOptions, type MockRepo } from '../fixtures/mock-github';

declare global {
  interface Window {
    __gittimeline: {
      /** Where a catalog file actually lives — local path or remote release. */
      catalogUrl: (file: string) => string;
      catalogIsRemote: boolean;
      buffering: boolean;
      time: number;
      playing: boolean;
      phase: string;
      mode: string;
      duration: number;
      stats: { commits: number; threads: number; merges: number; maxConcurrentThreads: number; boundaries: number; roots: number } | null;
      planHash: string | null;
      pace: { nodes: number; perSecond: number } | null;
      years: Array<[number, number]> | null;
      source: { provider: string; slug: string } | null;
      /** Per-pass render timings and counts; inert until `enabled` is set. */
      render: { enabled: boolean; frames: number; counts: { nodesDrawn: number; edgesDrawn: number; rescuedCues: number } };
      camera: { x: number; y: number; w: number; h: number; state: string; punch: number } | null;
      manualCamera: boolean;
      zoomLocked: boolean;
      viewport: { cx: number; cy: number; scale: number; worldW: number; worldH: number } | null;
      /** The same viewport, plus the geometry it is looking at. */
      view: { cx: number; cy: number; scale: number; worldW: number; worldH: number; geomMinX: number | null; geomMaxX: number | null } | null;
      nodeX: number[] | null;
      waveform: number[] | null;
      zoom(factor: number): void;
      loadFixture(id: string): void;
      loadArtifact(url: string): Promise<void>;
      setDuration(seconds: number): void;
      chooseScope(since: string | null, until: string | null, label: string): void;
      audioStarted: boolean;
      music: { title: string; artist: string; playing: boolean } | null;
      bodies(): Array<{ edge: number; kind: string; body: string; thread: number; contributor: number; progress: number; x: number; y: number }>;
      events(type?: string): Array<{ type: string; impact: number; start: number; end: number; caption: string }>;
      setToken(t: string | null): void;
      seek(t: number): void;
      play(): void;
      pause(): void;
    };
  }
}

/** Intercept api.github.com with the realistic mock so browser tests never touch the network. */
export async function routeGitHub(page: Page, repo: MockRepo | null, opts: MockOptions = {}) {
  const mock = mockGitHub(repo, opts);
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    if (mock.offline) {
      await route.abort('internetdisconnected');
      return;
    }
    const spec = mock.respond(req.url(), req.headers());
    await route.fulfill({ status: spec.status, headers: spec.headers, body: spec.status === 304 ? '' : JSON.stringify(spec.body), contentType: 'application/json' });
  });
  return mock;
}

/**
 * Wait for the shelf, and only then conclude there isn't one.
 *
 * Six places asked `isVisible()` the instant after clicking through to the
 * catalog and skipped the test when the answer was no. That was sound while
 * `index.json` was published inside `dist`: same origin, already in the
 * browser's cache from the page load, painted in the same task. It is fetched
 * across the network from an object store now, so the answer is *always* no
 * for the first few hundred milliseconds — and every one of those tests had
 * quietly stopped running, including both of the ones that check a pre-fetched
 * history plays without asking GitHub for anything.
 *
 * A skip that fires on a timing race is worse than a failure: the suite stays
 * green and says "2 skipped" on a line nobody reads.
 */
/**
 * Keep the soundtrack out of the room on the one engine that cannot be told to.
 *
 * Chromium takes `--mute-audio` and Firefox takes `media.volume_scale`, both of
 * which silence the output and leave every observable the app has alone.
 * WebKit has neither, so the files are refused instead: nothing decodes and
 * nothing plays. `fallback.spec.ts` reads the volume control's effect out of
 * `localStorage`, which is written whether or not a track ever loaded, so the
 * one test that cares still tests what it says it does.
 */
export async function silenceWebkit(page: Page) {
  await page.route('**/music/**', (route) => route.abort());
}

export async function shelfPresent(page: Page, timeout = 15_000): Promise<boolean> {
  try {
    await page.getByTestId('catalog').waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

export async function waitForReady(page: Page, timeout = 30_000) {
  await page.waitForFunction(() => window.__gittimeline && window.__gittimeline.stats !== null && ['READY', 'PLAYING', 'PAUSED', 'DEGRADED_READY'].includes(window.__gittimeline.phase), null, { timeout });
}

export async function stageHash(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="stage-canvas"]') as HTMLCanvasElement | null;
    if (!c) return '';
    // Downsample to keep this cheap; sum of sampled pixels is enough to detect motion.
    const off = document.createElement('canvas');
    off.width = 160;
    off.height = 100;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(c, 0, 0, 160, 100);
    const d = ctx.getImageData(0, 0, 160, 100).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 4) {
      h ^= d[i]! + d[i + 1]! + d[i + 2]!;
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  });
}
