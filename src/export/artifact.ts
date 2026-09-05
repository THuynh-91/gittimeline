import type { CompileOptions, Dataset, GitTimelineArtifact } from '@/model/types';
import { ENGINE } from '@/model/types';
import { contentHashOf } from '@/model/hash';
import { safeJsonClone } from '@/model/sanitize';
import { buildDataset, type RawCommitRecord, type RawRef } from '@/model/dataset';
import { readStreamedArtifact, streamContentHash, type StreamHeader } from './stream';

/**
 * `.gittimeline` artifact: versioned JSON (optionally gzip) carrying the
 * normalized dataset and compile options. Contains data only — never code,
 * credentials or raw e-mail addresses. Import re-validates everything by
 * rebuilding the dataset through the same normalizer used for live data.
 */
export const ARTIFACT_SCHEMA_VERSION = 1;
/**
 * How large an artifact may be before it is refused.
 *
 * 60 MB was chosen when the largest thing anyone could export was a few
 * thousand commits, and it is now the binding constraint on the catalog rather
 * than a safety rail: Rust's full history is 62 MB gzipped and would have been
 * rejected by a megabyte. The real limits are the browser's memory and how
 * long a history takes to compile, neither of which this number measures.
 *
 * It stays as a bound on a *pasted* file — an artifact is untrusted input and
 * something has to stop a browser trying to inflate an arbitrary archive — but
 * set where it refuses hostile input rather than real repositories.
 */
const MAX_ARTIFACT_BYTES = 400_000_000;

export function createArtifact(dataset: Dataset, options?: CompileOptions): GitTimelineArtifact {
  const artifact: GitTimelineArtifact = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    format: 'gittimeline',
    engine: ENGINE,
    dataset,
    ...(options ? { options } : {}),
    contentHash: '',
  };
  artifact.contentHash = contentHashOf({ dataset: dataset.contentHash, schema: ARTIFACT_SCHEMA_VERSION });
  return artifact;
}

export async function serializeArtifact(artifact: GitTimelineArtifact, compress = true): Promise<Blob> {
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
  if (blob.size > MAX_ARTIFACT_BYTES) throw new ArtifactError(`Artifact is larger than the ${Math.round(MAX_ARTIFACT_BYTES / 1e6)} MB import limit.`);
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  if (gzipped && typeof DecompressionStream === 'undefined') throw new ArtifactError('This browser cannot decompress gzip artifacts.');
  const bytes = () => (gzipped ? blob.stream().pipeThrough(new DecompressionStream('gzip')) : blob.stream());

  // A streamed artifact announces itself in its first line, so a peek at the
  // first few hundred bytes decides which reader to use. Everything written
  // before the streamed format existed still opens.
  if (await looksStreamed(blob, gzipped)) return parseStreamed(bytes());

  const text = gzipped ? new TextDecoder().decode(await readBounded(bytes(), MAX_ARTIFACT_BYTES)) : await blob.text();
  let raw: unknown;
  try {
    raw = safeJsonClone(JSON.parse(text));
  } catch {
    throw new ArtifactError('The file is not valid JSON.');
  }
  return validateArtifact(raw);
}

