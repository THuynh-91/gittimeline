/**
 * Shareable state lives in the URL hash so static hosting needs no routing.
 * It carries repository, pinned tip, position, preset and seed — never
 * tokens or histories.
 */
export interface ShareState {
  repo: string | null;
  tip: string | null;
  /** Performance time in seconds. */
  t: number | null;
  duration: number | null;
  seed: string | null;
  focus: string | null;
  reducedMotion: boolean | null;
  demo: boolean;
  fixture: string | null;
  /** Force the poster fallback renderer (for testing and low-capability devices). */
  renderer: 'poster' | null;
  autoplay: boolean;
  gallery: boolean;
}

export function parseShareHash(hash: string): ShareState {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const num = (k: string) => {
    const v = params.get(k);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const repo = params.get('repo');
  const tip = params.get('tip');
  return {
    repo: repo && isRepoSlug(repo) ? repo : null,
    tip: tip && /^[0-9a-f]{7,40}$/i.test(tip) ? tip.toLowerCase() : null,
    t: num('t'),
    duration: num('dur'),
    seed: params.get('seed')?.slice(0, 64) ?? null,
    focus: params.get('focus')?.slice(0, 120) ?? null,
    reducedMotion: params.has('rm') ? params.get('rm') === '1' : null,
    demo: params.get('demo') === '1',
    fixture: params.get('fixture')?.slice(0, 80) ?? null,
    renderer: params.get('renderer') === 'poster' ? 'poster' : null,
    autoplay: params.get('autoplay') === '1',
    gallery: params.get('gallery') === '1',
  };
}

function isRepoSlug(s: string): boolean {
  const parts = s.split('/');
  return parts.length === 2 && parts.every((p) => /^[\w.-]{1,100}$/.test(p) && !/^\.+$/.test(p));
}

export function buildShareHash(state: Partial<ShareState>): string {
  const params = new URLSearchParams();
  if (state.repo) params.set('repo', state.repo);
  if (state.tip) params.set('tip', state.tip);
  if (state.t != null) params.set('t', state.t.toFixed(2));
  if (state.duration != null) params.set('dur', String(state.duration));
  if (state.seed) params.set('seed', state.seed);
  if (state.focus) params.set('focus', state.focus);
  if (state.reducedMotion) params.set('rm', '1');
  if (state.demo) params.set('demo', '1');
  if (state.fixture) params.set('fixture', state.fixture);
  if (state.renderer) params.set('renderer', state.renderer);
  if (state.autoplay) params.set('autoplay', '1');
  if (state.gallery) params.set('gallery', '1');
  const s = params.toString();
  return s ? `#${s}` : '';
}
