import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { branchActivityOf, BranchActivityIndex, groupBranches } from '@/model/branchOverview';
import type { BranchActivity } from '@/model/types';
import { loadBranchOverview } from '@/export/branchOverview';
import { getRenderer, pause, player, seek, selectNode, selectThread } from './controller';
import { store } from './store';
import './branchOverview.css';

export function BranchOverview() {
  const perf = store.perf.value;
  const open = store.branchOverviewOpen.value;
  const canvas = useRef<HTMLCanvasElement>(null);
  const painted = useRef<{ groups: BranchActivity[][]; top: number; step: number }>({ groups: [], top: 0, step: 1 });
  const [choices, setChoices] = useState<BranchActivity[]>([]);
  const [chosen, setChosen] = useState('');
  const [pending, setPending] = useState<BranchActivity | null>(null);
  const [error, setError] = useState('');
  const [size, setSize] = useState({ width: 800, height: 400 });
  const [downloaded, setDownloaded] = useState<{ hash: string; rows: BranchActivity[] } | null>(null);
  const manifest = store.catalogManifest.value;
  const ready = !perf?.window || !!perf.branchOverview || downloaded?.hash === perf.planHash;
  const rows = useMemo(() => downloaded?.hash === perf?.planHash ? downloaded!.rows : perf ? branchActivityOf(perf) : [], [downloaded, perf?.branchOverview, perf?.planHash, !!perf?.window]);
  const index = useMemo(() => new BranchActivityIndex(rows), [rows]);
  const t = store.time.value;
  const active = useMemo(() => index.at(t), [index, t]);
  // Dense desktop lines need no labels. When grouping, reserve a full text
  // row: hundreds of two-branch labels would be less readable than the lines.
  const compact = size.width < 600 || size.height < 240 || active.length > 1024;
  const capacity = compact ? Math.max(1, Math.floor((size.height - 52) / 22)) : 1024;
  const groups = groupBranches(active, capacity);
  const grouped = groups.some(group => group.length > 1);
  const buffering = store.buffering.value;

  useEffect(() => { setChoices([]); setChosen(''); setPending(null); setError(''); store.branchOverviewOpen.value = false; }, [perf?.planHash]);
  useEffect(() => {
    if (!open || ready || !manifest?.overview || !perf?.window) return;
    const abort = new AbortController();
    const hash = perf.planHash;
    setError('');
    void loadBranchOverview(perf.window.manifestUrl, manifest.overview, abort.signal)
      .then(rows => { if (!abort.signal.aborted) setDownloaded({ hash, rows }); })
      .catch(error => { if (!abort.signal.aborted) setError(String(error instanceof Error ? error.message : error)); });
    return () => abort.abort();
  }, [open, ready, manifest?.overview, perf?.planHash, perf?.window?.manifestUrl]);
  useEffect(() => {
    if (!open || !canvas.current) return;
    const el = canvas.current;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!pending || !perf || buffering || Math.abs(t - pending.end) > 0.1) return;
    const thread = perf.threads.find(th => th.id === pending.id);
    if (!thread?.nodeIdxs.length) return;
    const node = perf.nodes[thread.nodeIdxs.at(-1)!];
    if (!node) return;
    selectThread(thread.idx);
    selectNode(node.idx);
    const renderer = getRenderer();
    if (renderer) {
      renderer.manual = { x: node.x, y: node.y, scale: Math.max(0.5, renderer.viewport().scale) };
      store.manualCamera.value = true;
    }
    store.branchOverviewOpen.value = false;
    setPending(null);
  }, [pending, perf, buffering, t]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => { setPending(null); setError('This branch could not be opened. Try again when the history finishes loading.'); }, 20000);
    return () => clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (!open || !canvas.current) return;
    const el = canvas.current, ctx = el.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    el.width = Math.round(size.width * dpr); el.height = Math.round(size.height * dpr);
    const width = size.width, height = size.height;
    let frame = 0;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const now = player.t, middle = height / 2;
      const current = index.at(now), batch = groupBranches(current, capacity);
      const step = (height - 52) / Math.max(1, batch.length);
      painted.current = { groups: batch, top: 18, step };
      const left = grouped ? 105 : 12, right = width - 16;
      ctx.font = '11px system-ui';
      for (let i = 0; i < batch.length; i++) {
        const group = batch[i]!;
        // A band is an activity interval, never an invented parent/merge edge.
        const y0 = 18 + (i + 0.5) * step;
        const y = y0 >= middle - 10 ? y0 + 22 : y0;
        const selected = group.some(row => row.id === chosen);
        ctx.strokeStyle = selected ? '#ffffff' : (i % 2 ? '#789fa4' : '#86a87b');
        ctx.globalAlpha = selected ? 1 : 0.58;
        ctx.lineWidth = selected ? 2 : Math.max(0.5, Math.min(1, step * 0.65));
        ctx.beginPath();
        ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
        // All active intervals cross now. The moving marker reports progress
        // within each interval, rather than claiming a common calendar x axis.
        const progress = group.reduce((sum, row) => sum + Math.max(0, Math.min(1, (now - row.start) / Math.max(0.001, row.end - row.start))), 0) / group.length;
        ctx.fillStyle = selected ? '#fff' : '#b6cbaa';
        ctx.fillRect(left + (right - left - 2) * progress, y - 1, 2, 2);
        if (grouped) { ctx.globalAlpha = 1; ctx.fillStyle = '#d9e1dd'; ctx.fillText(`${group.length} ${group.length === 1 ? 'branch' : 'branches'}`, 8, y + 4); }
      }
      ctx.globalAlpha = 1; ctx.strokeStyle = '#f6e8c6'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(12, middle); ctx.lineTo(right, middle); ctx.stroke();
      ctx.fillStyle = '#f6e8c6'; ctx.fillText(perf?.source.defaultBranch?.toUpperCase() || 'MAIN', 12, middle - 6);
      if (!store.settings.peek().reducedMotion && player.playing) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [open, index, size, capacity, grouped, chosen, t, store.settings.value.reducedMotion, perf?.source.defaultBranch]);

  if (!perf || !open) return null;
  const choose = (list: BranchActivity[]) => { pause(); setChoices(list); setChosen(list[0]?.id || ''); setError(''); };
  return <section class="branch-overview" aria-label="Branch activity overview" aria-busy={!ready && !error} data-testid="branch-overview">
    <header>
      <div><strong>Branch activity</strong><p data-testid="branch-overview-count">{ready ? `${active.length} branches with work in progress · ${groups.length} ${grouped ? 'groups' : 'lines'}` : error || 'Loading branch activity…'}</p></div>
      <button type="button" onClick={() => { store.branchOverviewOpen.value = false; setPending(null); }}>Back to graph</button>
    </header>
    <p class="overview-explanation">{perf.coverage.completeness === 'exact' ? 'Whole loaded history' : 'Known history'} · Each line shows a branch’s activity, not its merge path. Select a branch to trace its commits.</p>
    <canvas ref={canvas} role="img" aria-label={ready ? `${active.length} active branches represented by ${groups.length} ${grouped ? 'groups' : 'lines'}. Use Choose a branch to inspect them.` : 'Loading branch activity'} data-testid="branch-overview-canvas" onClick={e => {
      const rect = e.currentTarget.getBoundingClientRect();
      let y = e.clientY - rect.top;
      if (y >= rect.height / 2 + 12) y -= 22;
      const row = painted.current.groups[Math.floor((y - painted.current.top) / painted.current.step)];
      if (row) choose(row);
    }} />
    <footer>
      <button type="button" disabled={!active.length} onClick={() => choose(active)}>Choose a branch</button>
      {choices.length > 0 && <>
        <label>Branch <select data-testid="overview-branch-select" value={chosen} onChange={e => setChosen(e.currentTarget.value)}>{choices.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
        <button type="button" disabled={!!pending} onClick={() => { const row = choices.find(r => r.id === chosen); if (row) { pause(); setPending(row); seek(row.end); } }}>{pending ? 'Opening…' : 'Trace branch'}</button>
      </>}
      {error && <span role="status">{error}</span>}
    </footer>
  </section>;
}
