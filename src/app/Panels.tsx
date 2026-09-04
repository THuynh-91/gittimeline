import { useEffect, useRef, useState } from 'preact/hooks';
import { store, updateSettings, type PanelId } from './store';
import {
  seek,
  selectNode,
  selectThread,
  focusContributor,
  scheduleRecompile,
  applySettingsToRuntime,
  shareLink,
  copyShareLink,
  exportPng,
  exportArtifact,
  exportTranscript,
  exportPlanJson,
  setLoop,
  cache,
  player,
  loadFixture,
  retry,
} from './controller';
import { fmtClock, fmtDate } from '@/choreography/events';
import { FIXTURES } from '@/fixtures/corpus';
import { formatReset } from '@/github/ratelimit';
import { Icons } from './icons';
import type { ChoreographyEvent, CompiledPerformance, NodeGeom } from '@/model/types';

export function Panels() {
  const id = store.panel.value;
  if (id === 'none') return null;
  const titles: Record<PanelId, string> = { none: '', inspector: 'Commit', data: 'What am I seeing?', settings: 'Settings', events: 'Events', share: 'Share & export', help: 'How it works' };
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
        {id === 'data' && <DataPanel />}
        {id === 'settings' && <SettingsPanel />}
        {id === 'events' && <EventsPanel />}
        {id === 'share' && <SharePanel />}
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

function DataPanel() {
  const perf = store.perf.value!;
  const rate = store.rate.value;
  const outcome = store.outcome.value;
  const focus = store.contributorFocus.value;
  const selectedThread = store.selectedThread.value;
  const storage = store.storage.value;
  const [busy, setBusy] = useState(false);
  const humans = perf.contributors.filter((c) => !c.isBot);
  const bots = perf.contributors.filter((c) => c.isBot);
  return (
    <div>
      <h3>Coverage</h3>
      <p>
        <Pill p={perf.coverage.completeness} /> {perf.coverage.summary}
      </p>
      {outcome === 'rate-limited' && <p>GitHub’s request limit was reached during loading{rate?.resetAt ? `; it resets ${formatReset(rate.resetAt)}` : ''}. <button type="button" class="btn small" onClick={retry}>Retry now</button></p>}
      {perf.coverage.warnings.length > 0 && (
        <ul class="warn-list">
          {perf.coverage.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <h3>Legend</h3>
      <dl class="kv">
        <dt>Bright ivory path</dt>
        <dd>First-parent history of {perf.source.defaultBranch ?? 'the primary spine'} — the main line</dd>
        <dt>Slate paths</dt>
        <dd>Other threads: real ancestry that diverged and merged (or is still open)</dd>
        <dt>Moving sparks</dt>
        <dd>Contributors carrying commits; colour and shape are a person, never a branch</dd>
        <dt>Rings</dt>
        <dd>Merge commits; double ring = more than two parents</dd>
        <dt>Dashed grey</dt>
        <dd>History that was not loaded — nothing is invented there</dd>
        <dt>Thick ribbon</dt>
        <dd>An exact aggregate of many known commits (count shown)</dd>
      </dl>
      <h3>Structure</h3>
      <dl class="kv">
        <dt>Commits</dt>
        <dd>{perf.stats.commits.toLocaleString('en-US')}{perf.stats.aggregatedCommits ? ` (${perf.stats.aggregatedCommits} inside aggregates)` : ''}</dd>
        <dt>Merges</dt>
        <dd>{perf.stats.merges}</dd>
        <dt>Roots</dt>
        <dd>{perf.stats.roots}</dd>
        <dt>Boundaries</dt>
        <dd>{perf.stats.boundaries}</dd>
        <dt>Threads</dt>
        <dd>{perf.stats.threads} · up to {perf.stats.maxConcurrentThreads} moving at once</dd>
        <dt>Spine</dt>
        <dd>{perf.source.defaultBranch ?? 'derived'} · first-parent chain</dd>
        <dt>Pinned tip</dt>
        <dd><code>{perf.source.selectedTipSha?.slice(0, 10) ?? 'n/a'}</code></dd>
        <dt>Engine</dt>
        <dd>
          model {perf.engine.modelSchemaVersion} · analyzer {perf.engine.analyzerVersion} · layout {perf.engine.layoutVersion} · choreography {perf.engine.choreographyVersion}
        </dd>
        <dt>Plan hash</dt>
        <dd><code>{perf.planHash.slice(0, 16)}</code></dd>
        <dt>Seed</dt>
        <dd><code>{perf.seed}</code></dd>
      </dl>
      <h3>Threads</h3>
      <ul class="thread-list">
        {perf.threads.slice(0, 40).map((t) => (
          <li key={t.id}>
            <button type="button" aria-pressed={selectedThread === t.idx} onClick={() => { selectThread(selectedThread === t.idx ? null : t.idx); seek(t.start); }}>
              <span class="swatch" style={`background:${t.role === 'primary' ? '#f4e9d2' : '#6f7d99'};color:transparent`} />
              {t.label ?? t.id}
              <span class="count">
                {t.nodeIdxs.length} · {t.ending}
              </span>
            </button>
          </li>
        ))}
        {perf.threads.length > 40 && <li>… {perf.threads.length - 40} more</li>}
      </ul>
      <h3>Contributors</h3>
      <ul class="contrib-list">
        {[...humans, ...bots].slice(0, 60).map((c) => (
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
      <h3>Eras</h3>
      <ul class="era-list">
        {perf.eras.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => seek(e.performanceStart)}>
              <div>{e.label}</div>
              <div class="range">
                {fmtDate(e.historicalStart)} → {fmtDate(e.historicalEnd)} · {fmtClock(e.performanceStart)}
              </div>
              <div class="range">{e.description}</div>
            </button>
          </li>
        ))}
      </ul>
      <h3>Local data</h3>
      <p>
        Fetched pages and datasets live only in this browser’s IndexedDB.{storage ? ` About ${(storage.usage / 1e6).toFixed(1)} MB used.` : ''}
      </p>
      <div class="btn-row">
        <button type="button" class="btn small" disabled={busy} onClick={async () => { setBusy(true); await cache.clearRepository(`${perf.source.owner}/${perf.source.name}`); setBusy(false); }}>
          Clear this repository
        </button>
        <button type="button" class="btn small" disabled={busy} onClick={async () => { setBusy(true); await cache.clearAll(); store.recent.value = []; setBusy(false); }}>
          Clear all local data
        </button>
      </div>
      <h3>Synthetic fixtures</h3>
      <p>Pathological histories used as regression tests. Each one is deterministic.</p>
      <select class="speed" aria-label="Load a synthetic fixture" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) void loadFixture(v); }}>
        <option value="">Load a fixture…</option>
        {FIXTURES.map((f) => (
          <option key={f.id} value={f.id}>
            {f.id} — {f.title}
          </option>
        ))}
      </select>
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

function SettingsPanel() {
  const s = store.settings.value;
  const structural = (patch: Partial<typeof s>) => {
    updateSettings(patch);
    scheduleRecompile();
  };
  const cosmetic = (patch: Partial<typeof s>) => {
    updateSettings(patch);
    applySettingsToRuntime();
  };
  return (
    <div>
      <h3>Playback</h3>
      <div class="field">
        <label for="dur">Target duration</label>
        <select id="dur" value={String(s.targetDuration)} onChange={(e) => structural({ targetDuration: Number((e.target as HTMLSelectElement).value) })} data-testid="duration-select">
          <option value="20">20 s · sprint</option>
          <option value="30">30 s</option>
          <option value="45">45 s</option>
          <option value="60">60 s</option>
          <option value="90">90 s · unhurried</option>
        </select>
      </div>
      <Toggle label="Loop the performance" value={s.loopPerformance} onChange={(v) => updateSettings({ loopPerformance: v })} />
      <Toggle label="Spoiler-free timeline" value={s.spoilerFree} onChange={(v) => updateSettings({ spoilerFree: v })} />
      <Toggle label="Captions" value={s.captions} onChange={(v) => updateSettings({ captions: v })} />
      <div class="field">
        <label for="kstep">Arrow keys step by</label>
        <select id="kstep" value={s.keyboardStep} onChange={(e) => updateSettings({ keyboardStep: (e.target as HTMLSelectElement).value as typeof s.keyboardStep })}>
          <option value="beat">beat</option>
          <option value="commit">commit</option>
          <option value="second">second</option>
        </select>
      </div>
      <h3>Motion &amp; accessibility</h3>
      <Toggle label="Reduced motion (R)" value={s.reducedMotion} onChange={(v) => structural({ reducedMotion: v })} testId="reduced-motion-toggle" />
      <Toggle label="No flashes" value={s.noFlash} onChange={(v) => cosmetic({ noFlash: v })} testId="no-flash-toggle" />
      <Toggle label="High contrast" value={s.highContrast} onChange={(v) => cosmetic({ highContrast: v })} />
      <Toggle label="Contributor glyph shapes" value={s.showGlyphs} onChange={(v) => cosmetic({ showGlyphs: v })} />
      <Toggle label="Auto camera (C)" value={s.autoCamera} onChange={(v) => { updateSettings({ autoCamera: v }); applySettingsToRuntime(); }} />
      <div class="field">
        <label for="labels">Labels</label>
        <select id="labels" value={s.labels} onChange={(e) => cosmetic({ labels: (e.target as HTMLSelectElement).value as typeof s.labels })}>
          <option value="minimal">minimal</option>
          <option value="landmarks">landmarks</option>
          <option value="all">all visible</option>
        </select>
      </div>
      <div class="field">
        <label for="quality">Render quality</label>
        <select id="quality" value={s.quality} onChange={(e) => cosmetic({ quality: (e.target as HTMLSelectElement).value as typeof s.quality })}>
          <option value="full">full (bloom, trails)</option>
          <option value="reduced">reduced</option>
          <option value="minimal">minimal</option>
        </select>
      </div>
      <h3>Sound</h3>
      <Toggle label="Mute (M)" value={s.muted} onChange={(v) => cosmetic({ muted: v })} />
      <div class="field">
        <label for="fx">Effects</label>
        <input id="fx" type="range" min="0" max="1" step="0.05" value={s.effectsLevel} onInput={(e) => cosmetic({ effectsLevel: Number((e.target as HTMLInputElement).value) })} />
      </div>
      <div class="field">
        <label for="amb">Ambience</label>
        <input id="amb" type="range" min="0" max="1" step="0.05" value={s.ambientLevel} onInput={(e) => cosmetic({ ambientLevel: Number((e.target as HTMLInputElement).value) })} />
      </div>
      <div class="field">
        <label for="dyn">Dynamic range</label>
        <select id="dyn" value={s.dynamics} onChange={(e) => cosmetic({ dynamics: (e.target as HTMLSelectElement).value as typeof s.dynamics })}>
          <option value="quiet">quiet</option>
          <option value="standard">standard</option>
          <option value="dramatic">dramatic</option>
        </select>
      </div>
      <h3>Data</h3>
      <Toggle label="Include surviving branches" value={s.includeBranches} onChange={(v) => updateSettings({ includeBranches: v })} />
      <div class="field">
        <label for="seed">Seed</label>
        <input id="seed" type="text" value={s.seed} maxLength={64} onChange={(e) => structural({ seed: (e.target as HTMLInputElement).value || 'gitdance' })} />
      </div>
      <TokenField />
    </div>
  );
}

function TokenField() {
  const [value, setValue] = useState(store.token.value ?? '');
  return (
    <div>
      <div class="field">
        <label for="token">GitHub token (optional)</label>
        <input id="token" type="text" autoComplete="off" spellcheck={false} value={value} placeholder="fine-grained, public read" onInput={(e) => setValue((e.target as HTMLInputElement).value)} onChange={() => (store.token.value = value.trim() || null)} />
      </div>
      <p>Kept in memory only for this tab and sent solely to api.github.com to raise the request limit. Never stored, logged, exported or put in links.</p>
    </div>
  );
}

const TYPE_LABEL: Partial<Record<ChoreographyEvent['type'], string>> = {
  REPO_BIRTH: 'birth',
  MULTI_ROOT_REVEAL: 'new root',
  COMMIT_STEP: 'commit',
  COMMIT_CLUSTER: 'cluster',
  QUIET_GAP: 'quiet',
  DIVERGENCE: 'divergence',
  THREAD_ACTIVATE: 'thread',
  PARALLEL_PHRASE: 'parallel',
  CONTRIBUTOR_ENTER: 'enters',
  CONTRIBUTOR_HANDOFF: 'handoff',
  MERGE_APPROACH: 'approach',
  MERGE_IMPACT: 'merge',
  MAJOR_MERGE: 'major merge',
  OCTOPUS_MERGE: 'octopus',
  MERGE_STORM: 'merge storm',
  THREAD_DORMANT: 'dormant',
  UNMERGED_TIP: 'live tip',
  TAG_LANDMARK: 'tag',
  ERA_TRANSITION: 'era',
  AGGREGATE_SPAN: 'aggregate',
  UNKNOWN_SPAN: 'unknown',
  REPO_PRESENT: 'present',
};

function EventsPanel() {
  const perf = store.perf.value!;
  const t = store.time.value;
  const [all, setAll] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const events = all ? perf.events : perf.events.filter((e) => e.type !== 'COMMIT_STEP' && e.type !== 'MERGE_APPROACH' && e.type !== 'CONTRIBUTOR_ENTER' && e.type !== 'COMMIT_CLUSTER');
  const currentIdx = (() => {
    let i = -1;
    for (let k = 0; k < events.length; k++) if (events[k]!.performanceImpact <= t) i = k;
    return i;
  })();
  useEffect(() => {
    const el = listRef.current?.children[currentIdx] as HTMLElement | undefined;
    if (el && store.playing.value) el.scrollIntoView({ block: 'nearest' });
  }, [currentIdx]);
  return (
    <div>
      <div class="field">
        <label>Show every commit</label>
        <button type="button" role="switch" aria-checked={all} aria-label="Show every commit" class="switch" onClick={() => setAll(!all)} />
      </div>
      <p>{events.length} events · current camera: {store.cameraState.value}</p>
      <ul class="event-list" ref={listRef} aria-label="Performance events" data-testid="event-list">
        {events.slice(0, 1500).map((ev, i) => (
          <li key={ev.id} class={i === currentIdx ? 'current' : ''} aria-current={i === currentIdx ? 'true' : undefined}>
            <button type="button" onClick={() => seek(ev.performanceImpact)}>
              <span class="t">{fmtClock(ev.performanceImpact)}</span>
              <span>
                <span class="type">
                  {TYPE_LABEL[ev.type] ?? ev.type}
                  {ev.historicalTime != null ? ` · ${fmtDate(ev.historicalTime)}` : ''}
                  {ev.provenance !== 'exact' ? ` · ${ev.provenance}` : ''}
                </span>
                {ev.caption}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SharePanel() {
  const perf = store.perf.value!;
  const loop = store.loopRange.value;
  const [link, setLink] = useState(shareLink());
  useEffect(() => setLink(shareLink()), [store.time.value]);
  return (
    <div>
      <h3>Link</h3>
      <p>Pins {perf.source.provider === 'github' ? 'the repository tip' : 'the demo'}, the current position, duration, seed and focus. Anyone opening it fetches the same public data and gets the same choreography.</p>
      <div class="share-link" data-testid="share-link">{link}</div>
      <div class="btn-row">
        <button type="button" class="btn primary small" onClick={() => void copyShareLink()}>
          Copy link
        </button>
        <button type="button" class="btn small" onClick={() => setLoop(loop ? null : { start: Math.max(0, player.t - 5), end: Math.min(perf.duration, player.t + 5) })}>
          {loop ? 'Clear loop' : 'Loop ±5 s here'}
        </button>
      </div>
      <p>Shift-drag on the timeline selects a loop range.</p>
      <h3>Export</h3>
      <div class="btn-row">
        <button type="button" class="btn small" onClick={() => void exportPng()}>PNG still</button>
        <button type="button" class="btn small" onClick={() => void exportArtifact()} data-testid="export-artifact">.gitdance artifact</button>
        <button type="button" class="btn small" onClick={exportTranscript}>Transcript (.md)</button>
        <button type="button" class="btn small" onClick={exportPlanJson}>Plan (.json)</button>
      </div>
      <p>WebM capture: use the record button in the top bar (real-time, silent). The artifact contains data only — no code, no tokens, no e-mail addresses.</p>
      <h3>Embed</h3>
      <div class="share-link">{`<iframe src="${link.replace('autoplay=1', 'autoplay=1&gallery=1')}" width="960" height="540" title="GitDance: ${perf.source.owner}/${perf.source.name}" loading="lazy"></iframe>`}</div>
      <p>Gallery mode hides the chrome and loops. It plays muted until the viewer interacts.</p>
    </div>
  );
}

function HelpPanel() {
  return (
    <div>
      <p>
        GitDance reads a public repository straight from GitHub in your browser, rebuilds the real commit graph, and compiles it into a performance. Nothing is uploaded anywhere.
      </p>
      <h3>Reading the stage</h3>
      <p>The bright ivory line is the default branch’s first-parent history. Every other path is real ancestry that diverged where the graph diverges and merges where a merge commit says so. Sparks are people: colour and shape belong to a contributor and travel through the structure without recolouring it.</p>
      <p>Two clocks run at once. The performance clock (bottom left) compresses quiet years and dwells on busy ones; the historical date next to it is real. Dashed grey means history that was not loaded — it is never filled in.</p>
      <h3>Keyboard</h3>
      <div class="keys">
        <kbd>Space</kbd>
        <span>play / pause</span>
        <kbd>← →</kbd>
        <span>step by beat (or commit / second in Settings)</span>
        <kbd>Shift ← →</kbd>
        <span>previous / next landmark</span>
        <kbd>↑ ↓</kbd>
        <span>walk the active threads</span>
        <kbd>Home / End</kbd>
        <span>start / end</span>
        <kbd>M</kbd>
        <span>mute</span>
        <kbd>C</kbd>
        <span>auto / manual camera (drag to pan, wheel to zoom, double-click to return)</span>
        <kbd>R</kbd>
        <span>reduced motion</span>
        <kbd>E</kbd>
        <span>events list</span>
        <kbd>I</kbd>
        <span>what am I seeing?</span>
        <kbd>Esc</kbd>
        <span>close / clear selection</span>
      </div>
      <h3>Limits</h3>
      <p>GitHub allows about 60 anonymous requests per hour per network. GitDance budgets them, caches pages locally, and stops honestly with a partial performance when the limit is near. An optional fine-grained token (Settings) raises the limit and stays in memory only.</p>
    </div>
  );
}

export type { CompiledPerformance, NodeGeom };
