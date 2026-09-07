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
  const win = store.spanSeconds.value;
  const focus = store.contributorFocus.value;
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const drag = useRef<{ start: number; shift: boolean } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas && perf) draw(canvas, perf, t, scale, loop, win, focus, hover?.t ?? null, showRail);
  }, [perf, t, scale, loop, win, focus, hover]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      if (perf) draw(canvas, perf, store.time.peek(), scale, loop, win, focus, null, store.settings.peek().labels !== 'minimal');
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [perf, scale, loop, win, focus]);

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
      seek(win ? win.start : 0);
      e.preventDefault();
    } else if (e.key === 'End') {
      seek(win ? win.end : perf.duration);
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
        // All four against the same length. `aria-valuetext` wins when a
        // screen reader has one, so a mismatch here is usually inaudible — but
        // a slider reporting 250 of 540 while saying "00:12 of 01:20" is wrong
        // for anything reading the numbers, and a percentage is what most of
        // them compute from.
        aria-valuemin={Math.round(win ? win.start : 0)}
        aria-valuemax={Math.round(win ? win.end : perf.duration)}
        aria-valuenow={Math.round(t)}
        aria-valuetext={`${fmtClock(win ? t - win.start : t)} of ${fmtClock(win ? win.end - win.start : perf.duration)}, ${fmtDate(hist)}`}
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
  // No activity data is not the same as no commits.
  //
  // `catalogPackage.ts` ships `activity: []` for a streamed entry, and this
  // printed that absence as a count — so hovering anywhere on public-apis, a
  // 5,272-commit repository, said "No commits" at every position. Saying
  // nothing about counts is the honest answer when there is nothing to say;
  // `accessibility.md` promises exactly that and this was the counter-example.
  if (!perf.activity.length) return { head: fmtDate(h), lines: near.slice(0, 2).map((l) => `${l.kind}: ${l.label}`) };
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

/**
 * The scrubber, in two layers.
 *
 * All of this used to be one function called on every change of `store.time` —
 * fifteen times a second — and most of what it draws does not depend on the
 * time at all. A CPU profile of Linux charged 58.5% of the entire main thread
 * to this one function: 6.9 seconds of a 13.7-second sample inside a native
 * `fill`. The cause is the landmark loop. Linux has 160,575 landmarks and the
 * strip is about 1,400 pixels wide, so it was issuing a `beginPath`, a shape
 * and a `fill` 115 times per pixel to produce a solid smear — and then doing
 * it all again a fifteenth of a second later because the playhead had moved
 * four pixels.
 *
 * So the fixed part — the track, the eras, the landmarks, the year ticks — is
 * painted once into an offscreen canvas and blitted, and repainted only when
 * something it actually depends on changes. And the marks are culled to one
 * per pixel column per kind, which is all a pixel can show: the hundred and
 * fifteenth diamond in a column is not more information, it is the same
 * diamond.
 */
interface Backdrop {
  key: string;
  canvas: HTMLCanvasElement;
}
let backdrop: Backdrop | null = null;

function backdropKey(
  perf: CompiledPerformance,
  scale: 'performance' | 'historical',
  loop: { start: number; end: number } | null,
  win: { start: number; end: number } | null,
  focus: string | null,
  showCommitMarks: boolean,
  w: number,
  h: number,
  dpr: number,
): string {
  return [perf.planHash, scale, loop ? `${loop.start}:${loop.end}` : '-', win ? `${win.start}:${win.end}` : '-', focus ?? '-', showCommitMarks ? 'm' : '.', w, h, dpr].join('|');
}

function paintBackdrop(
  ctx: CanvasRenderingContext2D,
  perf: CompiledPerformance,
  w: number,
  h: number,
  scale: 'performance' | 'historical',
  loop: { start: number; end: number } | null,
  win: { start: number; end: number } | null,
  focus: string | null,
  showCommitMarks: boolean,
) {
  const xOf = (time: number) => timeToXFrac(perf, time, scale) * w;
  const line = Math.round(h * 0.42) + 0.5;

  // The span being played, marked on the whole history.
  //
  // A span is a window on one plan, and this strip is the plan — so the
  // playhead starts a third of the way along and stops two thirds of the way
  // along, which without a mark on the track reads as a performance that
  // began late and gave up early. With the years dimmed either side it reads
  // as what it is: this stretch of that history, in its place.
  if (win) {
    const a = xOf(win.start);
    const b = xOf(win.end);
    ctx.fillStyle = 'rgba(7,8,12,0.55)';
    ctx.fillRect(0, 0, Math.max(0, a), h);
    ctx.fillRect(b, 0, Math.max(0, w - b), h);
    ctx.fillStyle = 'rgba(230,225,214,0.06)';
    ctx.fillRect(a, line - 9, Math.max(1, b - a), 18);
  }

  // Era bands: a whisper of where the regimes change.
  for (const era of perf.eras) {
    if (era.label !== 'dormancy') continue;
    const x0 = xOf(era.performanceStart);
    const x1 = xOf(era.performanceEnd);
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

  // The track.
  ctx.strokeStyle = 'rgba(230,225,214,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, line);
  ctx.lineTo(w, line);
  ctx.stroke();

  if (loop) {
    ctx.fillStyle = 'rgba(127,214,255,0.16)';
    ctx.fillRect(xOf(loop.start), line - 5, xOf(loop.end) - xOf(loop.start), 10);
  }

  // Contributor activity, only while someone is focused. One tick per column:
  // this walks every node in the plan, and that is 332,279 of them on Linux.
  if (focus) {
    const ci = perf.contributors.findIndex((c) => c.id === focus);
    if (ci >= 0) {
      ctx.fillStyle = perf.contributors[ci]!.color;
      let lastCol = -1;
      for (const nd of perf.nodes) {
        if (nd.contributorIdx !== ci) continue;
        const x = xOf(nd.impact);
        const col = Math.round(x);
        if (col === lastCol) continue;
        lastCol = col;
        ctx.fillRect(x - 0.75, line - 7, 1.5, 5);
      }
    }
  }

  // Landmarks worth jumping to — merges, divergences, tags. These are commits,
  // so hiding the commit names hides these too: a scrubber stippled with marks
  // is as much a description of individual commits as the ledger is, and
  // "hide the commits" that leaves them behind has not done what it says.
  const y = line + 7;
  if (showCommitMarks) {
    // One per column per kind. `perf.landmarks` runs in time order, so the
    // last column used by each kind is all that has to be remembered.
    const lastCol: Record<string, number> = { merge: -1, divergence: -1, tag: -1, unknown: -1 };
    for (const l of perf.landmarks) {
      const x = xOf(l.time);
      if (x < -4 || x > w + 4) continue;
      const col = Math.round(x);
      if (lastCol[l.kind] === col) continue;
      lastCol[l.kind] = col;
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
  }

  // Year ticks above the line for long histories.
  ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  let lastLabel = -60;
  for (const tick of yearTicks(perf)) {
    const x = xOf(tick.t);
    if (x < 2 || x > w - 2) continue;
    // The riser and its year live and die together. Drawing the riser first
    // and then culling only the label left bare ticks in the run — 2023, 2024,
    // a nameless riser, 2026 — which reads as a year that failed to render
    // rather than as a year deliberately not labelled.
    if (x - lastLabel <= 46) continue;
    ctx.fillStyle = 'rgba(230,225,214,0.14)';
    ctx.fillRect(x, line - 5, 1, 4);
    {
      // Kept inside the strip, on both axes.
      //
      // The baseline was a constant offset from the track, which is a bet on
      // the font's ascent, and it was the wrong bet: at this strip's height
      // the digits were taller than the gap above the line and every year was
      // drawn with its top edge outside the canvas. Asking the context how
      // tall this string actually is holds for whatever font the system
      // substitutes and whatever height the strip is given.
      //
      // Horizontally the label goes to the left of its own tick when there is
      // no room to the right of it — still unambiguously that tick's label,
      // and the last year of a history is the one a viewer is most likely to
      // be looking for.
      const m = ctx.measureText(tick.label);
      let labelX = x + 3;
      if (labelX + m.width > w - 2) labelX = x - 3 - m.width;
      labelX = Math.max(2, Math.min(labelX, w - 2 - m.width));
      const ascent = m.actualBoundingBoxAscent || 7;
      ctx.fillStyle = 'rgba(230,225,214,0.34)';
      ctx.fillText(tick.label, labelX, Math.max(ascent + 0.5, line - 5));
      lastLabel = x;
    }
  }
}

function draw(
  canvas: HTMLCanvasElement,
  perf: CompiledPerformance,
  t: number,
  scale: 'performance' | 'historical',
  loop: { start: number; end: number } | null,
  win: { start: number; end: number } | null,
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

  const key = backdropKey(perf, scale, loop, win, focus, showCommitMarks, w, h, dpr);
  if (!backdrop || backdrop.key !== key) {
    const off = backdrop?.canvas ?? document.createElement('canvas');
    off.width = Math.max(1, Math.round(w * dpr));
    off.height = Math.max(1, Math.round(h * dpr));
    const octx = off.getContext('2d');
    if (octx) {
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.clearRect(0, 0, w, h);
      paintBackdrop(octx, perf, w, h, scale, loop, win, focus, showCommitMarks);
      backdrop = { key, canvas: off };
    }
  }
  if (backdrop) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(backdrop.canvas, 0, 0);
    ctx.restore();
  }

  const xOf = (time: number) => timeToXFrac(perf, time, scale) * w;
  const playX = xOf(t);
  const line = Math.round(h * 0.42) + 0.5;

  // The part already performed, from wherever this performance began.
  ctx.strokeStyle = PALETTE.ivory;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(win ? xOf(win.start) : 0, line);
  ctx.lineTo(playX, line);
  ctx.stroke();

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
