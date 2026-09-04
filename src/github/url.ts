/**
 * Public GitHub repository URL normalization.
 * Accepts: https://github.com/o/r, github.com/o/r, o/r, git@github.com:o/r.git,
 * and tree/blob/issues/pull sub-routes (reduced to the repository).
 * Rejects gists, non-repository routes, other hosts.
 */
export interface RepoRef {
  owner: string;
  name: string;
  canonicalUrl: string;
  apiUrl: string;
  slug: string;
}

export type UrlParseResult = { ok: true; repo: RepoRef } | { ok: false; reason: UrlRejection; hint: string };

export type UrlRejection = 'empty' | 'malformed' | 'not-github' | 'gist' | 'not-a-repository' | 'reserved-route';

const OWNER = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
const NAME = /^[a-z0-9._-]{1,100}$/i;
const RESERVED = new Set([
  'settings', 'orgs', 'organizations', 'login', 'join', 'explore', 'marketplace', 'features', 'topics',
  'trending', 'collections', 'events', 'sponsors', 'about', 'pricing', 'notifications', 'new', 'issues',
  'pulls', 'search', 'apps', 'site', 'security', 'enterprise', 'team', 'customer-stories', 'readme',
  'codespaces', 'copilot', 'dashboard', 'discussions', 'stars', 'watching', 'sessions', 'account',
]);

export function parseRepoUrl(input: string): UrlParseResult {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty', hint: 'Paste a link such as github.com/owner/repository.' };

  // git@github.com:owner/repo.git
  const scp = raw.match(/^git@([^:]+):(.+)$/i);
  let hostname: string;
  let path: string;
  if (scp) {
    hostname = scp[1]!.toLowerCase();
    path = scp[2]!;
  } else {
    let candidate = raw;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
      const firstSegment = candidate.split('/')[0] ?? '';
      if (/^(www\.)?github\.com$/i.test(firstSegment)) {
        candidate = `https://${candidate}`;
      } else if (!firstSegment.includes('.') && !firstSegment.includes(':') && candidate.includes('/')) {
        // "owner/repo" shorthand — owners never contain dots, hosts always do.
        candidate = `https://github.com/${candidate}`;
      } else {
        candidate = `https://${candidate}`;
      }
    }
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return { ok: false, reason: 'malformed', hint: 'That does not look like a URL. Try github.com/owner/repository.' };
    }
    hostname = url.hostname.toLowerCase();
    path = url.pathname;
  }

  if (hostname === 'gist.github.com') return { ok: false, reason: 'gist', hint: 'Gists are not repositories. Paste a repository URL instead.' };
  if (hostname !== 'github.com' && hostname !== 'www.github.com') {
    return { ok: false, reason: 'not-github', hint: 'This hosted viewer reads public GitHub repositories only.' };
  }
  const parts = path.split('/').filter(Boolean).map((p) => decodeURIComponentSafe(p));
  if (parts.length < 2) return { ok: false, reason: 'not-a-repository', hint: 'A repository URL needs both an owner and a name: github.com/owner/repository.' };
  const owner = parts[0]!;
  let name = parts[1]!;
  if (RESERVED.has(owner.toLowerCase())) return { ok: false, reason: 'reserved-route', hint: 'That GitHub page is not a repository. Paste a link like github.com/owner/repository.' };
  name = name.replace(/\.git$/i, '');
  if (!OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') {
    return { ok: false, reason: 'not-a-repository', hint: 'Owner and repository names may only contain letters, digits, dots, dashes and underscores.' };
  }
  const slug = `${owner}/${name}`;
  return {
    ok: true,
    repo: {
      owner,
      name,
      slug,
      canonicalUrl: `https://github.com/${slug}`,
      apiUrl: `https://api.github.com/repos/${slug}`,
    },
  };
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
