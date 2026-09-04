import type { Dataset } from '@/model/types';
import { safeJsonClone } from '@/model/sanitize';
import type { LinkRels } from './ratelimit';

/**
 * IndexedDB cache: API pages keyed by URL (with ETag for conditional
 * requests), normalized datasets keyed by repository, and a recent list.
 * Everything stays on the user's device; tokens are never written here.
 */
export interface CachedPage {
  url: string;
  etag: string | null;
  status: number;
  data: unknown;
  fetchedAt: number;
  /** Next page URL from the Link header, so cached pagination can be followed offline. */
  next?: string | null;
  /**
   * The whole parsed Link header.
   *
   * A 304 response carries no body and no Link header, so everything about
   * pagination has to survive here or it is lost on revalidation — including
   * `lastPage`, which is how the size probe counts a repository's commits.
   * `next` is kept alongside for entries written before this field existed.
   */
  link?: LinkRels;
}

export interface CachedDataset {
  slug: string;
  dataset: Dataset;
  fetchedAt: number;
  tip: string | null;
}

export interface RecentRepo {
  slug: string;
  name: string;
  lastOpened: number;
  commits: number;
}

const DB_NAME = 'gitdance';
const DB_VERSION = 1;

export class ApiCache {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  readonly available: boolean;

  constructor(private factory: IDBFactory | null = typeof indexedDB !== 'undefined' ? indexedDB : null) {
    this.available = !!factory;
  }

  private open(): Promise<IDBDatabase | null> {
    if (!this.factory) return Promise.resolve(null);
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      try {
        const req = this.factory!.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'url' });
          if (!db.objectStoreNames.contains('datasets')) db.createObjectStore('datasets', { keyPath: 'slug' });
          if (!db.objectStoreNames.contains('recent')) db.createObjectStore('recent', { keyPath: 'slug' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  private async tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async getPage(url: string): Promise<CachedPage | null> {
    const v = await this.tx<CachedPage | undefined>('pages', 'readonly', (s) => s.get(url) as IDBRequest<CachedPage | undefined>);
    return v ? safeJsonClone(v) : null;
  }

  async putPage(page: CachedPage): Promise<void> {
    await this.tx('pages', 'readwrite', (s) => s.put(page));
  }

  async getDataset(slug: string): Promise<CachedDataset | null> {
    const v = await this.tx<CachedDataset | undefined>('datasets', 'readonly', (s) => s.get(slug) as IDBRequest<CachedDataset | undefined>);
    return v ? safeJsonClone(v) : null;
  }

  async putDataset(entry: CachedDataset): Promise<void> {
    await this.tx('datasets', 'readwrite', (s) => s.put(entry));
  }

  async listRecent(): Promise<RecentRepo[]> {
    const v = await this.tx<RecentRepo[]>('recent', 'readonly', (s) => s.getAll() as IDBRequest<RecentRepo[]>);
    return (v ?? []).sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 6);
  }

  async touchRecent(entry: RecentRepo): Promise<void> {
    await this.tx('recent', 'readwrite', (s) => s.put(entry));
  }

  async clearRepository(slug: string): Promise<void> {
    await this.tx('datasets', 'readwrite', (s) => s.delete(slug));
    await this.tx('recent', 'readwrite', (s) => s.delete(slug));
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const t = db.transaction('pages', 'readwrite');
      const store = t.objectStore('pages');
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        if (String(cursor.key).includes(`/repos/${slug}`)) cursor.delete();
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
  }

  async clearAll(): Promise<void> {
    const db = await this.open();
    if (!db) return;
    for (const store of ['pages', 'datasets', 'recent']) await this.tx(store, 'readwrite', (s) => s.clear());
  }

  async estimate(): Promise<{ usage: number; quota: number } | null> {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const e = await navigator.storage.estimate();
        return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
      }
    } catch {
      /* ignore */
    }
    return null;
  }
}
