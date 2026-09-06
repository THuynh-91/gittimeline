import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  analyticsEnabled,
  buildAllowlist,
  commitBucket,
  isMeasurementId,
  planEvent,
  privacyRefused,
  safePageLocation,
  type AnalyticsEvent,
  type PerformanceSource,
} from '@/app/analytics';

/**
 * The allowlist is the whole point of this module, so it is the whole point of
 * this file.
 *
 * The failure that matters is not "analytics broke", it is "analytics worked
 * and carried somebody's repository name". Every test below is a statement
 * about what may leave the browser, and the ones that matter are the negative
 * ones: given anything the visitor supplied, nothing derived from it is in the
 * payload.
 */

const CATALOG = buildAllowlist(['torvalds/linux', 'rust-lang/mdBook', 'facebook/react']);
const EMPTY = buildAllowlist([]);

/** Everything a planned event would actually transmit, as one searchable string. */
const wire = (e: AnalyticsEvent, allow = CATALOG, href = 'https://example.test/') => JSON.stringify(planEvent(e, allow, href));

describe('analytics: only the shipped catalog may be named', () => {
  it('never names a repository the visitor pasted', () => {
    const e: AnalyticsEvent = { kind: 'performance_start', source: 'repository', slug: 'acme/secret-widget', commits: 4200 };
    const plan = planEvent(e, CATALOG, 'https://example.test/');
    expect(wire(e)).not.toContain('acme');
    expect(wire(e)).not.toContain('secret-widget');
    // It is still counted, and still described — as a shape.
    expect(plan.name).toBe('performance_start');
    expect(plan.params.repository).toBe('a public repository');
    expect(plan.params.commit_bucket).toBe('1k–10k');
  });

  it('names a repository that ships with this build', () => {
    const plan = planEvent({ kind: 'performance_start', source: 'artifact', slug: 'torvalds/linux', commits: 1_481_850 }, CATALOG, 'https://example.test/');
    expect(plan.params.repository).toBe('torvalds/linux');
    expect(plan.params.commit_bucket).toBe('over 1M');
  });

  it('sends the catalog’s spelling, never the visitor’s', () => {
    // A string the visitor typed is not transmitted even when it is correct:
    // the match is case-insensitive, the value that goes out is the one this
    // build already publishes.
    const plan = planEvent({ kind: 'performance_start', source: 'repository', slug: 'RUST-LANG/MDBOOK', commits: 3293 }, CATALOG, 'https://example.test/');
    expect(plan.params.repository).toBe('rust-lang/mdBook');
    expect(wire({ kind: 'performance_start', source: 'repository', slug: 'RUST-LANG/MDBOOK', commits: 3293 })).not.toContain('MDBOOK');
  });

  it('fails closed when the catalog is unknown', () => {
    // An empty allowlist is what a failed `index.json` fetch leaves behind, and
    // the behaviour it produces has to be silence rather than trust: a name is
    // only ever emitted because it was found, never because it was not refused.
    const plan = planEvent({ kind: 'performance_start', source: 'artifact', slug: 'torvalds/linux', commits: 1_481_850 }, EMPTY, 'https://example.test/');
    expect(plan.params.repository).not.toContain('torvalds');
  });

  it('refuses a catalog entry whose slug is not shaped like a slug', () => {
    // `index.json` is a build output, but this is the last gate before a string
    // leaves the browser, so it checks the shape rather than trusting the file.
    const hostile = buildAllowlist(['ok/name', 'not-a-slug', 'a/b/c', `x/${'y'.repeat(200)}`, '../../etc/passwd']);
    expect([...hostile.values()]).toEqual(['ok/name']);
  });

  it('says nothing about a history imported from a file', () => {
    // A `.gittimeline` a visitor dropped in could be anything, including a
    // private repository someone exported. It contributes that it happened.
    const plan = planEvent({ kind: 'performance_start', source: 'artifact', slug: 'acme/internal-tools', commits: 900 }, CATALOG, 'https://example.test/');
    expect(plan.params.repository).toBe('an imported history');
    expect(plan.params.commit_bucket).toBeUndefined();
    expect(wire({ kind: 'performance_start', source: 'artifact', slug: 'acme/internal-tools', commits: 900 })).not.toContain('internal-tools');
  });

  it('says nothing at all about the demo or a fixture', () => {
    for (const source of ['demo', 'fixture'] as const) {
      const plan = planEvent({ kind: 'performance_start', source, slug: 'synthetic/demo', commits: 56 }, CATALOG, 'https://example.test/');
      expect(plan.params.repository).toBeUndefined();
      expect(plan.params.commit_bucket).toBeUndefined();
      expect(plan.params.source).toBe(source);
    }
  });

  it('redacts a catalog card click the same way', () => {
    expect(planEvent({ kind: 'catalog_open', slug: 'facebook/react', commits: 21_678 }, CATALOG, 'https://example.test/').params.repository).toBe('facebook/react');
    expect(planEvent({ kind: 'catalog_open', slug: 'acme/widget', commits: 12 }, CATALOG, 'https://example.test/').params.repository).toBe('a public repository');
  });

  it('holds for every off-catalog name, not just the ones I thought of', () => {
    // The invariant stated positively: whatever lands in `repository` comes
    // from a fixed vocabulary — the two placeholders, or a spelling this build
    // publishes. There is no path by which visitor input becomes that value,
    // which is a stronger claim than "the slug I checked for is absent".
    const vocabulary = new Set(['a public repository', 'an imported history', ...CATALOG.values()]);
    const part = fc.stringMatching(/^[A-Za-z0-9][\w.-]{0,20}$/);
    fc.assert(
      fc.property(part, part, fc.option(fc.integer({ min: 0, max: 3_000_000 }), { nil: null }), fc.constantFrom<PerformanceSource>('repository', 'artifact', 'demo', 'fixture'), (owner, name, commits, source) => {
        const slug = `${owner}/${name}`;
        fc.pre(!CATALOG.has(slug.toLowerCase()));
        const plan = planEvent({ kind: 'performance_start', source, slug, commits }, CATALOG, 'https://example.test/');
        const repo = plan.params.repository;
        return (repo === undefined || vocabulary.has(repo)) && !JSON.stringify(plan.params).includes(slug);
      }),
      { numRuns: 500 },
    );
  });
});

