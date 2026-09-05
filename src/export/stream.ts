import type { Dataset } from '@/model/types';
import { ENGINE } from '@/model/types';
import { contentHashOf } from '@/model/hash';

/**
 * The streamed artifact format.
 *
 * The original format is one JSON document, and that works until it doesn't:
 * Linux is 1,481,850 commits, which is roughly 600 MB of JSON, and a
 * JavaScript string cannot exceed about 512 MB. `JSON.stringify` throws
 * `RangeError: Invalid string length` and no amount of memory helps — it is a
 * property of the language, not of the machine. LLVM, Linux and Chromium all
 * died on the same line.
 *
 * Dodging it on the writing side alone would not help, because reading it back
 * means `JSON.parse` on a string of the same size. Text has to stop being a
 * single value in *both* directions.
 *
 * So an artifact is newline-delimited JSON: a header, then one object per
 * line, then a trailer carrying the hash. It is written by appending and read
 * a line at a time, and no individual string is bigger than one commit. The
 * whole file is still gzip, so it is still one download and still compresses
 * as well as it did — better, in fact, since the repeated key names sit closer
 * together.
 *
 * The object graph at the end is exactly the same. The ceiling was never on
 * how much data could be held, only on how much of it could be one string.
 */

export const STREAM_SCHEMA_VERSION = 2;
export const STREAM_MAGIC = 'gittimeline-stream';

export interface StreamHeader {
  format: typeof STREAM_MAGIC;
  schemaVersion: number;
  engine: typeof ENGINE;
  source: Dataset['source'];
  coverage: Dataset['coverage'];
  counts: { commits: number; refs: number; contributors: number };
}

/** One line of the body. The tag is first so a reader can dispatch cheaply. */
export type StreamRecord =
  | { t: 'c'; v: Dataset['commits'][number] }
  | { t: 'r'; v: Dataset['refs'][number] }
  | { t: 'p'; v: Dataset['contributors'][number] };

export interface StreamTrailer {
  t: 'end';
  contentHash: string;
  datasetHash: string;
}

export function streamContentHash(datasetHash: string): string {
  return contentHashOf({ dataset: datasetHash, schema: STREAM_SCHEMA_VERSION });
}

/**
 * Emit an artifact line by line.
 *
 * A generator rather than a string so the caller decides where the bytes go —
 * a file on disk in CI, a `Blob` in the browser — without either of them ever
 * holding the whole thing.
 */
export function* streamArtifact(dataset: Dataset): Generator<string> {
  const header: StreamHeader = {
    format: STREAM_MAGIC,
    schemaVersion: STREAM_SCHEMA_VERSION,
    engine: ENGINE,
    source: dataset.source,
    coverage: dataset.coverage,
    counts: { commits: dataset.commits.length, refs: dataset.refs.length, contributors: dataset.contributors.length },
  };
  yield `${JSON.stringify(header)}\n`;
  for (const p of dataset.contributors) yield `${JSON.stringify({ t: 'p', v: p })}\n`;
  for (const r of dataset.refs) yield `${JSON.stringify({ t: 'r', v: r })}\n`;
  // The bulk. One line each, so the largest string this ever builds is a
  // single commit — a few hundred bytes against the half-gigabyte ceiling.
  for (const c of dataset.commits) yield `${JSON.stringify({ t: 'c', v: c })}\n`;
  const trailer: StreamTrailer = {
    t: 'end',
    datasetHash: dataset.contentHash,
    contentHash: streamContentHash(dataset.contentHash),
  };
  yield `${JSON.stringify(trailer)}\n`;
}

/**
 * Read one back.
 *
 * Takes a byte stream and calls `onRecord` per line. The caller assembles
 * whatever it needs; nothing here accumulates text beyond the line in hand and
 * whatever tail is left over from the last chunk.
 */
export async function readStreamedArtifact(
  stream: ReadableStream<Uint8Array>,
  onHeader: (h: StreamHeader) => void,
  onRecord: (r: StreamRecord) => void,
): Promise<StreamTrailer> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let tail = '';
  let header: StreamHeader | null = null;
  let trailer: StreamTrailer | null = null;

  const handle = (line: string) => {
    if (!line) return;
    const obj = JSON.parse(line) as StreamHeader | StreamRecord | StreamTrailer;
    if (!header) {
      const h = obj as StreamHeader;
      if (h.format !== STREAM_MAGIC) throw new Error('Not a streamed GitTimeline artifact.');
      if (h.schemaVersion !== STREAM_SCHEMA_VERSION) throw new Error(`Unsupported stream schema version ${String(h.schemaVersion)}.`);
      header = h;
      onHeader(h);
      return;
    }
    if ((obj as StreamTrailer).t === 'end') {
      trailer = obj as StreamTrailer;
      return;
    }
    onRecord(obj as StreamRecord);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tail += decoder.decode(value, { stream: true });
    let nl = tail.indexOf('\n');
    while (nl !== -1) {
      handle(tail.slice(0, nl));
      tail = tail.slice(nl + 1);
      nl = tail.indexOf('\n');
    }
  }
  if (tail.trim()) handle(tail.trim());
  if (!header) throw new Error('Artifact has no header.');
  if (!trailer) throw new Error('Artifact is truncated: no trailer.');
  return trailer;
}
