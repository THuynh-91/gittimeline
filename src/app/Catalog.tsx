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
 * Each card leads with a *real frame of that performance* — the final tableau,
 * captured at build time — because the shape of a history is the thing worth
 * choosing between, and a column of repository names is not. The picture also
 * sets an honest expectation: a linear project and a pull-request treadmill
 * look nothing alike, and you can see which you are about to watch.
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
  poster: string | null;
  bytes: number;
  commits: number;
  merges: number;
  contributors: number;
}

const fmt = (n: number) => n.toLocaleString('en-US');

export function Catalog({ heading = true }: { heading?: boolean }) {
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
    <section class="catalog" data-testid="catalog" aria-label="Histories ready to watch">
      {heading && (
        <div class="catalog-head">
          <h2 id="catalog-heading">Ready to watch</h2>
          <p>Fetched ahead of time — no token, no requests.</p>
        </div>
      )}
      <div class="catalog-row">
        {entries.map((e) => (
          <button
            key={e.slug}
            type="button"
            class="catalog-card"
            onClick={() => void loadCatalogEntry(e.file, e.scope ? `${e.title} · ${e.scope}` : e.title)}
            data-testid={`catalog-${e.slug.replace('/', '-')}`}
          >
            <span class="catalog-shot">
              {e.poster ? (
                <img src={`${import.meta.env.BASE_URL}catalog/${e.poster}`} alt={`The shape of ${e.slug}'s history`} loading="lazy" decoding="async" />
              ) : null}
              {e.scope && <em class="catalog-scope">{e.scope}</em>}
            </span>
            <span class="catalog-body">
              <span class="catalog-title">{e.title}</span>
              <span class="catalog-slug">{e.slug}</span>
              <span class="catalog-blurb">{e.blurb}</span>
              <span class="catalog-meta">
                <b>{fmt(e.commits)}</b> commits
                <i />
                <b>{fmt(e.merges)}</b> merges
                <i />
                <b>{fmt(e.contributors)}</b> people
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
