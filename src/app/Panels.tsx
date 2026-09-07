import { useState } from 'preact/hooks';
import { store, updateSettings, toast, type PanelId } from './store';
import { MusicCredit } from './MusicCredit';
import {
  player,
  seek,
  exportTranscript,
  selectNode,
  selectThread,
  focusContributor,
  scheduleRecompile,
  applySettingsToRuntime,
  refetchCurrent,
  cache,
} from './controller';
import { fmtClock, fmtDate, TEXTURE_EVENTS } from '@/choreography/events';
import { describeAggregate } from '@/analysis/aggregate';
import { Icons } from './icons';
import type { CompiledPerformance, NodeGeom, ThreadGeom } from '@/model/types';

export function Panels() {
  const id = store.panel.value;
  if (id === 'none') return null;
  const titles: Record<PanelId, string> = { none: '', inspector: 'Commit', settings: 'Settings', help: 'How it works', events: 'Events' };
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
        {id === 'events' && <EventsPanel />}
      </div>
    </aside>
  );
}

/**
 * A provenance label, in words rather than in the vocabulary of the code.
 *
 * These read `exact`, `partial` and `synthetic` internally, which are precise
 * and mean nothing to a reader: "synthetic" in particular is jargon for *made
 * up*, shown against a history nobody wrote, and the one thing it needed to
 * say — that this is a demonstration and not a repository — is the one thing
 * it did not.
 */
const PILL_WORDS: Record<string, string> = {
  exact: 'the whole history',
  partial: 'part of the history',
  aggregate: 'summarised',
  estimated: 'estimated',
  unknown: 'unknown',
  synthetic: 'a made-up example',
};

function Pill({ p }: { p: string }) {
  return <span class={`pill ${p}`}>{PILL_WORDS[p] ?? p}</span>;
}

/**
 * How long a thread was open, in calendar terms, or `null` if that cannot be
 * said precisely.
 *
 * The distance between a thread's start and end *is* its lifetime, because x
 * on this stage is the clock. That is the one thing a topological tool cannot
 * work out: gitk and `git log --graph` know the order of the commits and not
 * the gap between them, so "this branch was open five months" is not a
 * sentence they can produce. It has been drawn here since the layout was
 * written and never once quantified.
 *
 * Refused rather than approximated when either end falls outside the loaded
 * part of the history. A streamed entry holds the `time` pages around the
 * playhead; `historicalAt` is exact inside them — measured at 0.00 years'
 * error across 201 positions on four entries — and coarse outside, up to 0.86
 * of a year out where no page covers the moment. A lifetime in days is a
 * precise-looking claim and is only worth making where it is precise.
 */
