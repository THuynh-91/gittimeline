import { useEffect, useRef, useState } from 'preact/hooks';
import { store, updateSettings } from './store';
import { seek, setLoop, jumpLandmark, stepUnit, setScrubbing } from './controller';
import { mapMonotone } from '@/choreography/clock';
import { fmtClock, fmtDate } from '@/choreography/events';
import type { CompiledPerformance } from '@/model/types';
import { PALETTE } from '@/renderer/palette';

/**
 * A slim scrub line, not an activity map. It carries the playhead, the era
 * boundaries and the landmarks worth jumping to, so seeking stays precise
 * while the stage keeps the viewer's attention.
 */
const H = 26;

export function Timeline() {
  const ref = useRef<HTMLCanvasElement>(null);
  const perf = store.perf.value;
  const t = store.time.value;
  const scale = store.settings.value.timelineScale;
  // The scrubber's marks are notes on the picture, not the message ledger —
  // they follow the same switch as the captions drawn on the history itself.
  const showRail = store.settings.value.labels !== 'minimal';
  const loop = store.loopRange.value;
  const focus = store.contributorFocus.value;
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const drag = useRef<{ start: number; shift: boolean } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas && perf) draw(canvas, perf, t, scale, loop, focus, hover?.t ?? null, showRail);
  }, [perf, t, scale, loop, focus, hover]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      if (perf) draw(canvas, perf, store.time.peek(), scale, loop, focus, null, store.settings.peek().labels !== 'minimal');
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [perf, scale, loop, focus]);

  if (!perf) return null;

  const toTime = (e: PointerEvent): number => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    return xFracToTime(perf, f, scale);
  };

  const onDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const time = toTime(e);
    drag.current = { start: time, shift: e.shiftKey };
    setScrubbing(true);
    if (!e.shiftKey) seek(time);
  };
  const onMove = (e: PointerEvent) => {
    const time = toTime(e);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHover({ x: e.clientX - r.left, t: time });
    if (drag.current) {
      if (drag.current.shift) setLoop({ start: Math.min(drag.current.start, time), end: Math.max(drag.current.start, time) });
      else seek(time);
    }
  };
  const onUp = (e: PointerEvent) => {
    setScrubbing(false);
    if (drag.current?.shift) {
      const time = toTime(e);
      if (Math.abs(time - drag.current.start) < 0.5) setLoop(null);
    }
    drag.current = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) jumpLandmark(e.key === 'ArrowLeft' ? -1 : 1);
      else stepUnit(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'Home') {
      seek(0);
      e.preventDefault();
    } else if (e.key === 'End') {
      seek(perf.duration);
      e.preventDefault();
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      seek(store.time.peek() + (e.key === 'PageUp' ? -5 : 5));
      e.preventDefault();
    }
  };

  const hist = mapMonotone(perf.timeMap, t, true);
  const tip = hover ? tooltipAt(perf, hover.t) : null;
  return (
    <div class="timeline">
      <canvas
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="Performance timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(perf.duration)}
        aria-valuenow={Math.round(t)}
        aria-valuetext={`${fmtClock(t)} of ${fmtClock(perf.duration)}, ${fmtDate(hist)}`}
        data-testid="timeline"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onDblClick={() => updateSettings({ timelineScale: scale === 'performance' ? 'historical' : 'performance' })}
      />
      {tip && hover && (
        <div class="tip" style={`left:${Math.min(Math.max(hover.x, 100), (ref.current?.clientWidth ?? 400) - 100)}px`} role="tooltip">
          <div class="head">{tip.head}</div>
          {tip.lines.map((l, i) => (
            <div key={i} class="dim">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function xFracToTime(perf: CompiledPerformance, f: number, scale: 'performance' | 'historical'): number {
  if (scale === 'performance' || !perf.timeMap.length) return f * perf.duration;
  const h0 = perf.timeMap[0]![0];
  const h1 = perf.timeMap[perf.timeMap.length - 1]![0];
  return mapMonotone(perf.timeMap, h0 + (h1 - h0) * f);
}

function timeToXFrac(perf: CompiledPerformance, t: number, scale: 'performance' | 'historical'): number {
  if (scale === 'performance' || perf.timeMap.length < 2) return t / Math.max(1e-6, perf.duration);
  const h0 = perf.timeMap[0]![0];
  const h1 = perf.timeMap[perf.timeMap.length - 1]![0];
  const h = mapMonotone(perf.timeMap, t, true);
  return (h - h0) / Math.max(1, h1 - h0);
}

function tooltipAt(perf: CompiledPerformance, t: number): { head: string; lines: string[] } | null {
  const h = mapMonotone(perf.timeMap, t, true);
  const lines: string[] = [];
  const near = perf.landmarks.filter((l) => Math.abs(l.time - t) < Math.max(0.4, perf.duration * 0.012));
  if (!perf.activity.length) return { head: fmtDate(h), lines: ['No commits'] };
  const first = perf.activity[0]!;
  const width = first.historicalEnd - first.historicalStart;
  const idx = Math.min(perf.activity.length - 1, Math.max(0, Math.floor((h - first.historicalStart) / width)));
  const b = perf.activity[idx]!;
  lines.push(`${b.knownCommitCount} known commit${b.knownCommitCount === 1 ? '' : 's'} in this span`);
  if (b.activeThreadCount != null && b.activeThreadCount > 1) lines.push(`${b.activeThreadCount} concurrent threads`);
  if (b.mergeCount) lines.push(`${b.mergeCount} merge${b.mergeCount === 1 ? '' : 's'}`);
  for (const l of near.slice(0, 2)) lines.push(`${l.kind}: ${l.label}`);
  lines.push(`${fmtClock(t)} · coverage ${b.coverage}`);
  return { head: fmtDate(h), lines };
}

function draw(
  canvas: HTMLCanvasElement,
  perf: CompiledPerformance,
  t: number,
  scale: 'performance' | 'historical',
  loop: { start: number; end: number } | null,
  focus: string | null,
  hoverT: number | null,
  showCommitMarks: boolean,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight || H;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const xOf = (time: number) => timeToXFrac(perf, time, scale) * w;
  const playX = xOf(t);
  const line = Math.round(h * 0.42) + 0.5;

  // Era bands: a whisper of where the regimes change.
  for (const era of perf.eras) {
    const x0 = xOf(era.performanceStart);
    const x1 = xOf(era.performanceEnd);
    if (era.label !== 'dormancy') continue;
    ctx.fillStyle = 'rgba(230,225,214,0.05)';
    ctx.fillRect(x0, line - 4, Math.max(1, x1 - x0), 8);
  }

  // Unloaded history at the head of the line.
  if (perf.coverage.completeness !== 'exact') {
    ctx.strokeStyle = 'rgba(255,176,112,0.75)';
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(0, line);
    ctx.lineTo(Math.max(8, w * 0.012), line);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // The track, and the part already performed.
  ctx.strokeStyle = 'rgba(230,225,214,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, line);
  ctx.lineTo(w, line);
  ctx.stroke();
  ctx.strokeStyle = PALETTE.ivory;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, line);
  ctx.lineTo(playX, line);
  ctx.stroke();

  if (loop) {
    ctx.fillStyle = 'rgba(127,214,255,0.16)';
    ctx.fillRect(xOf(loop.start), line - 5, xOf(loop.end) - xOf(loop.start), 10);
  }

  // Contributor activity, only while someone is focused.
  if (focus) {
    const ci = perf.contributors.findIndex((c) => c.id === focus);
    if (ci >= 0) {
      ctx.fillStyle = perf.contributors[ci]!.color;
      for (const nd of perf.nodes) {
        if (nd.contributorIdx !== ci) continue;
        ctx.fillRect(xOf(nd.impact) - 0.75, line - 7, 1.5, 5);
      }
    }
  }

  // Landmarks worth jumping to — merges, divergences, tags. These are commits,
  // so hiding the commit names hides these too: a scrubber stippled with marks
  // is as much a description of individual commits as the ledger is, and
  // "hide the commits" that leaves them behind has not done what it says.
  const y = line + 7;
  for (const l of showCommitMarks ? perf.landmarks : []) {
    const x = xOf(l.time);
    ctx.beginPath();
    if (l.kind === 'merge') {
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,243,220,0.9)';
      ctx.fill();
    } else if (l.kind === 'divergence') {
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x + 2.6, y + 2);
      ctx.lineTo(x - 2.6, y + 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(127,214,255,0.85)';
      ctx.fill();
    } else if (l.kind === 'tag') {
      ctx.moveTo(x, y - 3.2);
      ctx.lineTo(x + 2.6, y);
      ctx.lineTo(x, y + 3.2);
      ctx.lineTo(x - 2.6, y);
      ctx.closePath();
      ctx.fillStyle = PALETTE.ivory;
      ctx.fill();
    } else if (l.kind === 'unknown') {
      ctx.rect(x - 2, y - 2, 4, 4);
      ctx.strokeStyle = PALETTE.warn;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Year ticks above the line for long histories.
  ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(230,225,214,0.32)';
  let lastLabel = -60;
  for (const tick of yearTicks(perf)) {
    const x = xOf(tick.t);
    if (x < 2 || x > w - 2) continue;
    ctx.fillStyle = 'rgba(230,225,214,0.14)';
    ctx.fillRect(x, line - 5, 1, 4);
    if (x - lastLabel > 46) {
      ctx.fillStyle = 'rgba(230,225,214,0.34)';
      ctx.fillText(tick.label, x + 3, line - 7);
      lastLabel = x;
    }
  }

  if (hoverT != null) {
    ctx.strokeStyle = 'rgba(230,225,214,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(xOf(hoverT)) + 0.5, line - 8);
    ctx.lineTo(Math.round(xOf(hoverT)) + 0.5, line + 10);
    ctx.stroke();
  }

  // Playhead.
  ctx.fillStyle = PALETTE.ivory;
  ctx.beginPath();
  ctx.arc(playX, line, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(7,8,12,0.9)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function yearTicks(perf: CompiledPerformance): Array<{ label: string; t: number }> {
  const out: Array<{ label: string; t: number }> = [];
  if (perf.timeMap.length < 2) return out;
  const h0 = perf.timeMap[0]![0];
  const h1 = perf.timeMap[perf.timeMap.length - 1]![0];
  const years = new Date(h1).getUTCFullYear() - new Date(h0).getUTCFullYear();
  if (years >= 1) {
    const step = years > 24 ? 5 : 1;
    for (let y = new Date(h0).getUTCFullYear() + 1; y <= new Date(h1).getUTCFullYear(); y += step) {
      out.push({ label: String(y), t: mapMonotone(perf.timeMap, Date.UTC(y, 0, 1)) });
    }
    return out;
  }
  const start = new Date(h0);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let m = 1; m < 24; m++) {
    const ms = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1);
    if (ms > h1) break;
    out.push({ label: MON[new Date(ms).getUTCMonth()]!, t: mapMonotone(perf.timeMap, ms) });
  }
  return out;
}
