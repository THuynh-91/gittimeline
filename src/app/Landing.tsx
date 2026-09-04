import { useEffect, useRef, useState } from 'preact/hooks';
import { store } from './store';
import { loadDemo, loadRepo, loadArtifactFile, play } from './controller';
import { Catalog } from './Catalog';
import { parseRepoUrl } from '@/github/url';
import { Icons } from './icons';

const EXAMPLES: Array<{ label: string; url: string }> = [
  { label: 'ripgrep', url: 'github.com/BurntSushi/ripgrep' },
  { label: 'Preact', url: 'github.com/preactjs/preact' },
  { label: 'Git', url: 'github.com/git/git' },
  { label: 'React', url: 'github.com/facebook/react' },
];

/**
 * Anonymous GitHub access is capped at about sixty requests an hour per
 * network, which runs out on a large project. This is where someone hits that
 * wall, so this is where the way past it belongs.
 */
function TokenNote() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(store.token.value ?? '');
  const active = !!store.token.value;
  if (!open) {
    return (
      <button type="button" class="token-link" onClick={() => setOpen(true)} data-testid="token-disclosure">
        {active ? 'GitHub token active — about 5,000 requests an hour' : 'Loading a large repository? Use your GitHub token'}
      </button>
    );
  }
  return (
    <div class="token-panel">
      <p>
        Without a token GitHub allows your network about 60 requests an hour, which covers a few thousand commits. A free fine-grained token with read-only public access raises that to about 5,000, enough for a large project's whole history.
      </p>
      <div class="token-inline">
        <input
          type="text"
          autoComplete="off"
          spellcheck={false}
          aria-label="GitHub token"
          placeholder="github_pat_…"
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          data-testid="landing-token"
        />
        <button type="button" class="btn primary small" onClick={() => { store.token.value = value.trim() || null; setOpen(false); }}>
          Use
        </button>
      </div>
      <p>
        Create one at <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener noreferrer">github.com/settings/personal-access-tokens</a> with no extra permissions selected. It stays in memory for this tab only, goes only to api.github.com, and is never stored or shared.
      </p>
    </div>
  );
}

export function Landing() {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (e?: Event) => {
    e?.preventDefault();
    const value = store.input.value.trim();
    if (!value) {
      // An empty PLAY performs the built-in demo in full.
      void loadDemo({ autoplay: true, landing: false });
      return;
    }
    void loadRepo(value, { autoplay: true });
  };

  const onInput = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    store.input.value = value;
    if (!value.trim()) {
      store.inputError.value = null;
      return;
    }
    const parsed = parseRepoUrl(value);
    store.inputError.value = parsed.ok ? null : parsed.hint;
  };

  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text') ?? '';
    const parsed = parseRepoUrl(text);
    if (parsed.ok) {
      e.preventDefault();
      store.input.value = parsed.repo.slug;
      store.inputError.value = null;
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      store.input.value = '';
      store.inputError.value = null;
    }
  };

  const parsed = store.input.value.trim() ? parseRepoUrl(store.input.value) : null;
  const err = store.inputError.value;
  const recent = store.recent.value;

  return (
    <section class="landing" aria-labelledby="landing-title">
      <h1 id="landing-title" class="title">
        GitTimeline
      </h1>
      <p class="subtitle">Paste a public GitHub repository and watch its history perform itself.</p>
      <form class="url-form" onSubmit={submit}>
        <div class="url-row">
          <input
            ref={inputRef}
            class="url-input"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellcheck={false}
            placeholder="github.com/owner/repository"
            aria-label="Public GitHub repository URL"
            aria-invalid={!!err}
            aria-describedby="url-hint"
            value={store.input.value}
            onInput={onInput}
            onPaste={onPaste}
            onKeyDown={onKey}
            data-testid="url-input"
          />
          <button type="submit" class="play-btn" data-testid="play-button">
            <Icons.play /> {store.input.value.trim() ? 'Play' : 'Play demo'}
          </button>
        </div>
        <div id="url-hint" class={`form-hint${err ? '' : ' ok'}`} aria-live="polite">
          {err ? err : parsed && parsed.ok ? `Reads ${parsed.repo.slug} from GitHub, renders on your device.` : 'Fetched from GitHub, rendered on your device. Nothing is uploaded.'}
        </div>
        <div class="examples" aria-label="Examples">
          <span>Try</span>
          {EXAMPLES.map((ex) => (
            <button
              type="button"
              key={ex.url}
              onClick={() => {
                store.input.value = ex.url;
                store.inputError.value = null;
                void loadRepo(ex.url, { autoplay: true });
              }}
            >
              {ex.label}
            </button>
          ))}
          <span>·</span>
          <button type="button" onClick={() => void loadDemo({ autoplay: true, landing: false })} data-testid="demo-button">
            the built-in demo
          </button>
        </div>
        {recent.length > 0 && (
          <div class="recent" aria-label="Recent repositories">
            {recent.map((r) => (
              <button type="button" key={r.slug} onClick={() => void loadRepo(r.slug, { autoplay: true })}>
                {r.slug}
              </button>
            ))}
          </div>
        )}
      </form>
      <Catalog />
      <TokenNote />
      <div class="meta">
        <span>Fetched from GitHub, rendered on your device. No backend, no account, no upload.</span>
        <span>
          <a href="#" onClick={(e) => { e.preventDefault(); store.panel.value = 'help'; play(); }}>
            How it works
          </a>
          {' · '}
          <a href="https://github.com/" target="_blank" rel="noopener noreferrer">
            Open source
          </a>
          {' · '}
          <label style="cursor:pointer">
            Import a .gittimeline file
            <input
              type="file"
              accept=".gittimeline,.gitdance,.json,.gz"
              class="sr-only"
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) void loadArtifactFile(f);
              }}
            />
          </label>
        </span>
      </div>
    </section>
  );
}
