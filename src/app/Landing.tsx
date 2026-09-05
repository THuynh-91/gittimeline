import { useEffect, useRef } from 'preact/hooks';
import { store } from './store';
import { loadDemo, loadRepo } from './controller';
import { parseRepoUrl } from '@/github/url';
import { Icons } from './icons';
import { SiteBar } from './SiteBar';

const SPONSOR_URL = 'https://github.com/sponsors/THuynh-91';

/**
 * Four repositories a visitor will recognise, chosen to be *different shapes*
 * rather than to be the four most famous projects on GitHub. The point is to
 * show that the answer differs: ripgrep is one author becoming a community,
 * Git is topic branches merged by hand, esbuild is one person moving very
 * fast. The genuinely huge ones — Linux, Chromium — are not here because an
 * anonymous visitor cannot fetch them; those live in the catalog, pre-fetched,
 * where they cost nothing.
 */
const EXAMPLES: Array<{ label: string; url: string }> = [
  { label: 'ripgrep', url: 'github.com/BurntSushi/ripgrep' },
  { label: 'Preact', url: 'github.com/preactjs/preact' },
  { label: 'Git', url: 'github.com/git/git' },
  { label: 'esbuild', url: 'github.com/evanw/esbuild' },
];

/**
 * Anonymous GitHub access is capped at about sixty requests an hour per
 * network, which runs out on a large project.
 *
 * This used to open in the middle of the page, directly under the field, where
 * it was a fifth thing competing with the one question the page asks. It is
 * now a footnote that expands over the footer, which is the right weight: the
 * two places somebody actually meets the rate limit are the error dialog and
 * Settings, and both of them already offer this same box. Here it is only a
 * head start for the visitor who already knows they will need it.
 */
/**
 * The landing page asks one question — which repository? — so it is built as
 * one question: a wordmark, a sentence, a field, and a single line of quiet
 * alternatives for the visitor who has no repository in mind.
 *
 * What used to be here and is not any more:
 *
 * - The row of example chips and the second row of recently-opened ones. Two
 *   rows of bordered pills under a sentence of body copy read as a wall of
 *   fragments rather than as suggestions. They are now names in a line of
 *   prose, and the two rows can never both appear: if you have opened
 *   something before, your own repositories are the better suggestion and they
 *   take the line over.
 * - The catalog's two-line bar with its own subtitle. It was a card competing
 *   with the field directly beneath it; it is the end of the same line now,
 *   the brightest thing in it, and it still goes to a whole page of its own.
 * - The hairline under the wordmark, and most of the wordmark's size. The
 *   performance behind this page is the thing worth looking at, and eleven
 *   letters at fifty-six pixels were the loudest object on screen.
 */
export function Landing() {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (e?: Event) => {
    e?.preventDefault();
    const value = store.input.value.trim();
    if (!value) {
      // An empty PLAY performs the built-in demo in full. There used to be a
      // second button beside this one that did exactly this under a different
      // name; two names for one action is not two choices.
      //
      // It loads the demo rather than promoting whatever is behind the form,
      // which is a differently seeded shop-window history and not the scripted
      // tour of the motion language this button promises.
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
    if (!parsed.ok) return;
    // Pasting a whole URL is a replacement — nobody pastes a repository URL
    // meaning to append it to another one — but only when the field is empty
    // or entirely selected. Taking the whole field otherwise silently deleted
    // text the caret was sitting in the middle of, which reads as paste being
    // broken rather than as normalisation.
    const el = e.currentTarget as HTMLInputElement | null;
    const value = el?.value ?? '';
    const whole = !value || (el?.selectionStart === 0 && el?.selectionEnd === value.length);
    if (!whole) return;
    e.preventDefault();
    store.input.value = parsed.repo.slug;
    store.inputError.value = null;
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
  const typed = !!store.input.value.trim();

  // One list, never two. Repositories you have already watched are a better
  // suggestion than four picked by us, so when they exist they take the line
  // rather than opening a second row underneath it.
  const suggestions =
    recent.length > 0
      ? recent.slice(0, 4).map((r) => ({ key: r.slug, label: r.slug.split('/')[1] ?? r.slug, title: r.slug, target: r.slug }))
      : EXAMPLES.map((ex) => ({ key: ex.url, label: ex.label, title: ex.url, target: ex.url }));

  return (
    <section class="landing" aria-labelledby="landing-title">
      <SiteBar page="landing" />

      <div class="landing-hero">
        <h1 id="landing-title" class="title">
          <span class="mark-git">Git</span>
          <span class="mark-time">Timeline</span>
        </h1>
        <p class="subtitle">Paste a public GitHub repository and watch its history perform itself.</p>
        <form class="url-form" onSubmit={submit}>
          {/* Input and action are one control, not two objects that happen to
              sit beside each other: the border belongs to the pair and lights
              up whichever of them has focus. */}
          <div class={`url-row${err ? ' invalid' : ''}`}>
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
              <Icons.play /> {typed ? 'Play' : 'Play demo'}
            </button>
          </div>
          <div id="url-hint" class={`form-hint${err ? '' : ' ok'}`} aria-live="polite">
            {err ? err : parsed && parsed.ok ? `Reads ${parsed.repo.slug} from GitHub, renders on your device.` : 'Fetched from GitHub, rendered on your device. Nothing is uploaded.'}
          </div>
        </form>

        {/* Somewhere to start, for a visitor who has not arrived with a URL in
            mind. One line, names only, and never two lines: repositories
            already watched are a better suggestion than four picked by us, so
            when they exist they take the line rather than opening a second row
            underneath. That second row was most of what made this area
            unreadable — a label, four names, another label, three more names,
            directly beneath a sentence of body copy. */}
        <p class="ways">
          <span class="ways-label">{recent.length > 0 ? 'Again' : 'Try'}</span>
          {suggestions.map((s) => (
            <button
              key={s.key}
              type="button"
              title={s.title}
              onClick={() => {
                store.input.value = s.target;
                store.inputError.value = null;
                void loadRepo(s.target, { autoplay: true });
              }}
            >
              {s.label}
            </button>
          ))}
        </p>

        {/* The other way in, and the only one that costs a visitor nothing at
            all, so it gets its own line and its own weight. */}
        <button type="button" class="shelf-cta" onClick={() => (store.mode.value = 'catalog')} data-testid="catalog-cta">
          Selection ready to watch
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <footer class="landing-foot">
        {/* The history behind the form is generated, and a page that shows a
            picture of a repository owes the reader the fact that this one is
            not a repository. */}
        {store.isDemo.value && <p class="landing-note">Behind this page: a generated history, not a real repository.</p>}
        {/* Out of the navigation and into the footer. Nothing here is
            paywalled and nothing is gated, so this asks once, quietly, at the
            bottom — not from the top bar where it was competing with the
            routes people actually came for. */}
        <a class="support-link" href={SPONSOR_URL} target="_blank" rel="noopener noreferrer">
          <span aria-hidden="true">♥</span> Support this project
        </a>
      </footer>
    </section>
  );
}
