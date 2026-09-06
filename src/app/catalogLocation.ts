/** The release URL is public configuration, never an upload credential. */
export function resolveCatalogUrl(file: string, base: string, origin: string): string {
  if (!file || file.split('/').some(part => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) || part.includes('..'))) {
    throw new Error('Invalid catalog resource path.');
  }
  const root = new URL(base.endsWith('/') ? base : `${base}/`, origin);
  if (root.username || root.password || root.search || root.hash || !['https:', 'http:'].includes(root.protocol)) {
    throw new Error('Invalid catalog base URL.');
  }
  return new URL(file, root).href;
}

export const externalCatalog = Boolean(import.meta.env.VITE_CATALOG_BASE);

export function catalogUrl(file: string): string {
  return resolveCatalogUrl(file, import.meta.env.VITE_CATALOG_BASE || `${import.meta.env.BASE_URL}catalog/`, location.origin);
}
