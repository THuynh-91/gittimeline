import type { CameraCue, ChoreographyEvent, CompiledPerformance, EdgeGeom, NodeGeom } from '@/model/types';
import { sampleCamera } from '@/choreography/camera';
import { describeAggregate } from '@/analysis/aggregate';
import { pointAt, headingAt } from '@/layout/paths';
import { hash01 } from '@/model/prng';
import { mixHex, rgba } from '@/model/color';
import { GLYPH_PATHS, PALETTE, threadTint } from './palette';

/**
 * Canvas2D stage renderer. Every visible quantity is a pure function of the
 * performance time `t` (plus the compiled plan), so seeking, pausing and
 * capture are exact and side-effect free. Layers back to front:
 * atmosphere → settled paths → spine → active trajectories → nodes →
 * bodies (performers/pulses) → impact effects → labels.
 */
export type Quality = 'full' | 'reduced' | 'minimal';

export interface RenderSettings {
  reducedMotion: boolean;
  noFlash: boolean;
  highContrast: boolean;
  quality: Quality;
  labels: 'minimal' | 'landmarks' | 'all';
  contributorFocus: string | null;
  selectedNode: number | null;
  hoverNode: number | null;
  selectedThread: number | null;
  showGlyphs: boolean;
  /** Screen-space safe insets (top chrome, bottom timeline). */
  safe: { top: number; bottom: number; left: number; right: number };
}

export interface ManualCamera {
  x: number;
  y: number;
  scale: number;
}

export interface Pick {
  node: NodeGeom | null;
  aggregateEdge: EdgeGeom | null;
}

interface ViewTransform {
  scale: number;
  ox: number;
  oy: number;
  rotation: number;
  cx: number;
  cy: number;
}

const HEAVY = new Set(['MERGE_IMPACT', 'MAJOR_MERGE', 'OCTOPUS_MERGE']);

/**
 * Twenty commits converging must look unmistakably bigger than two. Volume is
 * the count of commits unique to the merged side(s), so this grows with the
 * real weight of the work rather than with a normalized score.
 */
function volumeScale(volume: number): number {
  // Deliberately starts well below one. A merge that absorbs a commit or two is
  // a tap; only real convergence earns a wall of light. Previously every merge
  // got a headline effect, which made the big ones mean nothing.
  return 0.42 + Math.min(2.3, Math.log2(1 + Math.max(0, volume)) * 0.44);
}

export class StageRenderer {
  private ctx: CanvasRenderingContext2D;
  private glow: HTMLCanvasElement;
  private glowCtx: CanvasRenderingContext2D;
  private perf: CompiledPerformance | null = null;
  private edgeBounds: Float32Array = new Float32Array(0);
  private impactEvents: ChoreographyEvent[] = [];
  private eventPtr = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private view: ViewTransform = { scale: 1, ox: 0, oy: 0, rotation: 0, cx: 0, cy: 0 };
  private smoothedPunch = 1;
  private lastT = -1;
  private nodeBySha = new Map<string, NodeGeom>();
  private tints: string[] = [];
  private dust: Float32Array;
  private lastCue: CameraCue | null = null;
  private sweepX = -Infinity;
  private frameCounter = 0;
  private tmp = { x: 0, y: 0 };
  private tmp2 = { x: 0, y: 0 };

