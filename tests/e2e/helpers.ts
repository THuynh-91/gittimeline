import type { Page } from '@playwright/test';
import { mockGitHub, type MockOptions, type MockRepo } from '../fixtures/mock-github';

declare global {
  interface Window {
    __gittimeline: {
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
      camera: { x: number; y: number; w: number; h: number; state: string; punch: number } | null;
      manualCamera: boolean;
      zoomLocked: boolean;
      viewport: { cx: number; cy: number; scale: number; worldW: number; worldH: number } | null;
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