export function validateArtifact(raw: unknown): { dataset: Dataset; options: CompileOptions | null } {
  if (!raw || typeof raw !== 'object') throw new ArtifactError('Not a GitTimeline artifact.');
  const a = raw as Partial<GitTimelineArtifact>;
  // Files written before the project was renamed carry the old marker. They
  // are the same format, so they still open — a rename is not a reason to
  // strand something a viewer already exported.
  if (a.format !== 'gittimeline' && a.format !== 'gitdance') throw new ArtifactError('Not a GitTimeline artifact (missing format marker).');
  if (a.schemaVersion !== ARTIFACT_SCHEMA_VERSION) throw new ArtifactError(`Unsupported artifact schema version ${String(a.schemaVersion)}; this build reads version ${ARTIFACT_SCHEMA_VERSION}.`);
  const ds = a.dataset;
  if (!ds || typeof ds !== 'object' || !Array.isArray(ds.commits) || !Array.isArray(ds.refs) || !ds.source) throw new ArtifactError('Artifact is missing its dataset.');
  const expected = contentHashOf({ dataset: ds.contentHash, schema: ARTIFACT_SCHEMA_VERSION });
  if (a.contentHash !== expected) throw new ArtifactError('Artifact content hash does not match; the file may be corrupted or edited.');

  // Rebuild through the normalizer so caps and sanitization always apply.
  // Contributor ids are referenced by every commit. Looking them up with
  // Array.find made validation O(commits × contributors): roughly 650 million
  // comparisons for the 60k Linux artifact. Index once so validation remains
  // linear without changing a single reconstructed identity.
  const contributorById = new Map((Array.isArray(ds.contributors) ? ds.contributors : []).map((contributor) => [contributor.id, contributor]));
  const rawCommits: RawCommitRecord[] = ds.commits.map((c) => {
    const author = contributorById.get(c.authorIdentityId);
    return {
      sha: String(c.sha),
      parents: Array.isArray(c.parentShas) ? c.parentShas.map(String) : [],
      message: String(c.messageSubject ?? ''),
      author: { key: String(c.authorIdentityId ?? ''), name: author?.displayName ?? null, login: author?.githubLogin ?? null, date: c.authoredAtRaw ?? null },
      committer: c.committerIdentityId ? { key: String(c.committerIdentityId), date: c.committedAtRaw ?? null } : null,
      url: c.githubUrl ?? null,
      stats: c.stats ?? null,
    };
  });
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

/**
 * Does this file lead with a streamed header?
 *
 * Only the first chunk is read. A gzip member has to be decompressed to see
 * inside it, but the reader is cancelled as soon as there is enough to decide,
 * so this costs a few kilobytes rather than the whole file.
 */
async function looksStreamed(blob: Blob, gzipped: boolean): Promise<boolean> {
  try {
    const src = gzipped ? blob.slice(0, 65_536).stream().pipeThrough(new DecompressionStream('gzip')) : blob.slice(0, 4096).stream();
    const reader = src.getReader();
    const { value } = await reader.read();
    void reader.cancel();
    if (!value) return false;
    return new TextDecoder().decode(value.slice(0, 200)).includes('"gittimeline-stream"');
  } catch {
    // A truncated gzip member throws here; that is not an answer to the
    // question asked, so fall through to the whole-document reader and let it
    // produce the real error.
    return false;
  }
}

/**
 * Assemble a dataset from a line-delimited artifact.
 *
 * The records go straight into the arrays the normalizer wants, so the only
 * things held are the dataset itself and one line at a time. That is the whole
 * trick: 1.48 million commits is an unremarkable amount of *data* and an
 * impossible amount of *string*.
 */
async function parseStreamed(stream: ReadableStream<Uint8Array>): Promise<{ dataset: Dataset; options: CompileOptions | null }> {
  let header: StreamHeader | null = null;
  const commits: Dataset['commits'] = [];
  const refs: Dataset['refs'] = [];
  const contributors: Dataset['contributors'] = [];
  let trailer;
  try {
    trailer = await readStreamedArtifact(
      stream,
      (h) => (header = h),
      (r) => {
        if (r.t === 'c') commits.push(r.v);
        else if (r.t === 'r') refs.push(r.v);
        else contributors.push(r.v);
      },
    );
  } catch (err) {
    throw new ArtifactError(err instanceof Error ? err.message : 'The artifact could not be read.');
  }
  const h = header as StreamHeader | null;
  if (!h) throw new ArtifactError('Artifact has no header.');
  if (trailer.contentHash !== streamContentHash(trailer.datasetHash)) {
    throw new ArtifactError('Artifact content hash does not match; the file may be corrupted or edited.');
  }
  if (commits.length !== h.counts.commits) {
    throw new ArtifactError(`Artifact is incomplete: ${commits.length.toLocaleString('en-US')} of ${h.counts.commits.toLocaleString('en-US')} commits.`);
  }
  // Rebuilt through the same normalizer as everything else, so the caps and
  // the sanitization apply to a streamed file exactly as they do to a pasted
  // one. An artifact is untrusted input however it arrived.
  return validateArtifact({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    format: 'gittimeline',
    engine: h.engine,
    dataset: { schemaVersion: 1, source: h.source, coverage: h.coverage, commits, edges: [], refs, contributors, contentHash: trailer.datasetHash },
    contentHash: contentHashOf({ dataset: trailer.datasetHash, schema: ARTIFACT_SCHEMA_VERSION }),
  });
}
