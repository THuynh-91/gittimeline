import { useEffect, useState } from 'preact/hooks';
import { loadCatalogEntry } from './controller';

/**
 * Histories fetched ahead of time and shipped with the site.
 *
 * GitHub gives an anonymous visitor about sixty requests an hour — a few
 * thousand commits — and a large repository needs hundreds. The tempting fix
 * is to ship a token, and it does not work: the browser has to send it as an
 * `Authorization` header, so anyone can lift it straight out of the network
 * tab. So the fetching happens once, in CI, with a token that never leaves the
 * build, and what ships is the result. Opening one of these costs no token and
 * no GitHub requests at all.
 *
 * The list is absent, not broken, when no catalog has been built: this renders
 * nothing rather than an empty shelf.
 */
interface Entry {
  slug: string;
  title: string;
  blurb: string;
  scope: string | null;
  file: string;
  bytes: number;
  commits: number;
  merges: number;
}

export function Catalog() {
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.BASE_URL}catalog/index.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && j && Array.isArray(j.entries) && j.entries.length) setEntries(j.entries as Entry[]);
      })
      .catch(() => {
        /* no catalog built: the section simply does not appear */
      });
    return () => {
      live = false;
    };
  }, []);

  if (!entries) return null;

  return (
    <div class="catalog" data-testid="catalog">
      <h2>Or watch one already loaded</h2>
      <p class="catalog-note">Fetched ahead of time. No token, no requests.</p>
      <div class="catalog-row">
        {entries.map((e) => (
          <button
            key={e.slug}
            type="button"
            class="catalog-card"
            onClick={() => void loadCatalogEntry(e.file, e.scope ? `${e.title} · ${e.scope}` : e.title)}
            data-testid={`catalog-${e.slug.replace('/', '-')}`}
          >
            <span class="catalog-title">
              {e.title}
              {e.scope && <em>{e.scope}</em>}
            </span>
            <span class="catalog-blurb">{e.blurb}</span>
            <span class="catalog-meta">
              {e.commits.toLocaleString('en-US')} commits · {e.merges.toLocaleString('en-US')} merges · {(e.bytes / 1e6).toFixed(1)} MB
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