function threadLifetime(perf: CompiledPerformance, thread: ThreadGeom | undefined): string | null {
  if (!thread) return null;
  const w = perf.window;
  if (w && (thread.start < w.start || thread.end > w.end)) return null;
  const from = player.historicalAt(thread.start);
  const to = player.historicalAt(thread.end);
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  const days = (to - from) / 86_400_000;
  // Under a day is "the same day", which is what a routine pull request looks
  // like and is worth saying plainly rather than as "0 days".
  if (days < 1) return 'and merged the same day';
  if (days < 45) return `${Math.round(days)} days`;
  const months = days / 30.44;
  if (months < 22) return `${Math.round(months)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

function Inspector() {
  const perf = store.perf.value!;
  const ds = store.dataset.value;
  const idx = store.selectedNode.value;
  const nd = idx != null ? perf.nodes[idx] : null;
  // Pointed at something that does what it says. This used to offer ↑/↓,
  // which calls `selectThread` — so following the instruction selected a
  // thread and left this panel still asking for a commit.
  if (!nd)
    return (
      <p>
        Select a commit on the stage, or open{' '}
        <button type="button" class="linkish" onClick={() => (store.panel.value = 'events')}>
          the events so far
        </button>{' '}
        — every line there is a link to its moment. <kbd>↑</kbd> <kbd>↓</kbd> walk the active threads instead.
      </p>
    );
  const commit = ds?.commits.find((c) => c.sha === nd.sha);
  const contributor = perf.contributors[nd.contributorIdx];
  const thread = perf.threads[nd.threadIdx];
  const incoming = perf.edges.filter((e) => e.child === nd.idx);
  /**
   * Parents, from whichever of the two sources this performance has.
   *
   * `parentShas` comes from the ingested dataset, and a streamed catalog entry
   * has no dataset — only a window of the compiled plan. Reading that absence
   * as "no parents" told the viewer that every commit of every packaged
   * history was a root, merges included, which rendered as the flat
   * contradiction `none (root) · merge`. Twelve histories, every commit.
   *
   * The topology was never missing: `nd.parentCount` is the real count, and
   * the incoming edges carry the parents that are resident. An edge of kind
   * `unknown` is one whose parent is outside the loaded window — a boundary,
   * which is exactly the thing this project promises never to draw as a root.
   */
  const parents = commit?.parentShas ?? incoming.filter((e) => e.parent >= 0).map((e) => perf.nodes[e.parent]!.sha);
  const isRoot = commit ? parents.length === 0 : nd.parentCount === 0;
  /** Parents that exist but are not in the part of the history now in hand. */
  const unloadedParents = Math.max(0, nd.parentCount - parents.length);
  const agg = nd.aggregateIdx != null ? perf.aggregates[nd.aggregateIdx] : null;
  /**
   * How long this thread was open, in calendar terms — see the note below.
   *
   * `null` unless both ends of it are inside the loaded part of the history,
   * because that is where `historicalAt` is exact.
   */
  const lifetime = threadLifetime(perf, thread);
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
        {/* The node's own subject first: on a history whose dataset is too
            large to fetch back, `commit` is null and this was the second empty
            field in a panel opened to read one commit. */}
        <dd>{commit?.messageSubject || nd.subject || '(no message)'}</dd>
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
          {isRoot
            ? 'none (root)'
            : parents.map((p, i) => (
                <code key={p}>
                  {i ? ', ' : ''}
                  {p.slice(0, 7)}
                  {perf.nodes.some((n) => n.sha === p) || ds?.commits.some((c) => c.sha === p) ? '' : ' (not loaded)'}
                </code>
              ))}
          {/* Named, not omitted. A commit with two parents and one of them
              off the edge of the loaded window has to say so, or the count
              beside it reads as a contradiction. */}
          {!isRoot && unloadedParents > 0 && (
            <span class="dim">
              {parents.length > 0 ? ', ' : ''}
              {unloadedParents} not in the loaded part of this history
            </span>
          )}
          {nd.isMerge ? ' · merge' : ''}
          {nd.parentCount > 2 ? ' · octopus' : ''}
        </dd>
        <dt>Thread</dt>
        <dd data-testid="thread-row">
          <button type="button" class="pill" onClick={() => selectThread(store.selectedThread.value === nd.threadIdx ? null : nd.threadIdx)} aria-pressed={store.selectedThread.value === nd.threadIdx}>
            {thread?.label ?? thread?.id} · {thread?.role}
          </button>
          {/* How long it was open, in days.

              Already drawn and never quantified: the distance between a
              thread's `xStart` and `xEnd` *is* its lifetime, because x is the
              clock. A topological tool cannot answer this either — it knows
              the order of the commits and not the gap between them, so "this
              branch was open five months" is not a sentence it can produce.

              Only when both ends of the thread fall inside the part of the
              history that is loaded. A streamed entry holds pages around the
              playhead, and `historicalAt` is exact within them and coarse
              outside — measured at up to 0.86 of a year out where no page
              covers the moment. A lifetime in days is a precise-looking claim,
              so it is made only where it is precise. */}
          {lifetime != null && <span class="thread-life"> · open {lifetime}</span>}
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
            {describeAggregate(agg)} between {fmtDate(agg.historicalStart)} and {fmtDate(agg.historicalEnd)} are drawn as one ribbon. Every member is a real commit; boundary edges are exact. <Pill p="aggregate" />
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
      {/* The notes drawn onto the history: branch names, "40 commits" over a
          collapsed run, tag labels, and the marks those commits leave on the
          scrubber. One setting, because they are one idea — annotation of the
          picture, as against the picture. It lives here rather than on the
          stage because it is a preference about how the history is drawn, not
          a control anyone reaches for while watching. */}
      <Toggle
        label="Notes on the history"
        value={s.labels !== 'minimal'}
        onChange={(v) => { updateSettings({ labels: v ? 'landmarks' : 'minimal' }); applySettingsToRuntime(); }}
        testId="labels-toggle"
      />
      {/* Sits under "notes on the history" because it is the same kind of
          thing — something written onto the picture rather than part of it —
          but it is its own switch: the branch names and the merge captions
          come and go all over the stage, while this one object is always in
          the same place and some people will want exactly it gone. */}
      <Toggle
        label="Name the main line"
        value={s.showSpineLabel}
        onChange={(v) => { updateSettings({ showSpineLabel: v }); applySettingsToRuntime(); }}
        testId="spine-label-toggle"
      />
      {/* Off by default, and next to the main line's name because it is the
          same kind of object: one mark always in the same place, which nobody
          who has understood it needs repeated for four and a half hours. It
          earned its keep by catching strokes drawn ahead of the clock, and
          with those bounded the rightmost ink is the present already — so this
          is a diagnostic now, not a feature. See `Settings.showPresent`. */}
      <Toggle
        label="Mark the present"
        value={s.showPresent}
        onChange={(v) => { updateSettings({ showPresent: v }); applySettingsToRuntime(); }}
        testId="present-toggle"
      />
      <Toggle label="No flashes" value={s.noFlash} onChange={(v) => { updateSettings({ noFlash: v }); applySettingsToRuntime(); }} testId="no-flash-toggle" />
      {/* Next to "No flashes" because they are the same kind of request, and
          separate from reduced motion because that also stops the travelling
          and slows every transition — this holds the camera still and lets
          the performance carry on. */}
      <Toggle label="Hold the camera still" value={s.noShake} onChange={(v) => { updateSettings({ noShake: v }); applySettingsToRuntime(); }} testId="no-shake-toggle" />
      <Toggle label="High contrast" value={s.highContrast} onChange={(v) => { updateSettings({ highContrast: v }); applySettingsToRuntime(); }} />

      {store.perf.value?.source.provider === 'github' && (
        <button type="button" class="btn small" onClick={refetchCurrent} data-testid="refetch">
          Fetch latest commits
        </button>
      )}

      <h3>Stored on this device</h3>
      <StoredOnDevice />

      <h3>Large repositories</h3>
      <TokenField />
    </div>
  );
}

/**
 * What is kept here, how much of it, and a way to be rid of it.
 *
 * `cache.estimate()` was already being called at boot into `store.storage` and
 * displayed nowhere; `ApiCache.clearAll` and `clearRepository` were written and
 * called from nowhere. So the app cached GitHub responses on the device, the
 * sign-in page said nothing was written to disk, and there was no way to remove
 * it. Two of those three are now fixed elsewhere; this is the third.
 */
function StoredOnDevice() {
  const est = store.storage.value;
  const [busy, setBusy] = useState(false);
  const mb = est && est.usage != null ? est.usage / 1e6 : null;
  return (
    <div class="stored">
      <p class="dim">
        {mb == null
          ? 'Responses already fetched from GitHub are cached here so the same history is not downloaded twice, together with the list of what you have watched. Public data only.'
          : `${mb < 1 ? `${Math.round((est!.usage ?? 0) / 1000)} KB` : `${mb.toFixed(1)} MB`} of cached GitHub responses and watch history. Public data only — a token is never stored.`}
      </p>
      <button
        type="button"
        class="btn small"
        disabled={busy}
        data-testid="clear-storage"
        onClick={() => {
          setBusy(true);
          void (async () => {
            await cache.clearAll();
            store.recent.value = [];
            store.storage.value = await cache.estimate();
            setBusy(false);
            toast('Cleared what was stored on this device');
          })();
        }}
      >
        {busy ? 'Clearing…' : 'Clear it'}
      </button>
    </div>
  );
}

/**
 * GitHub allows about 60 anonymous requests an hour per network, which covers a
 * few thousand commits. A free read-only token raises that to about 5,000 and
 * lifts the page budget from 40 to 400, which is what a large open-source
 * project needs.
 *
 * ## Why this field never shows the credential it set
 *
 * It used to be `type="text"` seeded from `store.token.value`. So after a
 * GitHub sign-in — which sets the same signal — opening Settings painted the
 * live access token in cleartext, into the accessibility tree, and into any
 * screenshot, screen share or recording of this panel. Two lines below it the
 * page says the token is "never stored, logged or put in a shared link", all
 * of which was true and none of which is about being displayed.
 *
 * So: `type="password"`, and when a token is already active the field starts
 * empty and says so in its placeholder rather than handing the value back.
 * Nothing needs to read it out — the only thing anyone does here is replace it
 * or clear it, and Disconnect is the honest way to clear one.
 *
 * The value is still held in component state while being typed, which is
 * unavoidable for a controlled input, and is gone on unmount.
 */
function TokenField() {
  const [value, setValue] = useState('');
  const active = !!store.token.value;
  return (
    <div>
      <div class="field">
        <label for="token">GitHub token</label>
        <input
          id="token"
          type="password"
          autoComplete="off"
          spellcheck={false}
          value={value}
          placeholder={active ? 'connected — type to replace' : 'optional'}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          onChange={() => {
            const next = value.trim();
            // An empty field means "leave it alone" once one is active, not
            // "disconnect". Blurring an untouched field would otherwise sign
            // somebody out for looking at Settings.
            if (next) store.token.value = next;
            else if (!active) store.token.value = null;
          }}
        />
      </div>
      <p>
        {active ? 'Active for this tab: about 5,000 requests an hour.' : 'Without one, GitHub allows this network about 60 requests an hour, which is a few thousand commits. A free fine-grained token with read-only public access raises it to about 5,000.'}
      </p>
      <p>Kept in memory for this tab only, sent solely to api.github.com, never stored, logged or put in a shared link.</p>
    </div>
  );
}

/**
 * What the app is and how to read the stage — and, when something is playing,
 * what *this* history is.
 *
 * The second half used to be the whole premise: the panel read
 * `store.perf.value!` on its first line, so it could only exist during a
 * performance, and the "How it works" item in the site bar had to call
 * `play()` before opening it. Asking how something works is not asking to be
 * dropped into the middle of it — from the catalog that answer threw away the
 * page you were reading and started a demo you did not choose.
 *
 * So the explanation stands on its own and the repository-specific half
 * appears only when there is a repository to describe.
 */
/**
 * The performance, in words.
 *
 * The canvas's alternative text has told every screen-reader user to "use the
 * Events panel (E) for a textual account" since the stage was written, and
 * until now there was no panel and no key — so the whole of what a screen
 * reader was told about a Canvas2D animation ended in a pointer to nothing.
 * `accessibility.md` promises six non-canvas equivalences and this is the one
 * the stage itself names.
 *
 * Two rules it inherits from the stage rather than invents:
 *
 * Nothing is listed before it happens. The stage's hardest invariant is that
 * no commit is drawn before its moment, and a panel that listed the whole plan
 * would hand a screen-reader user the ending while a sighted one was four
 * minutes from it. So the list ends at the playhead, newest first, and grows
 * as the performance does.
 *
 * And every line is a seek. Reading that something happened is half of it;
 * being able to go there is the other half, and it is the only way a keyboard
 * user reaches a moment that is not a landmark.
 */
function EventsPanel() {
  const perf = store.perf.value;
  const t = store.time.value;
  /**
   * Every commit, or only the news.
   *
   * `accessibility.md` has described this switch since before the panel
   * existed — "a 'show every commit' switch expands it to all steps" — and the
   * first version of the panel listed everything unconditionally instead,
   * which on a thousand-node plan is a thousand entries of "somebody committed
   * something" with the divergences and the merges lost among them.
   *
   * Off by default, and the types it hides are `TEXTURE_EVENTS`, which is the
   * same set the transcript has always skipped. Sharing it is the point: two
   * different answers to "what is significant" is how a panel and a transcript
   * come to disagree about one history.
   */
  const [everyCommit, setEveryCommit] = useState(false);
  if (!perf) return <p>Nothing is playing.</p>;

  // Newest first, because the interesting end of a growing list is the end
  // that is growing. Capped because Linux has hundreds of thousands and a
  // screen reader would be walking the list rather than the history; the count
  // above says what is being left out, which is the honest form of a cap.
  const happened = perf.events.filter((e) => e.performanceImpact <= t && (everyCommit || !TEXTURE_EVENTS.has(e.type)));
  const shown = happened.slice(-200).reverse();
  /** The most recent thing to have happened, which is where the show is. */
  const currentId = shown.length ? shown[0]!.id : null;

  /**
   * A streamed history is not all here, and this must not say that it is.
   *
   * `assembleWindow` builds `events` from the pages in hand — the plan a
   * packaged entry plays is a window around the playhead and nothing else — so
   * counting them and calling the number "so far" would be a false count of
   * exactly the kind this project treats as a defect. What the panel holds
   * then is the loaded part of the history, and the transcript below is where
   * the whole of it lives.
   */
  const windowed = !!perf.window;

  return (
    <div class="events-panel" data-testid="events-panel">
      <p class="dim">
        {happened.length === 0
          ? 'Nothing has happened yet. Events appear here as the performance reaches them.'
          : windowed
            ? `${happened.length.toLocaleString('en-US')} in the part of this history now loaded, newest first. Each one is a link to its moment; the transcript below covers the whole of it.`
            : `${happened.length.toLocaleString('en-US')} so far, newest first${happened.length > shown.length ? `; the most recent ${shown.length}` : ''}. Each one is a link to its moment.`}
      </p>
      <label class="events-every">
        <input type="checkbox" checked={everyCommit} onChange={(e) => setEveryCommit((e.target as HTMLInputElement).checked)} data-testid="events-every" />
        Show every commit
      </label>
      <button type="button" class="btn" onClick={() => exportTranscript()} data-testid="events-transcript">
        Download the whole transcript
      </button>
      {shown.length > 0 && (
        <ol class="events-list" data-testid="events-list">
          {shown.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                // Where the performance has got to, for anyone who cannot see
                // the playhead. Named in `accessibility.md` and absent from
                // the first version of this panel.
                aria-current={e.id === currentId ? 'true' : undefined}
                onClick={() => seek(e.performanceImpact)}
                // The time is part of the name, not decoration beside it: out
                // of visual context "merge" says nothing about where to go.
                aria-label={`${e.caption}, at ${fmtClock(e.performanceImpact)}${e.historicalTime ? `, ${fmtDate(e.historicalTime)}` : ''}. Go there.`}
              >
                <span class="event-when">{fmtClock(e.performanceImpact)}</span>
                <span class="event-what">{e.caption}</span>
                {e.historicalTime && <span class="event-date">{fmtDate(e.historicalTime)}</span>}
                {/* Said only when it is not the ordinary case, so the column
                    stays quiet on a history that is fully known. */}
                {e.provenance !== 'exact' && <span class="event-prov">{e.provenance}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function HelpPanel() {
  // The landing page keeps a demo compiled and running behind the hero, so a
  // performance object exists there even though the visitor never asked for
  // one. Describing *that* under "This repository" would put a made-up
  // history's commit counts and invented contributors in front of someone who
  // only clicked a help link, so the section follows the player, not the data.
  const perf = store.mode.value === 'player' ? store.perf.value : null;
  return (
    <div>
      <p>
        GitTimeline reads a public repository straight from GitHub in your browser, rebuilds the real commit graph, and plays it back as a timelapse. Your repository never leaves the browser — see Connect GitHub for the one thing that does, which is a visit count.
      </p>

      <h3>Sound</h3>
      <p>
        The soundtrack is real recorded music, not a generated score, and there are no sound effects — nothing is triggered by a commit or a
        merge. The repository chooses which of three tracks plays: a project that merges constantly gets something relentless, a long quiet one
        something unhurried. <MusicCredit />
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

      {perf && <HelpThisRepository perf={perf} />}

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
        <kbd>E</kbd>
        <span>the events so far, in words</span>
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

function HelpThisRepository({ perf }: { perf: CompiledPerformance }) {
  const completeness = perf.source.provider === 'synthetic' ? 'synthetic' : perf.coverage.completeness;
  const focus = store.contributorFocus.value;
  const people = [...perf.contributors].sort((a, b) => Number(a.isBot) - Number(b.isBot) || b.commitCount - a.commitCount);
  return (
    <>
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

    </>
  );
}


export type { CompiledPerformance, NodeGeom };
