import type { CompiledPerformance } from '@/model/types';
import { PALETTE } from './palette';
import { describeAggregate } from '@/analysis/aggregate';

/**
 * Static SVG poster of the compiled topology — the rendering fallback when
 * Canvas is unavailable, and the SVG export. Exact geometry, no effects.
 * Text is escaped; nothing from the repository becomes markup.
 */
export function renderPosterSvg(p: CompiledPerformance, upTo = Infinity): string {
  // Frame what has been performed so far (or everything), with breathing room.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const nd of p.nodes) {
    if (nd.impact > upTo) continue;
    minX = Math.min(minX, nd.x);
    maxX = Math.max(maxX, nd.x);
    minY = Math.min(minY, nd.y);
    maxY = Math.max(maxY, nd.y);
  }
  if (!Number.isFinite(minX)) ({ minX, minY, maxX, maxY } = p.bounds);
  const b = { minX: minX - 60, minY: Math.min(minY - 70, (minY + maxY) / 2 - 90), maxX: maxX + 60, maxY: Math.max(maxY + 70, (minY + maxY) / 2 + 90) };
  const w = Math.max(200, b.maxX - b.minX);
  const h = Math.max(120, b.maxY - b.minY);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX} ${b.minY} ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(`${p.source.owner}/${p.source.name} commit topology`)}">`);
  parts.push(`<rect x="${b.minX - 4000}" y="${b.minY - 4000}" width="${w + 8000}" height="${h + 8000}" fill="${PALETTE.ink}"/>`);
  for (const e of p.edges) {
    if (e.start > upTo) continue;
    const child = p.nodes[e.child]!;
    const parent = e.parent >= 0 ? p.nodes[e.parent] : null;
    const spine = child.isSpine && (parent ? parent.isSpine : true) && e.kind !== 'secondary';
    const d = pathOf(e.pts);
    const stroke = e.kind === 'unknown' ? PALETTE.fog : spine ? PALETTE.ivory : PALETTE.slate;
    const width = e.kind === 'aggregate' ? 6 : spine ? 2.4 : e.kind === 'secondary' ? 1 : 1.5;
    const dash = e.kind === 'unknown' ? ' stroke-dasharray="5 6"' : '';
    const opacity = e.kind === 'aggregate' ? 0.45 : spine ? 0.95 : 0.7;
    parts.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linecap="round"${dash}/>`);
  }
  for (const nd of p.nodes) {
    if (nd.impact > upTo) continue;
    const r = nd.isMerge ? 4.5 : nd.isSpine ? 3.6 : 2.8;
    const fill = nd.isSpine ? PALETTE.ivory : PALETTE.slate;
    const color = p.contributors[nd.contributorIdx]?.color ?? PALETTE.accent;
    parts.push(`<circle cx="${nd.x}" cy="${nd.y}" r="${r}" fill="${fill}"/>`);
    parts.push(`<circle cx="${nd.x}" cy="${nd.y}" r="${r + 1.6}" fill="none" stroke="${color}" stroke-opacity="0.5" stroke-width="0.8"/>`);
    if (nd.isMerge) parts.push(`<circle cx="${nd.x}" cy="${nd.y}" r="${r + 3}" fill="none" stroke="${fill}" stroke-width="1"/>`);
    if (nd.kind === 'boundary') parts.push(`<circle cx="${nd.x}" cy="${nd.y}" r="${r + 4}" fill="none" stroke="${PALETTE.fog}" stroke-dasharray="2 3" stroke-width="1"/>`);
    if (nd.tagLabels.length) parts.push(`<text x="${nd.x + 8}" y="${nd.y - 8}" font-size="9" fill="${PALETTE.ivory}" font-family="system-ui, sans-serif">${esc(nd.tagLabels.join(' · '))}</text>`);
  }
  for (const th of p.threads) {
    if (!th.label || th.role === 'primary') continue;
    const first = p.nodes[th.nodeIdxs[0]!];
    if (!first || first.impact > upTo) continue;
    parts.push(`<text x="${first.x + 6}" y="${first.y + th.side * 12 + 3}" font-size="9" fill="${PALETTE.textDim}" font-family="system-ui, sans-serif">${esc(th.label)}</text>`);
  }
  for (const e of p.edges) {
    if (e.kind !== 'aggregate' || e.start > upTo) continue;
    const agg = p.aggregates.find((a) => a.boundaryShas[1] === p.nodes[e.child]!.sha);
    if (!agg) continue;
    const mid = e.pts.length >> 2;
    parts.push(`<text x="${e.pts[mid * 2]}" y="${e.pts[mid * 2 + 1]! - 9}" font-size="9" text-anchor="middle" fill="${PALETTE.textDim}" font-family="system-ui, sans-serif">${esc(describeAggregate(agg))}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

function pathOf(pts: Float32Array): string {
  const out: string[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(`${i === 0 ? 'M' : 'L'}${pts[i]!.toFixed(1)} ${pts[i + 1]!.toFixed(1)}`);
  return out.join(' ');
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
