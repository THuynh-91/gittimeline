import type { BranchActivity } from '@/model/types';
import { safeResource, type CatalogManifest } from './catalogPackage';

/** Optional, verified download; ordinary playback never pays for this index. */
export async function loadBranchOverview(base: string, resource: NonNullable<CatalogManifest['overview']>, signal: AbortSignal): Promise<BranchActivity[]> {
  if (!Number.isSafeInteger(resource.bytes) || resource.bytes <= 0 || resource.bytes > 16 * 1024 * 1024) throw new Error('Branch activity exceeds the download limit.');
  const response = await fetch(new URL(safeResource(resource.file), base), { signal });
  if (!response.ok || !response.body) throw new Error('Branch activity could not be downloaded.');
  let received = 0;
  const bounded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
    received += chunk.byteLength;
    if (received > resource.bytes) throw new Error('Branch activity exceeds its declared size.');
    controller.enqueue(chunk);
  } }));
  const bytes = await new Response(bounded).arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (received !== resource.bytes || hash !== resource.hash) throw new Error('Branch activity does not match this history.');
  let decoded = 0;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
    decoded += chunk.byteLength;
    if (decoded > 64 * 1024 * 1024) throw new Error('Branch activity exceeds the memory limit.');
    controller.enqueue(chunk);
  } }));
  const rows: unknown = JSON.parse(await new Response(stream).text());
  if (!Array.isArray(rows) || rows.length > 1000000 || rows.some(row => !row || typeof row.id !== 'string' || typeof row.label !== 'string' || !Number.isFinite(row.start) || !Number.isFinite(row.end) || row.start < 0 || row.end < row.start)) throw new Error('Invalid branch activity.');
  return rows as BranchActivity[];
}
