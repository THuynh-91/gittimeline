import { useState } from 'preact/hooks';
import { store, updateSettings, type PanelId } from './store';
import {
  seek,
  selectNode,
  selectThread,
  focusContributor,
  scheduleRecompile,
  applySettingsToRuntime,
  refetchCurrent,
} from './controller';
import { fmtClock, fmtDate } from '@/choreography/events';
import { Icons } from './icons';
import type { CompiledPerformance, NodeGeom } from '@/model/types';

export function Panels() {
  const id = store.panel.value;
  if (id === 'none') return null;
  const titles: Record<PanelId, string> = { none: '', inspector: 'Commit', settings: 'Settings', help: 'How it works' };
  return (
    <aside class="panel" role="dialog" aria-label={titles[id]} data-testid={`panel-${id}`}>
      <header>
        <h2>{titles[id]}</h2>
        <button type="button" class="icon-btn" aria-label="Close panel" onClick={() => (store.panel.value = 'none')}>
          <Icons.close />
        </button>
      </header>
      <div class="body">
        {id === 'inspector' && <Inspector />}
        {id === 'settings' && <SettingsPanel />}
        {id === 'help' && <HelpPanel />}
      </div>
    </aside>
  );
}

function Pill({ p }: { p: string }) {
  return <span class={`pill ${p}`}>{p}</span>;
}

