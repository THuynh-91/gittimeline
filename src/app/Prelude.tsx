import { useState } from 'preact/hooks';
import { store, isBusy, phaseSpoken } from './store';
import { cancel, retry, playCachedPartial, loadDemo } from './controller';
import { formatReset } from '@/github/ratelimit';

const STAGES: Array<{ key: string; label: string }> = [
  { key: 'metadata', label: 'Reading repository' },
  { key: 'expanding', label: 'Mapping known commits' },
  { key: 'tips', label: 'Finding parallel threads' },
  { key: 'compile', label: 'Composing the performance' },
];

/** Loading is the opening of the show: honest stage progress, cancellable, never a fake percentage. */
/**
 * GitHub allows roughly sixty anonymous requests an hour per network, which is
 * a few thousand commits. A free read-only token raises that to about five
 * thousand — enough for a large open-source project. Offering it exactly where
 * the limit bites is far more useful than burying it in settings.
 */
function TokenEscape({ resetAt }: { resetAt: number | null }) {
  const [value, setValue] = useState('');
  return (
    <div>
      <p>
        {resetAt ? `It resets ${formatReset(resetAt)}. ` : ''}That limit is GitHub's, not GitTimeline's, and applies to your whole network. A free fine-grained token with read-only public access raises it from about 60 requests an hour to about 5,000, which is the difference between a few thousand commits and a large project's whole history.
      </p>
      <div class="token-inline">
        <input
          type="text"
          autoComplete="off"
          spellcheck={false}
          aria-label="GitHub token"
          placeholder="github_pat_… (kept in this tab only)"
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          class="btn primary small"
          onClick={() => {
            store.token.value = value.trim() || null;
            retry();
          }}
        >
          Use token
        </button>
      </div>
      <p>
        Create one at <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener noreferrer">github.com/settings/personal-access-tokens</a> with no extra permissions. It stays in memory for this tab, is sent only to api.github.com, and is never stored, logged or put in a shared link.
      </p>
    </div>
  );
}

export function Prelude() {
  const busy = isBusy.value;
  const error = store.error.value;
  if (!busy && !error) return null;
  if (store.mode.value !== 'player') return null;
  // While the viewer is being asked how much history to fetch, that question is
  // the only thing on screen; a progress panel over it would block the answer.
  if (store.scope.value) return null;

  if (error) {
    return (
      <div class="prelude" role="alertdialog" aria-labelledby="err-title" aria-describedby="err-desc">
        <div class="error-card">
          <h2 id="err-title">{error.title}</h2>
          <p id="err-desc">{error.message}</p>
          {error.kind === 'not-found' && (
            <p>
              Accepted forms: <code>github.com/owner/repository</code>, <code>owner/repository</code>, or an https link. Private repositories are not supported by this hosted viewer.
            </p>
          )}
          {(error.kind === 'rate-limited' || error.kind === 'secondary-limit') && <TokenEscape resetAt={error.resetAt} />}
          <div class="actions">
            {error.canPlayPartial && (
              <button type="button" class="btn primary" onClick={() => void playCachedPartial()}>
                Play cached copy
              </button>
            )}
            {error.retry && (
              <button type="button" class="btn" onClick={retry}>
                Retry
              </button>
            )}
            <button type="button" class="btn" onClick={() => void loadDemo({ autoplay: true, landing: false })}>
              Play the demo instead
            </button>
            <button
              type="button"
              class="btn"
              onClick={() => {
                store.error.value = null;
                store.mode.value = 'landing';
                store.phase.value = store.perf.value ? 'READY' : 'IDLE';
              }}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const progress = store.progress.value;
  const compileStage = store.compileStage.value;
  const phase = store.phase.value;
  const activeKey = compileStage ? 'compile' : progress?.phase === 'landmarks' || progress?.phase === 'normalizing' ? 'compile' : progress?.phase === 'anchor' ? 'expanding' : progress?.phase ?? 'metadata';
  const activeIdx = Math.max(0, STAGES.findIndex((s) => s.key === activeKey));
  const total = progress?.reportedTotal;
  const loaded = progress?.commitsLoaded ?? 0;
  const pct = total && total > 0 && !compileStage ? Math.min(100, Math.round((loaded / total) * 100)) : null;
  const name = progress?.repoName ?? store.dataset.value?.source.name ?? '';
  const rate = progress?.rate ?? store.rate.value;

  return (
    <div class="prelude" role="status" aria-live="polite" data-testid="prelude">
      {name && <div class="name">{name.split('/').pop()}</div>}
      {name && <div class="slug">{name}</div>}
      <ol class="stages">
        {STAGES.map((s, i) => (
          <li key={s.key} class={i < activeIdx ? 'done' : i === activeIdx ? 'active' : ''}>
            {i === activeIdx && compileStage ? compileStage : i === activeIdx && progress ? progress.message : s.label}
            {i === activeIdx && loaded > 0 && !compileStage ? ` (${loaded.toLocaleString('en-US')}${total ? ` of ~${total.toLocaleString('en-US')}` : ''})` : ''}
          </li>
        ))}
      </ol>
      <div class={`bar${pct == null ? ' indeterminate' : ''}`} aria-hidden="true">
        <i style={pct != null ? `width:${pct}%` : ''} />
      </div>
      {rate && rate.remaining != null && (
        <div class="rate">
          GitHub requests remaining: {rate.remaining}
          {rate.limit != null ? ` / ${rate.limit}` : ''}
          {progress?.fromCache ? ' · using local cache' : ''}
        </div>
      )}
      <div class="actions">
        <button type="button" class="btn" onClick={cancel} data-testid="cancel-button">
          Cancel
        </button>
      </div>
      <span class="sr-only">{phaseSpoken(phase)}</span>
    </div>
  );
}