  settings: RenderSettings = {
    reducedMotion: false,
    noFlash: false,
    highContrast: false,
    quality: 'full',
    labels: 'landmarks',
    contributorFocus: null,
    selectedNode: null,
    hoverNode: null,
    selectedThread: null,
    showGlyphs: true,
    safe: { top: 56, bottom: 150, left: 24, right: 24 },
  };
  manual: ManualCamera | null = null;
  /**
   * A zoom the viewer chose, held while the director still follows the action.
   * Zooming out and pressing the camera button locks that wider view instead of
   * snapping back to the framing the compiler picked.
   */
  zoomLock: number | null = null;
  /** Dim factor for the gallery/landing state (0..1). */
  attenuation = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.glow = document.createElement('canvas');
    this.glowCtx = this.glow.getContext('2d')!;
    this.dust = new Float32Array(90 * 3);
    for (let i = 0; i < 90; i++) {
      this.dust[i * 3] = hash01(`dust:x:${i}`);
      this.dust[i * 3 + 1] = hash01(`dust:y:${i}`);
      this.dust[i * 3 + 2] = 0.4 + hash01(`dust:s:${i}`) * 1.4;
    }
    this.resize();
  }

  setPerformance(p: CompiledPerformance | null) {
    this.perf = p;
    this.eventPtr = 0;
    this.lastT = -1;
    this.nodeBySha.clear();
    if (!p) return;
    for (const nd of p.nodes) this.nodeBySha.set(nd.sha, nd);
    this.tints = p.threads.map((t) => threadTint(t.side, t.lane, this.settings.highContrast));
    this.impactEvents = p.events.filter((e) => HEAVY.has(e.type) || e.type === 'DIVERGENCE' || e.type === 'TAG_LANDMARK' || e.type === 'REPO_BIRTH' || e.type === 'MULTI_ROOT_REVEAL' || e.type === 'REPO_PRESENT');
    this.edgeBounds = new Float32Array(p.edges.length * 4);
    p.edges.forEach((e, i) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < e.pts.length; k += 2) {
        const x = e.pts[k]!;
        const y = e.pts[k + 1]!;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      this.edgeBounds[i * 4] = x0 - 12;
      this.edgeBounds[i * 4 + 1] = y0 - 12;
      this.edgeBounds[i * 4 + 2] = x1 + 12;
      this.edgeBounds[i * 4 + 3] = y1 + 12;
    });
    const first = p.camera[0];
    if (first) {
      this.lastCue = first;
      this.applyCamera(first, 0);
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dprCap = this.settings.quality === 'full' ? 2 : this.settings.quality === 'reduced' ? 1.5 : 1;
    this.dpr = Math.min(dprCap, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.glow.width = Math.max(1, Math.round(this.canvas.width / 2));
    this.glow.height = Math.max(1, Math.round(this.canvas.height / 2));
  }

  get camera(): CameraCue | null {
    return this.lastCue;
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    const v = this.view;
    const dx = x - v.cx;
    const dy = y - v.cy;
    const cos = Math.cos(v.rotation);
    const sin = Math.sin(v.rotation);
    return { x: v.ox + (dx * cos - dy * sin) * v.scale, y: v.oy + (dx * sin + dy * cos) * v.scale };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const v = this.view;
    const dx = (sx - v.ox) / v.scale;
    const dy = (sy - v.oy) / v.scale;
    const cos = Math.cos(-v.rotation);
    const sin = Math.sin(-v.rotation);
    return { x: v.cx + dx * cos - dy * sin, y: v.cy + dx * sin + dy * cos };
  }

  /** Current view for manual camera continuity. */
  currentManual(): ManualCamera {
    return { x: this.view.cx, y: this.view.cy, scale: this.view.scale };
  }

  /**
   * The world rectangle currently on screen. Panning controls need to know how
   * much of the picture a viewer can see, not just where the camera is: at the
   * end of a performance that is the difference between a slider that scrolls
   * and one that has nothing left to scroll through.
   */
  viewport(): { cx: number; cy: number; scale: number; worldW: number; worldH: number } {
    const s = this.settings.safe;
    const safeW = Math.max(80, this.width - s.left - s.right);
    const safeH = Math.max(80, this.height - s.top - s.bottom);
    return {
      cx: this.view.cx,
      cy: this.view.cy,
      scale: this.view.scale,
      worldW: safeW / Math.max(1e-6, this.view.scale),
      worldH: safeH / Math.max(1e-6, this.view.scale),
    };
  }

  pick(sx: number, sy: number, t: number): Pick {
    const p = this.perf;
    if (!p) return { node: null, aggregateEdge: null };
    let best: NodeGeom | null = null;
    let bestD = 14;
    for (const nd of p.nodes) {
      if (nd.impact > t) continue;
      const s = this.worldToScreen(nd.x, nd.y);
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < bestD) {
        bestD = d;
        best = nd;
      }
    }
    if (best) return { node: best, aggregateEdge: null };
    for (const e of p.edges) {
      if (e.kind !== 'aggregate' || e.start > t) continue;
      const m = pointAt(e.pts, 0.5, this.tmp);
      const s = this.worldToScreen(m.x, m.y);
      if (Math.hypot(s.x - sx, s.y - sy) < 16) return { node: null, aggregateEdge: e };
    }
    return { node: null, aggregateEdge: null };
  }

  private applyCamera(cue: CameraCue, dtReal: number) {
    const s = this.settings.safe;
    const safeW = Math.max(80, this.width - s.left - s.right);
    const safeH = Math.max(80, this.height - s.top - s.bottom);
    if (this.manual) {
      this.view = { scale: this.manual.scale, ox: s.left + safeW / 2, oy: s.top + safeH / 2, rotation: 0, cx: this.manual.x, cy: this.manual.y };
      return;
    }
    const targetPunch = this.settings.reducedMotion ? 1 : cue.punch;
    const k = dtReal > 0 ? 1 - Math.exp(-dtReal * 14) : 1;
    this.smoothedPunch += (targetPunch - this.smoothedPunch) * k;
    const fit = Math.min(safeW / cue.w, safeH / cue.h);
    const scale = (this.zoomLock ?? fit) * this.smoothedPunch;
    this.view = {
      scale,
      ox: s.left + safeW / 2,
      oy: s.top + safeH / 2,
      rotation: this.settings.reducedMotion ? 0 : cue.rotation,
      cx: cue.x,
      cy: cue.y,
    };
  }

  render(t: number, dtReal: number) {
    const ctx = this.ctx;
    const p = this.perf;
    this.frameCounter++;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(t);
    if (!p) {
      this.drawEmptyStage(t);
      return;
    }
    const cue = sampleCamera(p.camera, t);
    this.lastCue = cue;
    this.applyCamera(cue, this.lastT < 0 || Math.abs(t - this.lastT) > 1 ? 0 : dtReal);
    this.lastT = t;
    if (p.nodes.length === 0) {
      this.drawEmptyStage(t);
      return;
    }

    const v = this.view;
    ctx.save();
    ctx.translate(v.ox, v.oy);
    ctx.rotate(v.rotation);
    ctx.scale(v.scale, v.scale);
    ctx.translate(-v.cx, -v.cy);

    // Visible world rect (with margin) for culling.
    const inv = 1 / v.scale;
    const halfW = (this.width * inv) / 2 + 80;
    const halfH = (this.height * inv) / 2 + 80;
    const vx0 = v.cx - halfW, vx1 = v.cx + halfW, vy0 = v.cy - halfH, vy1 = v.cy + halfH;

    const useGlow = this.settings.quality === 'full' && !this.settings.reducedMotion;
    const glow = this.glowCtx;
    if (useGlow) {
      glow.setTransform(1, 0, 0, 1, 0, 0);
      glow.clearRect(0, 0, this.glow.width, this.glow.height);
      const gs = this.dpr / 2;
      glow.setTransform(gs, 0, 0, gs, 0, 0);
      glow.translate(v.ox, v.oy);
      glow.rotate(v.rotation);
      glow.scale(v.scale, v.scale);
      glow.translate(-v.cx, -v.cy);
    }

    // Where the history-sweep light is right now: a slow pass over everything
    // that has already been drawn, repeating every twelve seconds.
    if (!this.settings.reducedMotion && p.nodes.length) {
      const span = Math.max(400, vx1 - p.bounds.minX + 400);
      this.sweepX = p.bounds.minX + ((t * 260) % span);
    } else this.sweepX = -Infinity;

    const ripples = this.activeRipples(t);
    const focus = this.settings.contributorFocus;
    const focusIdx = focus ? p.contributors.findIndex((c) => c.id === focus) : -1;
    const dimForFocus = focusIdx >= 0 ? 0.28 : 1;
    const hc = this.settings.highContrast;
    const ivory = hc ? PALETTE.highContrast.ivory : PALETTE.ivory;
    const slate = hc ? PALETTE.highContrast.slate : PALETTE.slate;

    // --- Edges ---
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const edges = p.edges;
    const activeEdges: EdgeGeom[] = [];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]!;
      if (e.start > t) {
        if (e.start > t + 3) {
          // edges are sorted by start: everything after is in the future
          break;
        }
        continue;
      }
      const b = i * 4;
      if (this.edgeBounds[b + 2]! < vx0 || this.edgeBounds[b]! > vx1 || this.edgeBounds[b + 3]! < vy0 || this.edgeBounds[b + 1]! > vy1) continue;
      if (e.end > t) {
        activeEdges.push(e);
        continue;
      }
      this.drawSettledEdge(ctx, e, t, ivory, slate, dimForFocus, focusIdx);
    }
    for (const e of activeEdges) this.drawActiveEdge(ctx, useGlow ? glow : null, e, t, ivory, slate, focusIdx);

    // --- Nodes ---
    const nodes = p.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i]!;
      if (nd.impact > t + 0.001) continue;
      if (nd.x < vx0 || nd.x > vx1 || nd.y < vy0 || nd.y > vy1) continue;
      this.drawNode(ctx, useGlow ? glow : null, nd, t, ripples, ivory, slate, focusIdx);
    }

    // --- Bodies ---
    for (const e of activeEdges) this.drawBody(ctx, useGlow ? glow : null, e, t, focusIdx);

    // --- Impact effects ---
    this.drawEffects(ctx, useGlow ? glow : null, t, ivory);

    // --- Live tip beacons ---
    for (const th of p.threads) {
      if (th.ending !== 'tip' || th.end > t) continue;
      const last = nodes[th.nodeIdxs[th.nodeIdxs.length - 1]!];
      if (!last || last.x < vx0 || last.x > vx1) continue;
      const pulse = this.settings.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.2 + last.idx);
      ctx.beginPath();
      ctx.arc(last.x, last.y, 7 + pulse * 3, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(last.isSpine ? ivory : PALETTE.accent, 0.25 + pulse * 0.25);
      ctx.lineWidth = 1.2 / Math.sqrt(v.scale);
      ctx.stroke();
    }

    ctx.restore();

    if (useGlow) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = 'blur(6px)';
      ctx.globalAlpha = this.settings.noFlash ? 0.55 : 0.85;
      ctx.drawImage(this.glow, 0, 0, this.glow.width, this.glow.height, 0, 0, this.canvas.width, this.canvas.height);
      ctx.filter = 'none';
      ctx.restore();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    // --- Screen-space labels & selection ---
    this.drawLabels(ctx, t);
    if (this.attenuation < 1) {
      ctx.fillStyle = rgba(PALETTE.ink, 1 - this.attenuation);
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  private drawBackground(t: number) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(26,30,44,0.55)');
    g.addColorStop(1, 'rgba(7,8,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (this.settings.quality === 'minimal') return;
    // Dust: deterministic slow drift, faster during quiet gaps is handled by the caption; keep it calm.
    const drift = this.settings.reducedMotion ? 0 : t * 0.004;
    ctx.fillStyle = 'rgba(200,210,230,0.16)';
    for (let i = 0; i < 90; i++) {
      const x = ((this.dust[i * 3]! + drift * this.dust[i * 3 + 2]!) % 1) * w;
      const y = ((this.dust[i * 3 + 1]! + drift * 0.35) % 1) * h;
      const s = this.dust[i * 3 + 2]!;
      ctx.fillRect(x, y, s, s);
    }
  }

  private drawEmptyStage(t: number) {
    const ctx = this.ctx;
    const cx = this.width / 2;
    const cy = (this.height - this.settings.safe.bottom + this.settings.safe.top) / 2;
    const pulse = this.settings.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.4);
    ctx.beginPath();
    ctx.arc(cx, cy, 16 + pulse * 6, 0, Math.PI * 2);
    ctx.fillStyle = rgba(PALETTE.ivory, 0.06 + pulse * 0.05);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = rgba(PALETTE.ivory, 0.5);
    ctx.fill();
  }

  private settledAlpha(e: EdgeGeom, t: number): number {
    const p = this.perf!;
    const th = p.threads[e.threadIdx]!;
    const isSpine = p.nodes[e.child]!.isSpine && p.nodes[e.parent]?.isSpine !== false;
    if (isSpine && e.kind !== 'secondary') return 0.95;
    const age = t - e.end;
    const floor = th.ending === 'merged' ? 0.26 : 0.4;
    const base = e.kind === 'secondary' ? 0.5 : 0.78;
    return floor + (base - floor) * Math.exp(-age / 14);
  }

  private drawPolyline(ctx: CanvasRenderingContext2D, pts: Float32Array, u = 1) {
    const count = pts.length >> 1;
    if (count < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0]!, pts[1]!);
    const f = u * (count - 1);
    const full = Math.min(count - 1, Math.floor(f));
    for (let i = 1; i <= full; i++) ctx.lineTo(pts[i * 2]!, pts[i * 2 + 1]!);
    if (full < count - 1) {
      const k = f - full;
      const x = pts[full * 2]! + (pts[full * 2 + 2]! - pts[full * 2]!) * k;
      const y = pts[full * 2 + 1]! + (pts[full * 2 + 3]! - pts[full * 2 + 1]!) * k;
      ctx.lineTo(x, y);
    }
  }

  private drawSettledEdge(ctx: CanvasRenderingContext2D, e: EdgeGeom, t: number, ivory: string, slateBase: string, dim: number, focusIdx: number) {
    const p = this.perf!;
    const slate = this.tints[e.threadIdx] ?? slateBase;
    const child = p.nodes[e.child]!;
    const parent = e.parent >= 0 ? p.nodes[e.parent]! : null;
    const spine = child.isSpine && (parent ? parent.isSpine : true) && e.kind !== 'secondary';
    const threadSel = this.settings.selectedThread;
    const selected = threadSel != null && e.threadIdx === threadSel;
    let alpha = this.settledAlpha(e, t) * (selected ? 1 : dim);
    if (focusIdx >= 0 && (e.contributorIdx === focusIdx || e.fromContributorIdx === focusIdx)) alpha = Math.max(alpha, 0.85);
    const lw = 1 / Math.sqrt(this.view.scale);
    if (e.kind === 'unknown') {
      ctx.setLineDash([6, 7]);
      ctx.strokeStyle = rgba(PALETTE.fog, 0.55);
      ctx.lineWidth = 1.4 * lw;
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    if (e.kind === 'aggregate') {
      const count = p.aggregates.find((a) => a.boundaryShas[1] === child.sha)?.memberCount ?? 0;
      const width = Math.min(16, 5 + Math.log2(1 + count) * 1.6);
      ctx.strokeStyle = rgba(spine ? ivory : slate, alpha * 0.28);
      ctx.lineWidth = width;
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      ctx.strokeStyle = rgba(spine ? ivory : slate, alpha * 0.75);
      ctx.lineWidth = 1.6;
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      return;
    }
    if (spine) {
      ctx.strokeStyle = rgba(ivory, alpha * 0.22);
      ctx.lineWidth = 7;
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      ctx.strokeStyle = rgba(ivory, alpha);
      ctx.lineWidth = 2.6;
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      // A slow light runs back along everything already built, so the finished
      // structure keeps breathing instead of turning into wallpaper.
      if (!this.settings.reducedMotion && this.sweepX > -Infinity) {
        const mid = (e.pts[0]! + e.pts[e.pts.length - 2]!) / 2;
        const d = Math.abs(mid - this.sweepX);
        if (d < 240) {
          const k = Math.pow(1 - d / 240, 2);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = rgba(ivory, 0.4 * k);
          ctx.lineWidth = 3.4;
          this.drawPolyline(ctx, e.pts);
          ctx.stroke();
          ctx.restore();
        }
      }
      return;
    }
    ctx.strokeStyle = rgba(selected ? PALETTE.accent : slate, alpha);
    ctx.lineWidth = e.kind === 'secondary' ? 1.1 : 1.7;
    this.drawPolyline(ctx, e.pts);
    ctx.stroke();
  }

  private travelU(e: EdgeGeom, t: number): number {
    const f = Math.max(0, Math.min(1, (t - e.start) / Math.max(1e-6, e.end - e.start)));
    if (this.settings.reducedMotion) return f; // steady reveal
    // accelerate into the landing so arrivals read as hits
    return e.kind === 'merge' ? f * f * (3 - 2 * f) * 0.6 + 0.4 * Math.pow(f, 1.7) : Math.pow(f, 1.6);
  }

  private drawActiveEdge(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D | null, e: EdgeGeom, t: number, ivory: string, slateBase: string, focusIdx: number) {
    const p = this.perf!;
    const slate = this.tints[e.threadIdx] ?? slateBase;
    const child = p.nodes[e.child]!;
    const parent = e.parent >= 0 ? p.nodes[e.parent]! : null;
    const spine = child.isSpine && (parent ? parent.isSpine : true) && e.kind !== 'secondary';
    const u = this.travelU(e, t);
    const color = p.contributors[e.contributorIdx]?.color ?? PALETTE.accent;
    const focused = focusIdx < 0 || e.contributorIdx === focusIdx;
    const dim = focused ? 1 : 0.3;
    // Intent: faint full path for approaches so convergence is legible before the hit.
    if (e.kind === 'merge' || e.kind === 'secondary' || e.kind === 'divergence') {
      const tension = e.kind === 'merge' ? 0.18 + 0.22 * u : 0.12;
      ctx.strokeStyle = rgba(spine ? ivory : slate, tension * dim);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      this.drawPolyline(ctx, e.pts);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (e.kind === 'unknown') {
      ctx.setLineDash([6, 7]);
      ctx.strokeStyle = rgba(PALETTE.fog, 0.6 * dim);
      ctx.lineWidth = 1.4;
      this.drawPolyline(ctx, e.pts, u);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    const structural = spine ? ivory : slate;
    const width = e.kind === 'aggregate' ? 8 : spine ? 2.8 : e.kind === 'secondary' ? 1.2 : 1.9;
    // revealed structural path
    ctx.strokeStyle = rgba(structural, (spine ? 0.95 : 0.85) * dim);
    ctx.lineWidth = width;
    this.drawPolyline(ctx, e.pts, u);
    ctx.stroke();
    // contributor energy flowing through the revealed path (never recolors the structure permanently)
    const trailLen = this.settings.reducedMotion ? 0 : 0.35;
    if (trailLen > 0) {
      const from = Math.max(0, u - trailLen);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const a = pointAt(e.pts, from, this.tmp);
      const b = pointAt(e.pts, u, this.tmp2);
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, rgba(color, 0));
      grad.addColorStop(1, rgba(color, 0.55 * dim));
      ctx.strokeStyle = grad;
      ctx.lineWidth = width + 1.5;
      this.drawPartial(ctx, e.pts, from, u);
      ctx.stroke();
      ctx.restore();
      if (glow) {
        glow.strokeStyle = rgba(color, 0.5 * dim);
        glow.lineWidth = width + 4;
        this.drawPartial(glow, e.pts, from, u);
        glow.stroke();
      }
    }
  }

  private drawPartial(ctx: CanvasRenderingContext2D, pts: Float32Array, u0: number, u1: number) {
    const count = pts.length >> 1;
    if (count < 2) return;
    const f0 = u0 * (count - 1);
    const f1 = u1 * (count - 1);
    const a = pointAt(pts, u0, this.tmp);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    for (let i = Math.floor(f0) + 1; i <= Math.floor(f1) && i < count; i++) ctx.lineTo(pts[i * 2]!, pts[i * 2 + 1]!);
    const b = pointAt(pts, u1, this.tmp2);
    ctx.lineTo(b.x, b.y);
  }

  private activeRipples(t: number): Array<{ x: number; y: number; age: number; amp: number; reach: number }> {
    if (this.settings.reducedMotion) return [];
    const out: Array<{ x: number; y: number; age: number; amp: number; reach: number }> = [];
    for (const ev of this.impactEvents) {
      if (!HEAVY.has(ev.type)) continue;
      const age = t - ev.performanceImpact;
      if (age < 0 || age > 2.4) continue;
      const nd = this.nodeBySha.get(ev.subjectIds[0]!);
      if (!nd) continue;
      out.push({ x: nd.x, y: nd.y, age, amp: (4 + 9 * ev.salience) * ev.effectBudget * volumeScale(nd.mergeVolume), reach: 220 * volumeScale(nd.mergeVolume) });
    }
    return out;
  }

  private drawNode(
    ctx: CanvasRenderingContext2D,
    glow: CanvasRenderingContext2D | null,
    nd: NodeGeom,
    t: number,
    ripples: Array<{ x: number; y: number; age: number; amp: number; reach: number }>,
    ivory: string,
    slateBase: string,
    focusIdx: number,
  ) {
    const p = this.perf!;
    const slate = this.tints[nd.threadIdx] ?? slateBase;
    const age = t - nd.impact;
    let x = nd.x;
    let y = nd.y;
    // Existing geometry reacts: radial ripple from merge impacts, and a faint breath.
    for (const r of ripples) {
      const d = Math.hypot(x - r.x, y - r.y);
      if (d < 4 || d > r.reach) continue;
      const wave = Math.sin((d / 34 - r.age * 6.5) * 1.0) * Math.exp(-r.age * 1.6) * (1 - d / r.reach);
      const k = (r.amp * wave) / d;
      x += (x - r.x) * k;
      y += (y - r.y) * k;
    }
    if (!this.settings.reducedMotion && age > 2) y += 0.7 * Math.sin(t * 1.1 + nd.idx * 0.7);

    const pop = this.settings.reducedMotion ? 1 : 1 + 1.3 * Math.exp(-age * 6) * Math.sin(Math.min(age, 0.8) * 9);
    const contributor = p.contributors[nd.contributorIdx];
    const color = contributor?.color ?? PALETTE.accent;
    const focused = focusIdx < 0 || nd.contributorIdx === focusIdx;
    const dim = focused ? 1 : 0.3;
    const selected = this.settings.selectedNode === nd.idx || this.settings.hoverNode === nd.idx;
    const threadSel = this.settings.selectedThread != null && nd.threadIdx === this.settings.selectedThread;
    const structural = nd.isSpine ? ivory : threadSel ? PALETTE.accent : slate;
    const baseR = nd.isMerge ? 5.2 * Math.min(2.1, volumeScale(nd.mergeVolume)) : nd.isSpine ? 4.1 : 3.2;
    const r = baseR * pop * (1 + nd.salience * 0.5);

    // arrival halo in the contributor's color, fading — human energy touching structure
    if (age < 1.4 && !this.settings.reducedMotion) {
      const a = 1 - age / 1.4;
      ctx.beginPath();
      ctx.arc(x, y, r + 4 + age * 14, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(color, 0.45 * a * dim);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (glow) {
        glow.beginPath();
        glow.arc(x, y, r + 3, 0, Math.PI * 2);
        glow.fillStyle = rgba(color, 0.7 * a * dim);
        glow.fill();
      }
    }
    if (nd.kind === 'root') {
      const seed = this.settings.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.3);
      ctx.beginPath();
      ctx.arc(x, y, r + 6 + seed * 2, 0, Math.PI * 2);
      ctx.fillStyle = rgba(ivory, 0.08 * dim);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(structural, (nd.isSpine ? 1 : 0.92) * dim);
    ctx.fill();
    if (nd.isMerge) {
      ctx.beginPath();
      ctx.arc(x, y, r + 2.6, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(structural, 0.8 * dim);
      ctx.lineWidth = 1.3;
      ctx.stroke();
      if (nd.parentCount > 2) {
        ctx.beginPath();
        ctx.arc(x, y, r + 5.2, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(structural, 0.5 * dim);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    if (nd.kind === 'boundary') {
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(PALETTE.fog, 0.7 * dim);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // persistent contributor ring: who touched this commit, readable when paused
    if (age > 0.05) {
      ctx.beginPath();
      ctx.arc(x, y, r + 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(color, (focusIdx === nd.contributorIdx ? 0.9 : 0.38) * dim);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (nd.tagLabels.length) {
      ctx.beginPath();
      ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(ivory, 0.55 * dim);
      ctx.lineWidth = 1;
      ctx.setLineDash([1.5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, r + 8, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(PALETTE.accent, 0.95);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  private drawGlyph(ctx: CanvasRenderingContext2D, glyph: string, x: number, y: number, r: number, heading: number) {
    ctx.save();
    ctx.translate(x, y);
    if (glyph === 'triangle' || glyph === 'diamond') ctx.rotate(heading + Math.PI / 2);
    ctx.beginPath();
    (GLYPH_PATHS[this.settings.showGlyphs ? glyph : 'orb'] ?? GLYPH_PATHS.orb!)(ctx, r);
    ctx.restore();
  }

  private drawBody(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D | null, e: EdgeGeom, t: number, focusIdx: number) {
    const p = this.perf!;
    const u = this.travelU(e, t);
    const f = Math.max(0, Math.min(1, (t - e.start) / Math.max(1e-6, e.end - e.start)));
    const contributor = p.contributors[e.contributorIdx];
    const from = e.fromContributorIdx >= 0 ? p.contributors[e.fromContributorIdx] : null;
    const handoff = !!from && e.fromContributorIdx !== e.contributorIdx && (e.kind === 'thread' || e.kind === 'aggregate');
    const color = handoff && from ? mixHex(from.color, contributor?.color ?? PALETTE.accent, f) : contributor?.color ?? PALETTE.accent;
    const focused = focusIdx < 0 || e.contributorIdx === focusIdx || (handoff && e.fromContributorIdx === focusIdx);
    const dim = focused ? 1 : 0.25;
    const isPerformer = e.body === 'performer';
    const size = (isPerformer ? 4.6 : 3) * (e.kind === 'aggregate' ? 1.25 : 1);
    const pos = pointAt(e.pts, u, this.tmp);
    const heading = headingAt(e.pts, u);
    const glyph = contributor?.glyph ?? 'orb';
    const bot = contributor?.isBot;

    if (this.settings.reducedMotion) {
      // Steady marker at the arrival node instead of a traveling comet.
      const end = pointAt(e.pts, 1, this.tmp2);
      ctx.beginPath();
      ctx.arc(end.x, end.y, size + 3, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(color, (0.3 + 0.5 * f) * dim);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      this.drawGlyph(ctx, glyph, pos.x, pos.y, size * 0.8, heading);
      ctx.fillStyle = rgba(color, 0.9 * dim);
      ctx.fill();
      return;
    }

    // comet trail: earlier positions along the exact path
    const trailN = this.settings.quality === 'full' ? (isPerformer ? 11 : 6) : 5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = trailN; k >= 1; k--) {
      const uu = u - (k * 0.028 * (isPerformer ? 1 : 0.7)) / Math.max(0.4, e.length / 120);
      if (uu < 0) continue;
      const q = pointAt(e.pts, uu, this.tmp2);
      const a = (1 - k / (trailN + 1)) * 0.5 * dim;
      const rr = size * (1 - k / (trailN + 2)) * 0.8;
      if (bot) {
        if (k % 2) continue;
        ctx.fillStyle = rgba(color, a);
        ctx.fillRect(q.x - rr / 2, q.y - rr / 2, rr, rr);
      } else {
        ctx.beginPath();
        ctx.arc(q.x, q.y, rr, 0, Math.PI * 2);
        ctx.fillStyle = rgba(color, a);
        ctx.fill();
      }
    }
    // halo
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, size * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, 0.22 * dim);
    ctx.fill();
    ctx.restore();
    // handoff: the departing signature lingers just behind, fading
    if (handoff && from && f < 0.7) {
      const q = pointAt(e.pts, Math.max(0, u - 0.05), this.tmp2);
      this.drawGlyph(ctx, from.glyph, q.x, q.y, size * 0.75, heading);
      ctx.fillStyle = rgba(from.color, (1 - f / 0.7) * 0.8 * dim);
      ctx.fill();
    }
    // core
    this.drawGlyph(ctx, glyph, pos.x, pos.y, size, heading);
    ctx.fillStyle = rgba(color, 0.95 * dim);
    ctx.fill();
    this.drawGlyph(ctx, glyph, pos.x, pos.y, size * 0.45, heading);
    ctx.fillStyle = rgba('#ffffff', 0.9 * dim);
    ctx.fill();
    if (glow) {
      glow.beginPath();
      glow.arc(pos.x, pos.y, size * 1.8, 0, Math.PI * 2);
      glow.fillStyle = rgba(color, 0.9 * dim);
      glow.fill();
    }
    // aggregate ribbons carry an internal rhythm: ticks flowing behind the performer
    if (e.kind === 'aggregate') {
      const count = p.aggregates.find((a) => a.boundaryShas[1] === p.nodes[e.child]!.sha)?.memberCount ?? 8;
      const ticks = Math.min(24, count);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < ticks; k++) {
        const uu = (k / ticks) * u;
        const q = pointAt(e.pts, uu, this.tmp2);
        const blink = 0.35 + 0.35 * Math.sin(t * 9 + k * 1.7);
        ctx.fillStyle = rgba(color, blink * dim);
        ctx.fillRect(q.x - 1, q.y - 3, 2, 6);
      }
      ctx.restore();
    }
  }

  private drawEffects(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D | null, t: number, ivory: string) {
    const noFlash = this.settings.noFlash;
    const reduced = this.settings.reducedMotion;
    for (const ev of this.impactEvents) {
      const age = t - ev.performanceImpact;
      if (age < -0.6 || age > 3) continue;
      const nd = this.nodeBySha.get(ev.subjectIds[0]!);
      if (!nd) continue;
      const budget = ev.effectBudget;
      if (HEAVY.has(ev.type)) {
        if (age < 0) {
          // anticipation: tightening ring converging on the merge node
          const a = 1 + age / 0.6;
          const vsA = volumeScale(nd.mergeVolume);
          ctx.beginPath();
          ctx.arc(nd.x, nd.y, (26 * (1 - a) + 6) * vsA, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(ivory, 0.35 * a * budget);
          ctx.lineWidth = 1;
          ctx.stroke();
          continue;
        }
        const release = Math.max(0.6, ev.performanceEnd - ev.performanceImpact);
        const a = Math.min(1, age / release);
        const vs = volumeScale(nd.mergeVolume);
        const radius = reduced ? (16 + 22 * (0.6 + ev.salience * 0.7)) * budget * vs : (12 + 96 * Math.sqrt(a) * (0.6 + ev.salience * 0.7)) * budget * vs;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(PALETTE.merge, (1 - a) * (1 - a) * 0.75 * budget);
        ctx.lineWidth = (1.8 * (1 - a) + 0.5) * Math.min(2.4, vs);
        ctx.stroke();
        if (ev.type !== 'MERGE_IMPACT' && !reduced) {
          ctx.beginPath();
          ctx.arc(nd.x, nd.y, radius * 0.62, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(ivory, (1 - a) * 0.4 * budget);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        // Spokes: one per converging parent, so an octopus reads instantly.
        if (!reduced && age < 0.7 && nd.parentCount > 1) {
          const k = 1 - age / 0.7;
          const spokes = Math.min(12, nd.parentCount);
          for (let i = 0; i < spokes; i++) {
            const ang = (i / spokes) * Math.PI * 2 + nd.idx;
            const r0 = 8 + 26 * (1 - k) * vs;
            const r1 = r0 + 16 * k * vs;
            ctx.beginPath();
            ctx.moveTo(nd.x + Math.cos(ang) * r0, nd.y + Math.sin(ang) * r0);
            ctx.lineTo(nd.x + Math.cos(ang) * r1, nd.y + Math.sin(ang) * r1);
            ctx.strokeStyle = rgba(PALETTE.merge, 0.5 * k * budget);
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        }
        if (age < 0.28 && !noFlash && !reduced) {
          const k = 1 - age / 0.28;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.beginPath();
          ctx.arc(nd.x, nd.y, (10 + 22 * (1 - k)) * Math.min(2, vs), 0, Math.PI * 2);
          ctx.fillStyle = rgba(PALETTE.merge, 0.55 * k * budget);
          ctx.fill();
          ctx.restore();
          if (glow) {
            glow.beginPath();
            glow.arc(nd.x, nd.y, 26 * k * (0.5 + ev.salience) * Math.min(2, vs), 0, Math.PI * 2);
            glow.fillStyle = rgba(PALETTE.merge, 0.9 * k * budget);
            glow.fill();
          }
        }
      } else if (ev.type === 'DIVERGENCE' && age >= 0 && age < 0.9 && !reduced) {
        // clean split flare at the exact junction
        const base = this.nodeBySha.get(ev.subjectIds[0]!);
        if (!base) continue;
        const k = 1 - age / 0.9;
        const dir = Math.atan2(nd.y - base.y, nd.x - base.x);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(base.x, base.y);
          ctx.lineTo(base.x + Math.cos(dir + s * 0.5) * 22 * (1 - k * 0.5), base.y + Math.sin(dir + s * 0.5) * 22 * (1 - k * 0.5));
          ctx.strokeStyle = rgba(ivory, 0.5 * k * budget);
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      } else if (ev.type === 'TAG_LANDMARK' && age >= 0 && age < 2) {
        const k = 1 - age / 2;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, 9 + age * 18, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(ivory, 0.4 * k * budget);
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if ((ev.type === 'REPO_BIRTH' || ev.type === 'MULTI_ROOT_REVEAL') && age >= 0 && age < 2.5) {
        const k = 1 - age / 2.5;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, 6 + age * (reduced ? 10 : 30), 0, Math.PI * 2);
        ctx.strokeStyle = rgba(ivory, 0.45 * k);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  private drawLabels(ctx: CanvasRenderingContext2D, t: number) {
    const p = this.perf!;
    const labels = this.settings.labels;
    ctx.font = '500 11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    const drawn: Array<{ x: number; y: number; w: number }> = [];
    const place = (x: number, y: number, text: string, alpha: number, color: string = PALETTE.text) => {
      const w = ctx.measureText(text).width + 10;
      if (x < 0 || y < this.settings.safe.top - 10 || x + w > this.width || y > this.height - this.settings.safe.bottom + 10) return;
      for (const d of drawn) if (Math.abs(d.y - y) < 14 && x < d.x + d.w && x + w > d.x) return;
      drawn.push({ x, y, w });
      ctx.fillStyle = rgba(PALETTE.ink, 0.55 * alpha);
      ctx.fillRect(x - 4, y - 8, w, 16);
      ctx.fillStyle = rgba(color, alpha);
      ctx.fillText(text, x, y);
    };
    // Thread names, budgeted. A project with thousands of short-lived pull
    // request branches would otherwise bury the stage in "thread 1617" labels
    // that say nothing. Named branches come first, the nearest to the playhead
    // win, and anonymous threads are only named when there are few enough for
    // the name to be worth reading.
    if (labels !== 'minimal') {
      const nameAnonymous = p.threads.length <= 40;
      const candidates: Array<{ th: (typeof p.threads)[number]; latest: NodeGeom; alpha: number; label: string }> = [];
      for (const th of p.threads) {
        if (th.role === 'primary') continue;
        if (!th.label && !nameAnonymous) continue;
        const first = p.nodes[th.nodeIdxs[0]!];
        if (!first || first.impact > t) continue;
        let latest = first;
        for (const id of th.nodeIdxs) {
          const nd = p.nodes[id]!;
          if (nd.impact <= t) latest = nd;
          else break;
        }
        const mergedAt = th.mergeNodeIdx != null ? p.nodes[th.mergeNodeIdx]!.impact : Infinity;
        const merged = mergedAt <= t;
        const alpha = merged ? Math.max(0, 0.55 - (t - mergedAt) / 6) : th.ending === 'tip' ? 0.85 : 0.7;
        if (alpha <= 0.02) continue;
        candidates.push({ th, latest, alpha, label: th.label ?? th.id.replace('thread-', 'thread ') });
      }
      // Named branches, then whichever landed most recently.
      candidates.sort((a, b) => Number(!!b.th.label) - Number(!!a.th.label) || b.latest.impact - a.latest.impact);
      for (const c of candidates.slice(0, 10)) {
        const scr = this.worldToScreen(c.latest.x, c.latest.y);
        place(scr.x + 12, scr.y + c.th.side * 13, c.label, c.alpha, this.tints[c.th.idx] ?? PALETTE.slate);
      }
    }
    // main line label at the spine's first node once
    const spine = p.threads[0];
    if (spine && spine.label && labels !== 'minimal') {
      const first = p.nodes[spine.nodeIdxs[0]!];
      if (first && first.impact <= t) {
        const s = this.worldToScreen(first.x, first.y);
        place(s.x - 8 - ctx.measureText(spine.label).width, s.y, spine.label, 0.8, PALETTE.ivory);
      }
    }
    // how much converged, on the merges big enough to warrant saying so
    if (labels !== 'minimal') {
      for (const nd of p.nodes) {
        if (!nd.isMerge || nd.mergeVolume < 6 || nd.impact > t) continue;
        const age = t - nd.impact;
        const alpha = Math.max(0, Math.min(1, 1 - (age - 2.2) / 1.2));
        if (alpha <= 0) continue;
        const s = this.worldToScreen(nd.x, nd.y);
        place(s.x + 12, s.y + 16, `${nd.mergeVolume} commits converge`, alpha, PALETTE.merge);
      }
    }
    // tags & aggregates
    for (const nd of p.nodes) {
      if (nd.impact > t) continue;
      if (nd.tagLabels.length && labels !== 'minimal') {
        const age = t - nd.impact;
        const alpha = labels === 'all' ? 0.85 : Math.max(0, Math.min(1, 1 - (age - 4) / 1.5));
        if (alpha > 0) {
          const s = this.worldToScreen(nd.x, nd.y);
          place(s.x + 10, s.y - 14, nd.tagLabels.join(' · '), alpha, PALETTE.ivory);
        }
      }
    }
    for (const e of p.edges) {
      if (e.kind !== 'aggregate' || e.start > t) continue;
      const agg = p.aggregates.find((a) => a.boundaryShas[1] === p.nodes[e.child]!.sha);
      if (!agg || agg.memberCount < 3) continue;
      const m = pointAt(e.pts, 0.5, this.tmp);
      const s = this.worldToScreen(m.x, m.y);
      place(s.x - 30, s.y - 14, describeAggregate(agg), 0.75, PALETTE.textDim);
    }
    for (const e of p.edges) {
      if (e.kind !== 'unknown' || e.start > t) continue;
      const m = pointAt(e.pts, 0.2, this.tmp);
      const s = this.worldToScreen(m.x, m.y);
      place(s.x - 40, s.y - 14, 'history not loaded', 0.75, PALETTE.fogText);
    }
    // live tips
    for (const th of p.threads) {
      if (th.ending !== 'tip' || th.end > t || th.role === 'primary' || !th.label) continue;
      const last = p.nodes[th.nodeIdxs[th.nodeIdxs.length - 1]!]!;
      const s = this.worldToScreen(last.x, last.y);
      place(s.x + 12, s.y, th.label, 0.7, PALETTE.accent);
    }
  }

  toBlob(type = 'image/png'): Promise<Blob | null> {
    return new Promise((resolve) => this.canvas.toBlob(resolve, type));
  }
}
