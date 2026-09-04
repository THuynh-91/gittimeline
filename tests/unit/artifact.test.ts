import { describe, expect, it } from 'vitest';
import { createArtifact, serializeArtifact, parseArtifact, validateArtifact, ArtifactError } from '@/export/artifact';
import { buildDemoDataset } from '@/fixtures/demo';
import { FIXTURES } from '@/fixtures/corpus';
import { compilePerformance } from '@/choreography/compile';
import { PRESET } from './compile.test';

describe('.gitdance artifact', () => {
  it('round-trips through gzip and reproduces the same performance', async () => {
    const ds = buildDemoDataset();
    const artifact = createArtifact(ds, { preset: PRESET, seed: 'shared' });
    const blob = await serializeArtifact(artifact, true);
    expect(blob.type).toBe('application/gzip');
    const { dataset, options } = await parseArtifact(blob);
    expect(dataset.contentHash).toBe(ds.contentHash);
    expect(dataset.commits.length).toBe(ds.commits.length);
    expect(options?.seed).toBe('shared');
    const a = compilePerformance(ds, { preset: PRESET, seed: 'shared' });
    const b = compilePerformance(dataset, { preset: PRESET, seed: 'shared' });
    expect(b.planHash).toBe(a.planHash);
  });

  it('round-trips uncompressed JSON', async () => {
    const ds = FIXTURES.find((f) => f.id === '07-octopus-merge')!.build();
    const blob = await serializeArtifact(createArtifact(ds), false);
    const { dataset } = await parseArtifact(blob);
    expect(dataset.commits.find((c) => c.parentShas.length >= 3)).toBeTruthy();
  });

  it('rejects tampered content, wrong schema and non-artifacts', async () => {
    const ds = buildDemoDataset();
    const artifact = createArtifact(ds);
    const json = JSON.parse(JSON.stringify(artifact));
    json.dataset.commits[0].messageSubject = 'tampered';
    expect(() => validateArtifact(json)).toThrow(ArtifactError);
    expect(() => validateArtifact({ format: 'gitdance', schemaVersion: 99 })).toThrow(/schema version/);
    expect(() => validateArtifact({ hello: 'world' })).toThrow(/Not a GitDance artifact/);
    await expect(parseArtifact(new Blob(['{not json']))).rejects.toThrow(/valid JSON/);
  });

  it('never carries raw e-mail addresses or executable content', async () => {
    const ds = buildDemoDataset();
    const blob = await serializeArtifact(createArtifact(ds), false);
    const text = await blob.text();
    expect(text).not.toMatch(/@example\.invalid/);
    expect(text).not.toMatch(/<script/i);
  });

  it('strips prototype-polluting keys on import', () => {
    const ds = buildDemoDataset();
    const artifact = createArtifact(ds);
    const json = JSON.parse(JSON.stringify(artifact).replace('"schemaVersion"', '"__proto__":{"polluted":1},"schemaVersion"'));
    const { dataset } = validateArtifact(json);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(dataset.commits.length).toBe(ds.commits.length);
  });
});