describe('analytics: the URL is not safe to send', () => {
  it('strips the fragment, which is where a pasted repository lives', () => {
    // GA4 fills `page_location` from `location.href` unless it is given one,
    // and a share link on this site is `#repo=owner/name`. That default alone
    // would leak every pasted repository regardless of how careful the event
    // parameters were.
    expect(safePageLocation('https://gittimeline.test/app/#repo=acme/widget&t=12.5')).toBe('https://gittimeline.test/app/');
    expect(safePageLocation('https://gittimeline.test/?utm=x#repo=acme/widget')).toBe('https://gittimeline.test/');
    expect(safePageLocation('not a url')).toBe('');
    expect(safePageLocation('')).toBe('');
  });

  it('sanitizes the location inside the planner, not only at the call site', () => {
    const sent = wire({ kind: 'page_view', view: 'player' }, CATALOG, 'https://gittimeline.test/#repo=acme/widget');
    expect(sent).not.toContain('acme');
    expect(sent).toContain('https://gittimeline.test/');
  });

  it('says a private history was watched and refuses to say anything else about it', () => {
    // A commit bucket is coarse, and a coarse number attached to a repository
    // somebody chose not to publish is still a fingerprint of it. The whole
    // argument for transmitting anything is that nothing transmitted can be
    // traced back to a private repository, so this asserts the absence of the
    // bucket as firmly as the absence of the name.
    const e: AnalyticsEvent = { kind: 'performance_start', source: 'private', slug: 'acme/secret-widget', commits: 4200 };
    const plan = planEvent(e, CATALOG, 'https://example.test/');
    expect(plan.params.repository).toBe('a private repository');
    expect(plan.params.commit_bucket).toBeUndefined();
    const sent = wire(e, CATALOG, 'https://example.test/');
    expect(sent).not.toContain('acme');
    expect(sent).not.toContain('secret-widget');
    expect(sent).not.toContain('4200');
    expect(sent).not.toContain('1k');
  });

  it('does not name a private repository even if its slug is in the catalog', () => {
    // Impossible in practice and cheap to guarantee: the allowlist is consulted
    // before anything else, so without an explicit guard ahead of it a private
    // repository whose slug collided with a shipped one would be named.
    const plan = planEvent({ kind: 'performance_start', source: 'private', slug: 'torvalds/linux', commits: 1_481_850 }, CATALOG, 'https://example.test/');
    expect(plan.params.repository).toBe('a private repository');
    expect(plan.params.commit_bucket).toBeUndefined();
  });

  it('attaches a page location to every event', () => {
    const events: AnalyticsEvent[] = [
      { kind: 'page_view', view: 'landing' },
      { kind: 'catalog_open', slug: 'torvalds/linux', commits: 1 },
      { kind: 'performance_start', source: 'demo', slug: null, commits: null },
    ];
    for (const e of events) expect(planEvent(e, CATALOG, 'https://gittimeline.test/#repo=acme/widget').params.page_location).toBe('https://gittimeline.test/');
  });
});

describe('analytics: shapes and consent', () => {
  it('buckets commit counts coarsely', () => {
    expect(commitBucket(null)).toBeNull();
    expect(commitBucket(0)).toBe('under 100');
    expect(commitBucket(99)).toBe('under 100');
    expect(commitBucket(100)).toBe('100–1k');
    expect(commitBucket(2299)).toBe('1k–10k');
    expect(commitBucket(48_272)).toBe('10k–100k');
    expect(commitBucket(339_084)).toBe('100k–1M');
    expect(commitBucket(1_481_850)).toBe('over 1M');
    expect(commitBucket(Number.NaN)).toBeNull();
  });

  it('treats Do Not Track and Global Privacy Control as a refusal', () => {
    expect(privacyRefused({ globalPrivacyControl: true }, {})).toBe(true);
    expect(privacyRefused({ doNotTrack: '1' }, {})).toBe(true);
    expect(privacyRefused({ doNotTrack: 'yes' }, {})).toBe(true);
    expect(privacyRefused({ msDoNotTrack: '1' }, {})).toBe(true);
    // Older browsers put it on `window` rather than on `navigator`.
    expect(privacyRefused({}, { doNotTrack: '1' })).toBe(true);
    expect(privacyRefused({ doNotTrack: '0' }, {})).toBe(false);
    expect(privacyRefused({}, {})).toBe(false);
  });

  it('only accepts a measurement id that looks like one', () => {
    // It arrives from the build environment and is interpolated into a script
    // URL, so its shape is checked rather than assumed.
    expect(isMeasurementId('G-ABCDE12345')).toBe(true);
    expect(isMeasurementId('')).toBe(false);
    expect(isMeasurementId('undefined')).toBe(false);
    expect(isMeasurementId('UA-12345-1')).toBe(false);
    expect(isMeasurementId('G-ABC"></script><script>x')).toBe(false);
  });

  it('is inert with no measurement id, which is development and CI', () => {
    // `VITE_GA_ID` is unset in this repository, so importing the module and
    // calling into it must do nothing at all rather than fail.
    expect(analyticsEnabled()).toBe(false);
  });
});
