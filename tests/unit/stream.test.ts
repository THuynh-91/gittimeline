import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '@/fixtures/demo';
import {
  STREAM_MAGIC,
  STREAM_SCHEMA_VERSION,
  streamArtifact,
  readStreamedArtifact,
  streamContentHash,
  type StreamHeader,
  type StreamRecord,
} from '@/export/stream';

/**
 * The newline-delimited artifact format.
 *
 * It exists because the whole-file format cannot represent the large
 * histories: serialising Chromium's 1.8 million commits into one JSON string
 * hits V8's ~512 MB string ceiling and throws `RangeError: Invalid string
 * length` before anything is written. This reads and writes a record at a time
 * and never holds the whole thing.
 *
 * It had no tests at all, which for the file that every catalog entry is
 * stored in is the wrong number.
 */

/** Feed a generator's output through a stream, in chunks that split lines. */
function streamOf(parts: Iterable<string>, chunk = 7): ReadableStream<Uint8Array> {
  const text = [...parts].join('');
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    },
  });
}

async function read(parts: Iterable<string>, chunk?: number) {
  let header: StreamHeader | null = null;
  const records: StreamRecord[] = [];
  const trailer = await readStreamedArtifact(
    streamOf(parts, chunk),
    (h) => (header = h),
    (r) => records.push(r),
  );
  return { header: header as StreamHeader | null, records, trailer };
}

describe('streamed artifact', () => {
  it('round-trips a dataset record for record', async () => {
    const ds = buildDemoDataset();
    const { header, records, trailer } = await read(streamArtifact(ds));

    expect(header!.format).toBe(STREAM_MAGIC);
    expect(header!.schemaVersion).toBe(STREAM_SCHEMA_VERSION);
    expect(trailer.contentHash).toBe(streamContentHash(ds.contentHash));

    const commits = records.filter((r) => r.t === 'c');
    const refs = records.filter((r) => r.t === 'r');
    const people = records.filter((r) => r.t === 'p');
    expect(commits).toHaveLength(ds.commits.length);
    expect(refs).toHaveLength(ds.refs.length);
    expect(people).toHaveLength(ds.contributors.length);
    expect(commits[0]!.v).toEqual(ds.commits[0]);
  });

  it('survives chunk boundaries falling anywhere', async () => {
    // The reader keeps a tail between reads. A chunk size that never lands on
    // a newline is the case that finds an off-by-one in that seam, and a
    // one-byte chunk splits every record many times over.
    const ds = buildDemoDataset();
    const parts = [...streamArtifact(ds)];
    const whole = await read(parts, 1 << 20);
    for (const chunk of [1, 2, 3, 13, 997]) {
      const got = await read(parts, chunk);
      expect(got.records.length, `chunk size ${chunk}`).toBe(whole.records.length);
      expect(got.trailer.contentHash, `chunk size ${chunk}`).toBe(whole.trailer.contentHash);
    }
  });

  it('refuses a file that is not one of ours', async () => {
    await expect(read(['{"format":"something-else","schemaVersion":2}\n'])).rejects.toThrow(/Not a streamed/);
  });

  it('refuses a schema it does not know', async () => {
    await expect(read([`{"format":"${STREAM_MAGIC}","schemaVersion":${STREAM_SCHEMA_VERSION + 1}}\n`])).rejects.toThrow(/schema version/);
  });

  it('refuses a truncated file rather than returning a short history', async () => {
    // The failure this guards against is silent: a download cut off halfway
    // parses perfectly as far as it goes, and without the trailer there is
    // nothing to distinguish "a small repository" from "most of a large one".
    const parts = [...streamArtifact(buildDemoDataset())];
    await expect(read(parts.slice(0, parts.length - 1))).rejects.toThrow(/truncated/);
  });

  it('refuses a file with no header at all', async () => {
    await expect(read([''])).rejects.toThrow(/no header/);
  });

  it('is deterministic', async () => {
    const ds = buildDemoDataset();
    expect([...streamArtifact(ds)].join('')).toBe([...streamArtifact(ds)].join(''));
  });
});
