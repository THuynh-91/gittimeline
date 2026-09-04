import type { CompileOptions, Dataset, GitDanceArtifact } from '@/model/types';
import { ENGINE } from '@/model/types';
import { contentHashOf } from '@/model/hash';
import { safeJsonClone } from '@/model/sanitize';
import { buildDataset, type RawCommitRecord, type RawRef } from '@/model/dataset';

/**
 * `.gitdance` artifact: versioned JSON (optionally gzip) carrying the
 * normalized dataset and compile options. Contains data only — never code,
 * credentials or raw e-mail addresses. Import re-validates everything by
 * rebuilding the dataset through the same normalizer used for live data.
 */
export const ARTIFACT_SCHEMA_VERSION = 1;
const MAX_ARTIFACT_BYTES = 60_000_000;

export function createArtifact(dataset: Dataset, options?: CompileOptions): GitDanceArtifact {
  const artifact: GitDanceArtifact = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    format: 'gitdance',
    engine: ENGINE,
    dataset,
    ...(options ? { options } : {}),
    contentHash: '',
  };
  artifact.contentHash = contentHashOf({ dataset: dataset.contentHash, schema: ARTIFACT_SCHEMA_VERSION });
  return artifact;
}

export async function serializeArtifact(artifact: GitDanceArtifact, compress = true): Promise<Blob> {
  const json = JSON.stringify(artifact);
  if (compress && typeof CompressionStream !== 'undefined') {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return new Blob([buf], { type: 'application/gzip' });
  }
  return new Blob([json], { type: 'application/json' });
}

export class ArtifactError extends Error {}

export async function parseArtifact(blob: Blob): Promise<{ dataset: Dataset; options: CompileOptions | null }> {
  if (blob.size > MAX_ARTIFACT_BYTES) throw new ArtifactError('Artifact is larger than the 60 MB import limit.');
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  let text: string;
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new ArtifactError('This browser cannot decompress gzip artifacts.');
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    const buf = await readBounded(stream, MAX_ARTIFACT_BYTES);
    text = new TextDecoder().decode(buf);
  } else {
    text = await blob.text();
  }
  let raw: unknown;
  try {
    raw = safeJsonClone(JSON.parse(text));
  } catch {
    throw new ArtifactError('The file is not valid JSON.');
  }
  return validateArtifact(raw);
}

export function validateArtifact(raw: unknown): { dataset: Dataset; options: CompileOptions | null } {
  if (!raw || typeof raw !== 'object') throw new ArtifactError('Not a GitDance artifact.');
  const a = raw as Partial<GitDanceArtifact>;
  if (a.format !== 'gitdance') throw new ArtifactError('Not a GitDance artifact (missing format marker).');
  if (a.schemaVersion !== ARTIFACT_SCHEMA_VERSION) throw new ArtifactError(`Unsupported artifact schema version ${String(a.schemaVersion)}; this build reads version ${ARTIFACT_SCHEMA_VERSION}.`);
  const ds = a.dataset;
  if (!ds || typeof ds !== 'object' || !Array.isArray(ds.commits) || !Array.isArray(ds.refs) || !ds.source) throw new ArtifactError('Artifact is missing its dataset.');
  const expected = contentHashOf({ dataset: ds.contentHash, schema: ARTIFACT_SCHEMA_VERSION });
  if (a.contentHash !== expected) throw new ArtifactError('Artifact content hash does not match; the file may be corrupted or edited.');

  // Rebuild through the normalizer so caps and sanitization always apply.
  const rawCommits: RawCommitRecord[] = ds.commits.map((c) => ({
    sha: String(c.sha),
    parents: Array.isArray(c.parentShas) ? c.parentShas.map(String) : [],
    message: String(c.messageSubject ?? ''),
    author: { key: String(c.authorIdentityId ?? ''), name: lookupName(ds, c.authorIdentityId), login: lookupLogin(ds, c.authorIdentityId), date: c.authoredAtRaw ?? null },
    committer: c.committerIdentityId ? { key: String(c.committerIdentityId), date: c.committedAtRaw ?? null } : null,
    url: c.githubUrl ?? null,
    stats: c.stats ?? null,
  }));
  const rawRefs: RawRef[] = ds.refs.map((r) => ({ kind: r.kind === 'tag' || r.kind === 'branch' ? r.kind : 'other', name: String(r.name), targetSha: String(r.targetSha), sourceUrl: r.sourceUrl ?? null }));
  const source = {
    provider: ds.source.provider === 'github' ? ('github' as const) : ds.source.provider === 'synthetic' ? ('synthetic' as const) : ('artifact' as const),
    owner: String(ds.source.owner ?? '').slice(0, 80),
    name: String(ds.source.name ?? '').slice(0, 120),
    canonicalUrl: String(ds.source.canonicalUrl ?? '').slice(0, 300),
    apiUrl: String(ds.source.apiUrl ?? '').slice(0, 300),
    defaultBranch: ds.source.defaultBranch ? String(ds.source.defaultBranch).slice(0, 120) : null,
    selectedRef: ds.source.selectedRef ? String(ds.source.selectedRef).slice(0, 120) : null,
    selectedTipSha: ds.source.selectedTipSha ? String(ds.source.selectedTipSha).slice(0, 64) : null,
    fetchedAt: String(ds.source.fetchedAt ?? ''),
    description: ds.source.description ? String(ds.source.description).slice(0, 240) : null,
  };
  const dataset = buildDataset(source, rawCommits, rawRefs, {
    warnings: Array.isArray(ds.coverage?.warnings) ? ds.coverage.warnings.map((w) => String(w).slice(0, 300)) : [],
    reportedCommitCount: typeof ds.coverage?.reportedCommitCount === 'number' ? ds.coverage.reportedCommitCount : null,
    truncated: ds.coverage?.completeness !== 'exact',
  });
  if (dataset.contentHash !== ds.contentHash) throw new ArtifactError('Dataset content hash does not match after validation; refusing to load.');
  const options = a.options && typeof a.options === 'object' && a.options.preset ? (a.options as CompileOptions) : null;
  return { dataset, options };
}

function lookupName(ds: Dataset, id: unknown): string | null {
  const c = ds.contributors?.find((x) => x.id === id);
  return c?.displayName ?? null;
}

function lookupLogin(ds: Dataset, id: unknown): string | null {
  const c = ds.contributors?.find((x) => x.id === id);
  return c?.githubLogin ?? null;
}

async function readBounded(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new ArtifactError('Decompressed artifact exceeds the size limit.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