function Inspector() {
  const perf = store.perf.value!;
  const ds = store.dataset.value;
  const idx = store.selectedNode.value;
  const nd = idx != null ? perf.nodes[idx] : null;
  if (!nd) return <p>Select a commit on the stage, or use ↑/↓ to walk active threads.</p>;
  const commit = ds?.commits.find((c) => c.sha === nd.sha);
  const contributor = perf.contributors[nd.contributorIdx];
  const thread = perf.threads[nd.threadIdx];
  const incoming = perf.edges.filter((e) => e.child === nd.idx);
  const parents = commit?.parentShas ?? [];
  const agg = nd.aggregateIdx != null ? perf.aggregates[nd.aggregateIdx] : null;
  const committerDiffers = !!commit && !!commit.committerIdentityId && commit.committerIdentityId !== commit.authorIdentityId;
  return (
    <div>
      <dl class="kv">
        <dt>SHA</dt>
        <dd>
          {commit?.githubUrl ? (
            <a href={commit.githubUrl} target="_blank" rel="noopener noreferrer">
              <code>{nd.sha.slice(0, 10)}</code>
            </a>
          ) : (
            <code>{nd.sha.slice(0, 10)}</code>
          )}
        </dd>
        <dt>Subject</dt>
        <dd>{commit?.messageSubject || '(no message)'}</dd>
        <dt>Author</dt>
        <dd>
          <button type="button" class="pill" onClick={() => focusContributor(store.contributorFocus.value === contributor?.id ? null : contributor?.id ?? null)} aria-pressed={store.contributorFocus.value === contributor?.id}>
            <span class={`swatch ${contributor?.glyph ?? 'orb'}`} style={`background:${contributor?.color};color:${contributor?.color};display:inline-block;margin-right:6px;vertical-align:-1px`} />
            {contributor?.displayName}
            {contributor?.isBot ? ' (bot)' : ''}
          </button>
        </dd>
        {committerDiffers && (
          <>
            <dt>Committer</dt>
            <dd>differs from author</dd>
          </>
        )}
        <dt>Authored</dt>
        <dd>{commit?.authoredAtRaw ? new Date(commit.authoredAtRaw).toUTCString() : 'unknown'}</dd>
        {commit?.committedAtRaw && commit.committedAtRaw !== commit.authoredAtRaw && (
          <>
            <dt>Committed</dt>
            <dd>{new Date(commit.committedAtRaw).toUTCString()}</dd>
          </>
        )}
        <dt>Parents</dt>
        <dd>
          {parents.length === 0 ? 'none (root)' : parents.map((p, i) => <code key={p}>{i ? ', ' : ''}{p.slice(0, 7)}{perf.nodes.some((n) => n.sha === p) || ds?.commits.some((c) => c.sha === p) ? '' : ' (not loaded)'}</code>)}
          {nd.isMerge ? ' · merge' : ''}
          {nd.parentCount > 2 ? ' · octopus' : ''}
        </dd>
        <dt>Thread</dt>
        <dd>
          <button type="button" class="pill" onClick={() => selectThread(store.selectedThread.value === nd.threadIdx ? null : nd.threadIdx)} aria-pressed={store.selectedThread.value === nd.threadIdx}>
            {thread?.label ?? thread?.id} · {thread?.role}
          </button>
        </dd>
        {nd.refLabels.length > 0 && (
          <>
            <dt>Branches</dt>
            <dd>{nd.refLabels.join(', ')}</dd>
          </>
        )}
        {nd.tagLabels.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd>{nd.tagLabels.join(', ')}</dd>
          </>
        )}
        {commit?.stats && (
          <>
            <dt>Changes</dt>
            <dd>
              +{commit.stats.additions} / −{commit.stats.deletions} · {commit.stats.filesChanged} files
            </dd>
          </>
        )}
        <dt>Lands at</dt>
        <dd>
          <button type="button" class="pill" onClick={() => seek(nd.impact)}>
            {fmtClock(nd.impact)} · beat {nd.beat}
          </button>
        </dd>
        <dt>Provenance</dt>
        <dd>
          <Pill p={nd.kind === 'boundary' ? 'unknown' : nd.provenance} />
          {nd.kind === 'boundary' ? ' — a parent was not loaded' : ''}
          {commit?.flags.isTimeCorrected ? ' · time corrected' : ''}
        </dd>
      </dl>
      {incoming.length > 1 && (
        <>
          <h3>Converging paths</h3>
          <ul class="thread-list">
            {incoming.map((e) => (
              <li key={e.idx}>
                <button type="button" onClick={() => e.parent >= 0 && selectNode(e.parent)}>
                  {e.kind === 'unknown' ? 'history not loaded' : `${perf.nodes[e.parent]!.sha.slice(0, 7)} via ${perf.threads[e.threadIdx]?.label ?? perf.threads[e.threadIdx]?.id}`}
                  <span class="count">{e.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {agg && (
        <>
          <h3>Aggregated span begins here</h3>
          <p>
            {agg.memberCount} known commits between {fmtDate(agg.historicalStart)} and {fmtDate(agg.historicalEnd)} are drawn as one ribbon. Every member is a real commit; boundary edges are exact. <Pill p="aggregate" />
          </p>
          <p>Contributors: {agg.contributorIds.map((id) => perf.contributors.find((c) => c.id === id)?.displayName ?? id).join(', ')}</p>
        </>
      )}
    </div>
  );
}

function Toggle({ label, value, onChange, testId }: { label: string; value: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <div class="field">
      <label>{label}</label>
      <button type="button" role="switch" aria-checked={value} aria-label={label} class="switch" onClick={() => onChange(!value)} data-testid={testId} />
    </div>
  );
}

/**
 * Deliberately short. Everything that has one right answer is baked in: label
 * density, contributor glyphs, effect budgets, render quality (chosen from the
 * device), branch discovery, captions and keyboard granularity. What remains is
 * what a viewer genuinely wants to change, plus the accessibility switches,
 * which are never someone else's call to make.
 */
function SettingsPanel() {
  const s = store.settings.value;
  return (
    <div>
      <h3>Performance</h3>
      <div class="field">
        <label for="len">Length</label>
        <select
          id="len"
          value={s.lengthMode}
          onChange={(e) => {
            updateSettings({ lengthMode: (e.target as HTMLSelectElement).value as typeof s.lengthMode });
            scheduleRecompile();
          }}
          data-testid="duration-select"
        >
          <option value="brief">Brief</option>
          <option value="natural">Natural</option>
          <option value="extended">Extended</option>
        </select>
      </div>
      <p>
        The length follows the history: a handful of commits plays in around half a minute, tens of thousands in a couple of minutes. Long linear stretches become counted ribbons rather than a queue of identical dots.
      </p>
      <Toggle label="Sound" value={!s.muted} onChange={(v) => { updateSettings({ muted: !v }); applySettingsToRuntime(); }} />
      <Toggle label="Loop" value={s.loopPerformance} onChange={(v) => updateSettings({ loopPerformance: v })} />
      <Toggle label="No flashes" value={s.noFlash} onChange={(v) => { updateSettings({ noFlash: v }); applySettingsToRuntime(); }} testId="no-flash-toggle" />
      <Toggle label="High contrast" value={s.highContrast} onChange={(v) => { updateSettings({ highContrast: v }); applySettingsToRuntime(); }} />

      {store.perf.value?.source.provider === 'github' && (
        <button type="button" class="btn small" onClick={refetchCurrent} data-testid="refetch">
          Fetch latest commits
        </button>
      )}

      <h3>Large repositories</h3>
      <TokenField />
    </div>
  );
}

/**
 * GitHub allows about 60 anonymous requests an hour per network, which covers a
 * few thousand commits. A free read-only token raises that to about 5,000 and
 * lifts the page budget from 40 to 400, which is what a large open-source
 * project needs.
 */
function TokenField() {
  const [value, setValue] = useState(store.token.value ?? '');
  const active = !!store.token.value;
  return (
    <div>
      <div class="field">
        <label for="token">GitHub token</label>
        <input
          id="token"
          type="text"
          autoComplete="off"
          spellcheck={false}
          value={value}
          placeholder="optional"
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          onChange={() => (store.token.value = value.trim() || null)}
        />
      </div>
      <p>
        {active ? 'Active for this tab: about 5,000 requests an hour.' : 'Without one, GitHub allows this network about 60 requests an hour, which is a few thousand commits. A free fine-grained token with read-only public access raises it to about 5,000.'}
      </p>
      <p>Kept in memory for this tab only, sent solely to api.github.com, never stored, logged or put in a shared link.</p>
    </div>
  );
}

function HelpPanel() {
  const perf = store.perf.value!;
  const completeness = perf.source.provider === 'synthetic' ? 'synthetic' : perf.coverage.completeness;
  const focus = store.contributorFocus.value;
  const people = [...perf.contributors].sort((a, b) => Number(a.isBot) - Number(b.isBot) || b.commitCount - a.commitCount);
  return (
    <div>
      <p>
        GitTimeline reads a public repository straight from GitHub in your browser, rebuilds the real commit graph, and plays it back as a timelapse. Nothing is uploaded anywhere.
      </p>

      <h3>Reading the stage</h3>
      <dl class="kv">
        <dt>Straight ivory line</dt>
        <dd>The default branch, first parent to first parent. It is always the centre line.</dd>
        <dt>Slate curves</dt>
        <dd>Real threads that diverged where the graph diverges and merged where a merge commit says so.</dd>
        <dt>Moving sparks</dt>
        <dd>People. Colour and shape belong to a contributor and travel through the structure without recolouring it.</dd>
        <dt>Rings</dt>
        <dd>Merges, sized by how many commits they absorbed. One spoke per incoming parent.</dd>
        <dt>Dashed grey</dt>
        <dd>History that was not loaded. Nothing is invented there.</dd>
        <dt>Thick ribbon</dt>
        <dd>An exact run of many commits, drawn once with its count.</dd>
      </dl>

      <h3>This repository</h3>
      <p>
        <Pill p={completeness} /> {perf.coverage.summary}
      </p>
      {perf.coverage.warnings.length > 0 && (
        <ul class="warn-list">
          {perf.coverage.warnings.slice(0, 4).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <dl class="kv">
        <dt>Commits</dt>
        <dd>
          {perf.stats.commits.toLocaleString('en-US')}
          {perf.stats.aggregatedCommits ? ` (${perf.stats.aggregatedCommits.toLocaleString('en-US')} inside ribbons)` : ''}
        </dd>
        <dt>Merges</dt>
        <dd>
          {perf.stats.merges}
          {perf.stats.roots > 1 ? ` · ${perf.stats.roots} roots` : ''}
          {perf.stats.boundaries ? ` · ${perf.stats.boundaries} unloaded boundaries` : ''}
        </dd>
        <dt>Threads</dt>
        <dd>
          {perf.stats.threads} · up to {perf.stats.maxConcurrentThreads} moving at once
        </dd>
        <dt>Main line</dt>
        <dd>{perf.source.defaultBranch ?? 'derived'}</dd>
      </dl>

      <h3>Contributors</h3>
      <p>Select one to follow their work through the structure.</p>
      <ul class="contrib-list">
        {people.slice(0, 40).map((c) => (
          <li key={c.id}>
            <button type="button" aria-pressed={focus === c.id} onClick={() => focusContributor(focus === c.id ? null : c.id)}>
              <span class={`swatch ${c.glyph}`} style={`background:${c.color};color:${c.color}`} />
              {c.displayName}
              {c.isBot ? ' (bot)' : ''}
              <span class="count">{c.commitCount}</span>
            </button>
          </li>
        ))}
      </ul>

      <h3>Keyboard</h3>
      <div class="keys">
        <kbd>Space</kbd>
        <span>play / pause</span>
        <kbd>← →</kbd>
        <span>step a beat</span>
        <kbd>Shift ← →</kbd>
        <span>previous / next landmark</span>
        <kbd>↑ ↓</kbd>
        <span>walk the active threads</span>
        <kbd>M</kbd>
        <span>sound</span>
        <kbd>C</kbd>
        <span>free look, follow at your zoom, auto</span>
        <kbd>Esc</kbd>
        <span>close</span>
      </div>

      <h3>Limits</h3>
      <p>
        GitHub allows a network about 60 anonymous requests an hour, which covers a few thousand commits. A free read-only token in Settings raises that to about 5,000 and lets GitTimeline read far deeper. When the limit is reached the performance is still played, and labelled as partial.
      </p>
    </div>
  );
}

export type { CompiledPerformance, NodeGeom };
