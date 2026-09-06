import { describe, expect, it } from 'vitest';
import { resolveCatalogUrl } from '@/app/catalogLocation';

describe('catalog location', () => {
  it('keeps project-site local assets under the Pages base path', () => {
    expect(resolveCatalogUrl('index.json', '/gittimeline/catalog/', 'https://example.test')).toBe('https://example.test/gittimeline/catalog/index.json');
  });
  it('pins assets to an external immutable release', () => {
    expect(resolveCatalogUrl('linux.pages/manifest.json', 'https://data.example.test/releases/v1', 'https://example.test')).toBe('https://data.example.test/releases/v1/linux.pages/manifest.json');
  });
  it('rejects traversal, external resource URLs, and credentials', () => {
    for (const name of ['../secret', '/index.json', 'https://elsewhere.test/x', 'x/%2e%2e/y', 'x?token=y']) {
      expect(() => resolveCatalogUrl(name, '/catalog/', 'https://example.test')).toThrow();
    }
    for (const base of ['https://user:secret@example.test/', 'https://example.test/?token=x', 'file:///catalog/']) {
      expect(() => resolveCatalogUrl('index.json', base, 'https://example.test')).toThrow();
    }
  });
});
