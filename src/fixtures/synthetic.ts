import { sha256Hex } from '@/model/hash';
import { buildDataset, type RawCommitRecord, type RawRef } from '@/model/dataset';
import type { Dataset, RepositorySource } from '@/model/types';

/**
 * Deterministic synthetic repository builder. Commit SHAs derive from the
 * fixture name and commit label, so every fixture is reproducible and
 * inspectable. Nothing here touches the network.
 */
export interface Persona {
  name: string;
  login?: string;
  email?: string;
  bot?: boolean;
}

export interface CommitSpec {
  /** Stable label used to derive the SHA and to reference the commit as a parent. */
  id: string;
  parents: string[];
  by: Persona;
  /** Offset from the fixture epoch in days (fractions allowed). */
  at: number;
  message?: string;
  stats?: { additions: number; deletions: number; filesChanged: number };
  /** Emit this commit but mark its listed parents as absent (partial history). */
  missingParents?: string[];
  /** Override the timestamp completely (for clock-skew / missing-date fixtures). */
  rawDate?: string | null;
}

export interface RefSpec {
  kind: 'branch' | 'tag';
  name: string;
  target: string;
}

export interface SyntheticSpec {
  name: string;
  owner?: string;
  epoch: string;
  defaultBranch: string;
  commits: CommitSpec[];
  refs: RefSpec[];
  description?: string;
  truncated?: boolean;
  reportedCommitCount?: number | null;
}

export function shaFor(fixture: string, label: string): string {
  return sha256Hex(`${fixture}:${label}`).slice(0, 40);
}

export function buildSynthetic(spec: SyntheticSpec): Dataset {
  const epoch = Date.parse(spec.epoch);
  const sha = (label: string) => shaFor(spec.name, label);
  const omitted = new Set<string>();
  for (const c of spec.commits) for (const m of c.missingParents ?? []) omitted.add(m);

  const raw: RawCommitRecord[] = spec.commits
    .filter((c) => !omitted.has(c.id))
    .map((c) => {
      const date = c.rawDate === undefined ? new Date(epoch + c.at * 86_400_000).toISOString() : c.rawDate;
      return {
        sha: sha(c.id),
        parents: c.parents.map(sha),
        message: c.message ?? `${c.id}`,
        author: { name: c.by.name, login: c.by.login ?? null, email: c.by.email ?? `${c.by.name.toLowerCase().replace(/\s+/g, '.')}@example.invalid`, date },
        committer: { name: c.by.name, login: c.by.login ?? null, date },
        stats: c.stats ?? null,
      };
    });
  const refs: RawRef[] = spec.refs.map((r) => ({ kind: r.kind, name: r.name, targetSha: sha(r.target) }));
  const owner = spec.owner ?? 'gittimeline';
  const source: RepositorySource = {
    provider: 'synthetic',
    owner,
    name: spec.name,
    canonicalUrl: `synthetic://${owner}/${spec.name}`,
    apiUrl: '',
    defaultBranch: spec.defaultBranch,
    selectedRef: spec.defaultBranch,
    selectedTipSha: refs.find((r) => r.kind === 'branch' && r.name === spec.defaultBranch)?.targetSha ?? null,
    fetchedAt: '1970-01-01T00:00:00.000Z',
    description: spec.description ?? null,
  };
  return buildDataset(source, raw, refs, { truncated: spec.truncated ?? omitted.size > 0, reportedCommitCount: spec.reportedCommitCount ?? null });
}

/** Small imperative helper for scripting histories in fixtures. */
export class Script {
  readonly commits: CommitSpec[] = [];
  readonly refs: RefSpec[] = [];
  private heads = new Map<string, string>();
  private clock = 0;

  constructor(private readonly name: string, readonly epoch: string, readonly defaultBranch = 'main') {}

  /** Advance the shared clock by `days` and return it. */
  tick(days: number): number {
    this.clock += days;
    return this.clock;
  }

  get now(): number {
    return this.clock;
  }

  head(branch: string): string | undefined {
    return this.heads.get(branch);
  }

  commit(branch: string, id: string, by: Persona, opts: Partial<Omit<CommitSpec, 'id' | 'by' | 'parents'>> & { parents?: string[]; days?: number } = {}): string {
    if (opts.days) this.tick(opts.days);
    const head = this.heads.get(branch);
    const parents = opts.parents ?? (head ? [head] : []);
    const spec: CommitSpec = {
      id,
      parents,
      by,
      at: opts.at ?? this.clock,
      message: opts.message ?? id.replace(/[-_]/g, ' '),
    };
    if (opts.stats) spec.stats = opts.stats;
    if (opts.missingParents) spec.missingParents = opts.missingParents;
    if (opts.rawDate !== undefined) spec.rawDate = opts.rawDate;
    this.commits.push(spec);
    this.heads.set(branch, id);
    return id;
  }

  branch(newBranch: string, from: string) {
    const head = this.heads.get(from);
    if (head) this.heads.set(newBranch, head);
  }

  merge(into: string, from: string | string[], id: string, by: Persona, opts: { days?: number; message?: string; at?: number } = {}): string {
    if (opts.days) this.tick(opts.days);
    const sources = Array.isArray(from) ? from : [from];
    const first = this.heads.get(into);
    const parents = [first, ...sources.map((s) => this.heads.get(s))].filter((p): p is string => !!p);
    const spec: CommitSpec = { id, parents, by, at: opts.at ?? this.clock, message: opts.message ?? `Merge ${sources.join(', ')} into ${into}` };
    this.commits.push(spec);
    this.heads.set(into, id);
    return id;
  }

  tag(name: string, target: string) {
    this.refs.push({ kind: 'tag', name, target });
  }

  /** Keep this branch as a live ref in the final dataset. */
  keep(branch: string) {
    const head = this.heads.get(branch);
    if (head) this.refs.push({ kind: 'branch', name: branch, target: head });
  }

  build(extra: Partial<SyntheticSpec> = {}): Dataset {
    if (!this.refs.some((r) => r.kind === 'branch' && r.name === this.defaultBranch)) this.keep(this.defaultBranch);
    return buildSynthetic({ name: this.name, epoch: this.epoch, defaultBranch: this.defaultBranch, commits: this.commits, refs: this.refs, ...extra });
  }
}

export const PEOPLE = {
  mara: { name: 'Mara Ekwueme', login: 'mara-e' },
  devi: { name: 'Devi Raman', login: 'deviraman' },
  kofi: { name: 'Kofi Mensah', login: 'kofim' },
  ines: { name: 'Inés Salgado', login: 'inessalgado' },
  yuki: { name: 'Yuki Tanaka', login: 'yukit' },
  bot: { name: 'dependabot[bot]', login: 'dependabot[bot]', bot: true },
  anon: { name: 'Anonymous', email: 'someone@nowhere.invalid' },
} satisfies Record<string, Persona>;
