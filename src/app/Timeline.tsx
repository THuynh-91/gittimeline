import { useEffect, useRef, useState } from 'preact/hooks';
import { store, updateSettings } from './store';
import { seek, setLoop, jumpLandmark, stepUnit } from './controller';
import { mapMonotone } from '@/choreography/clock';
import { fmtClock, fmtDate } from '@/choreography/events';
import type { CompiledPerformance } from '@/model/types';
import { PALETTE } from '@/renderer/palette';

/**
 * Bottom activity timeline: the whole lifetime as a waveform, coverage,
 * landmarks, eras, the playhead, and precise seeking. The x-axis can be the
 * performance clock (default — the calendar visibly warps) or historical time.
 */
export function Timeline() {
  const ref = useRef<HTMLCanvasElement>(null);
  const perf = store.perf.value;
  const t = store.time.value;
  const scale = store.settings.value.timelineScale;
  const spoiler = store.settings.value.spoilerFree;
  const loop = store.loopRange.value;
  const focus = store.contributorFocus.value;
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const drag = useRef<{ start: number; shift: boolean } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !perf) return;
    draw(canvas, perf, t, scale, spoiler, loop, focus, hover?.t ?? null);
  }, [perf, t, scale, spoiler, loop, focus, hover]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      if (perf) draw(canvas, perf, store.time.peek(), scale, spoiler, loop, focus, null);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [perf, scale, spoiler, loop, focus]);

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
  const tip = hover ? bucketTooltip(perf, hover.t) : null;
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
        <div class="tip" style={`left:${Math.min(Math.max(hover.x, 90), (ref.current?.clientWidth ?? 400) - 90)}px`} role="tooltip">
          <div class="head">{tip.head}</div>
          {tip.lines.map((l, i) => (
            <div key={i} class={l.startsWith('·') ? 'dim' : ''}>
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

function bucketTooltip(perf: CompiledPerformance, t: number): { head: string; lines: string[] } | null {
  if (!perf.activity.length) return { head: fmtClock(t), lines: ['No commits'] };
  const h = mapMonotone(perf.timeMap, t, true);
  const first = perf.activity[0]!;
  const width = first.historicalEnd - first.historicalStart;
  const idx = Math.min(perf.activity.length - 1, Math.max(0, Math.floor((h - first.historicalStart) / width)));
  const b = perf.activity[idx]!;
  const lines: string[] = [];
  lines.push(`${b.knownCommitCount} known commit${b.knownCommitCount === 1 ? '' : 's'}`);
  if (b.activeThreadCount != null) lines.push(`${b.activeThreadCount} concurrent thread${b.activeThreadCount === 1 ? '' : 's'}`);
  if (b.contributorCount != null) lines.push(`${b.contributorCount} contributor${b.contributorCount === 1 ? '' : 's'}`);
  if (b.mergeCount) lines.push(`${b.mergeCount} merge${b.mergeCount === 1 ? '' : 's'}`);
  if (b.tagCount) lines.push(`${b.tagCount} tag${b.tagCount === 1 ? '' : 's'}`);
  if (b.changeMagnitude == null) lines.push('· change size not fetched');
  lines.push(`· intensity ${Math.round(b.phraseIntensity * 100)}th percentile`);
  lines.push(`· coverage ${b.coverage}`);
  lines.push(`· ${fmtClock(t)} in the performance`);
  return { head: `${fmtDate(b.historicalStart)} – ${fmtDate(b.historicalEnd)}`, lines };
}

function draw(
  canvas: HTMLCanvasElement,
  perf: CompiledPerformance,
  t: number,
  scale: 'performance' | 'historical',
  spoiler: boolean,
  loop: { start: number; end: number } | null,
  focus: string | null,
  hoverT: number | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(20,24,36,0.55)';
  ctx.fillRect(0, 0, w, h);

  const xOf = (time: number) => timeToXFrac(perf, time, scale) * w;
  const playX = xOf(t);
  const top = 14;
  const base = h - 14;
  const amp = base - top;

  // Coverage overlay: unknown before the earliest loaded commit, hatched.
  if (perf.coverage.completeness !== 'exact') {
    ctx.fillStyle = 'rgba(255,176,112,0.12)';
    ctx.fillRect(0, top, Math.max(6, w * 0.012), amp);
    ctx.strokeStyle = 'rgba(255,176,112,0.6)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.max(6, w * 0.012), top);
    ctx.lineTo(Math.max(6, w * 0.012), base);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Waveform (performance-time samples; resampled if the axis is historical).
  const n = perf.waveform.length;
  const revealUntil = spoiler ? playX + 40 : w;
  ctx.beginPath();
  ctx.moveTo(0, base);
  for (let i = 0; i < n; i++) {
    const pt = (perf.duration * i) / (n - 1);
    const x = xOf(pt);
    if (x > revealUntil) break;
    const v = perf.waveform[i]!;
    ctx.lineTo(x, base - v * amp);
  }
  ctx.lineTo(Math.min(revealUntil, w), base);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, top, 0, base);
  grad.addColorStop(0, 'rgba(244,233,210,0.55)');
  grad.addColorStop(1, 'rgba(244,233,210,0.08)');
  ctx.fillStyle = grad;
  ctx.fill();
  // played portion brighter
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, playX, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(244,233,210,0.35)';
  ctx.beginPath();
  ctx.moveTo(0, base);
  for (let i = 0; i < n; i++) {
    const pt = (perf.duration * i) / (n - 1);
    ctx.lineTo(xOf(pt), base - perf.waveform[i]! * amp);
  }
  ctx.lineTo(w, base);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Contributor overlay
  if (focus) {
    const ci = perf.contributors.findIndex((c) => c.id === focus);
    if (ci >= 0) {
      ctx.fillStyle = perf.contributors[ci]!.color;
      for (const nd of perf.nodes) {
        if (nd.contributorIdx !== ci) continue;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(xOf(nd.impact) - 0.75, base - 6, 1.5, 6);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Era boundaries and year labels
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(230,225,214,0.45)';
  ctx.strokeStyle = 'rgba(230,225,214,0.12)';
  const years = yearTicks(perf);
  let lastLabelX = -100;
  for (const y of years) {
    const x = xOf(y.t);
    if (x > revealUntil + 2) continue;
    ctx.beginPath();
    ctx.moveTo(x, top - 2);
    ctx.lineTo(x, base + 2);
    ctx.stroke();
    if (x - lastLabelX > 34) {
      ctx.fillText(String(y.year), x + 3, 1);
      lastLabelX = x;
    }
  }
  for (const era of perf.eras) {
    const x = xOf(era.performanceStart);
    if (x < 2 || x > revealUntil) continue;
    ctx.strokeStyle = 'rgba(127,214,255,0.25)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, base);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Landmarks
  for (const l of perf.landmarks) {
    const x = xOf(l.time);
    if (x > revealUntil) continue;
    const y = base + 6;
    ctx.beginPath();
    if (l.kind === 'merge') {
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.merge;
      ctx.fill();
      ctx.strokeStyle = 'rgba(244,233,210,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 4.4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (l.kind === 'divergence') {
      ctx.moveTo(x, y - 3.5);
      ctx.lineTo(x + 3.2, y + 2.5);
      ctx.lineTo(x - 3.2, y + 2.5);
      ctx.closePath();
      ctx.fillStyle = PALETTE.accent;
      ctx.fill();
    } else if (l.kind === 'tag') {
      ctx.moveTo(x, y - 3.8);
      ctx.lineTo(x + 3.2, y);
      ctx.lineTo(x, y + 3.8);
      ctx.lineTo(x - 3.2, y);
      ctx.closePath();
      ctx.fillStyle = PALETTE.ivory;
      ctx.fill();
    } else if (l.kind === 'unknown') {
      ctx.rect(x - 2.5, y - 2.5, 5, 5);
      ctx.strokeStyle = PALETTE.warn;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (l.kind === 'birth' || l.kind === 'present') {
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(230,225,214,0.7)';
      ctx.fill();
    }
  }

  // Loop range
  if (loop) {
    ctx.fillStyle = 'rgba(127,214,255,0.12)';
    ctx.fillRect(xOf(loop.start), top, xOf(loop.end) - xOf(loop.start), amp);
  }

  // Hover
  if (hoverT != null) {
    ctx.strokeStyle = 'rgba(230,225,214,0.35)';
    ctx.beginPath();
    ctx.moveTo(xOf(hoverT), top);
    ctx.lineTo(xOf(hoverT), base);
    ctx.stroke();
  }

  // Playhead
  ctx.strokeStyle = PALETTE.ivory;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(playX, top - 6);
  ctx.lineTo(playX, base + 10);
  ctx.stroke();
  ctx.fillStyle = PALETTE.ivory;
  ctx.beginPath();
  ctx.moveTo(playX - 4, top - 8);
  ctx.lineTo(playX + 4, top - 8);
  ctx.lineTo(playX, top - 3);
  ctx.closePath();
  ctx.fill();
  ctx.textBaseline = 'alphabetic';
  ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(230,225,214,0.5)';
  ctx.fillText(scale === 'performance' ? 'PERFORMANCE CLOCK' : 'HISTORICAL CLOCK', 4, h - 3);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function yearTicks(perf: CompiledPerformance): Array<{ year: number | string; t: number }> {
  const out: Array<{ year: number | string; t: number }> = [];
  if (perf.timeMap.length < 2) return out;
  const h0 = perf.timeMap[0]![0];
  const h1 = perf.timeMap[perf.timeMap.length - 1]![0];
  const y0 = new Date(h0).getUTCFullYear();
  const y1 = new Date(h1).getUTCFullYear();
  const step = y1 - y0 > 30 ? 5 : 1;
  for (let y = y0 + 1; y <= y1; y += step) {
    if (y % step) continue;
    const ms = Date.UTC(y, 0, 1);
    out.push({ year: y, t: mapMonotone(perf.timeMap, ms) });
  }
  if (y1 - y0 <= 1) {
    // short histories: month ticks, labelled by month (with the year at January)
    const months: Array<{ year: number | string; t: number }> = [];
    const start = new Date(h0);
    for (let m = 1; m < 40; m++) {
      const ms = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1);
      if (ms > h1) break;
      const d = new Date(ms);
      months.push({ year: d.getUTCMonth() === 0 ? d.getUTCFullYear() : MONTHS[d.getUTCMonth()]!, t: mapMonotone(perf.timeMap, ms) });
    }
    return months;
  }
  return out;
}
