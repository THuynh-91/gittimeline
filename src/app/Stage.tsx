import { useEffect, useRef } from 'preact/hooks';
import { store } from './store';
import { attachCanvas, detachCanvas, resizeRenderer, pickAt, selectNode, hoverNode, panCamera, zoomCamera, getRenderer } from './controller';
import { renderPosterSvg } from '@/renderer/poster';

/** The stage: a single canvas, pointer interactions, and the poster fallback. */
export function Stage() {
  const mode = store.rendererMode.value;
  if (mode === 'poster') return <Poster />;
  return <CanvasStage />;
}

function CanvasStage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  const pinch = useRef<{ dist: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    const canvas = ref.current!;
    const ok = attachCanvas(canvas);
    if (!ok) return;
    const ro = new ResizeObserver(() => resizeRenderer());
    ro.observe(canvas);
    resizeRenderer();
    return () => {
      ro.disconnect();
      detachCanvas();
    };
  }, []);

  const local = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: PointerEvent) => {
    if (store.mode.value !== 'player') return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
      drag.current = null;
      return;
    }
    drag.current = { x: p.x, y: p.y, moved: false, id: e.pointerId };
  };

  const onMove = (e: PointerEvent) => {
    if (store.mode.value !== 'player') return;
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch.current.dist > 0) zoomCamera(dist / pinch.current.dist, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      pinch.current.dist = dist;
      return;
    }
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      if (d.moved || Math.hypot(dx, dy) > 4) {
        d.moved = true;
        panCamera(dx, dy);
        d.x = p.x;
        d.y = p.y;
      }
      return;
    }
    if (e.pointerType === 'mouse') {
      const pick = pickAt(p.x, p.y, );
      hoverNode(pick.node ? pick.node.idx : null);
      (e.currentTarget as HTMLElement).classList.toggle('pick', !!pick.node || !!pick.aggregateEdge);
    }
  };

  const onUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      drag.current = null;
      if (!d.moved) {
        const p = local(e);
        const pick = pickAt(p.x, p.y);
        if (pick.node) selectNode(pick.node.idx);
        else if (pick.aggregateEdge) {
          store.selectedNode.value = pick.aggregateEdge.child;
          store.panel.value = 'inspector';
        } else if (store.panel.value === 'inspector') {
          selectNode(null);
          store.panel.value = 'none';
        }
      }
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (store.mode.value !== 'player') return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0016);
    zoomCamera(factor, e.clientX - r.left, e.clientY - r.top);
  };

  const manual = store.manualCamera.value;
  return (
    <div class="stage">
      <canvas
        ref={ref}
        class={manual ? 'grab' : ''}
        role="img"
        aria-label={stageLabel()}
        data-testid="stage-canvas"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => hoverNode(null)}
        onWheel={onWheel}
        onDblClick={() => {
          const r = getRenderer();
          if (r) {
            r.manual = null;
            r.zoomLock = null;
          }
          store.manualCamera.value = false;
          store.cameraLocked.value = false;
        }}
      />
    </div>
  );
}

function stageLabel(): string {
  const p = store.perf.value;
  if (!p) return 'GitDance stage';
  return `${p.source.owner}/${p.source.name}: ${p.stats.commits} commits, ${p.stats.threads} threads, ${p.stats.merges} merges. ${p.coverage.summary} Use the Events panel (E) for a textual account.`;
}

function Poster() {
  const p = store.perf.value;
  const t = store.time.value;
  if (!p) return <div class="poster" />;
  const svg = renderPosterSvg(p, t > 0 ? t : Infinity);
  return (
    <div class="poster" data-testid="poster">
      <div class="poster-art" dangerouslySetInnerHTML={{ __html: svg }} />
      <p class="note">Static poster mode: the exact topology is drawn as SVG up to the playhead. Seek with the timeline; the Events panel narrates the performance.</p>
    </div>
  );
}
