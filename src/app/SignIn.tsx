import { SiteBar } from './SiteBar';
import { SiteFoot } from './SiteFoot';
import { useState } from 'preact/hooks';
import { store } from './store';
import { AUTH_BASE, signInWithGitHub } from './auth';
import { showLanding, clearStoredHistories } from './controller';
import { Icons } from './icons';
import { useCatalogEntries } from './Catalog';

/**
 * Connecting a GitHub account.
 *
 * This replaced a disclosure panel on the landing page that asked the visitor
 * to create a fine-grained personal access token, paste it into a text field,
 * and take it on faith that the field was safe. That is a lot to ask of
 * someone who only wanted to watch a repository, and it put a password-shaped
 * box on the first page of the site — which is exactly the shape of the thing
 * people are told never to fill in.
 *
 * So it is a page, and the page is mostly the answer to "what am I agreeing
 * to". The answer is unusually good and worth spending the room on: the OAuth
 * app requests **no scopes at all**. A token with no scopes reads precisely
 * what an anonymous visitor reads — public repositories, nothing else — it
 * simply reads it against a 5,000-an-hour allowance instead of sixty. It
 * cannot see a private repository, cannot write anything, and cannot act as
 * the account in any way.
 *
 * There is no server here to keep it on. The exchange runs in a function that
 * hands the token back and forgets it; the token lives in this tab's memory,
 * is sent to api.github.com and nowhere else, and is gone when the tab closes.
 */
/** Small numbers written out, to match the voice of the rest of the page. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const spell = (n: number): string => WORDS[n] ?? String(n);


/**
 * The second grant: a fine-grained token, for private repositories.
 *
 * ## Why this exists
 *
 * A viewer signed in, went looking for how to reach a private repository, and
 * could not find it — because there was nothing to find. `signInWithGitHub` is
 * called from exactly one place in the app, the OAuth application requests
 * **no scopes at all**, and a token with no scopes gets a 404 for a private
 * repository, indistinguishable from one that does not exist. So there was no
 * second button, and the section above this one said "not yet", which is true
 * of the GitHub App grant it describes and reads as "this app cannot show you
 * private repositories" — which is false.
 *
 * It was false because the capability already existed and was filed under
 * something else: the token box in Settings, under the heading "Large
 * repositories", presented as a rate-limit workaround with no mention of
 * private access anywhere near it. Three places, none of which pointed at the
 * other two. `docs/private-repositories.md` is the written version of this.
 *
 * ## Why it is a separate control and not a wider sign-in
 *
 * Because a wider sign-in is the thing this app should not have. The OAuth
 * application's value is that it *cannot* read a private repository — that is
 * what makes "no permissions at all" true on the button above, and it stays
 * true. Reaching further has to be a deliberate, separate act, with the
 * credential chosen and scoped in GitHub's own interface where it can be
 * inspected and revoked, and it has to be obvious that it is a different thing
 * from signing in.
 *
 * ## What it does with the credential
 *
 * Nothing that the OAuth token does not already get. It goes into the same
 * signal, which lives in this tab's memory, is attached as an `Authorization`
 * header to `api.github.com` and to nothing else, and is never persisted —
 * `Settings` is the only thing written to `localStorage` and has no token
 * field. Every write path is already closed for a private history:
 * `probeRepository` asks GitHub whether a repository is private on an
 * explicitly uncached client before anything else runs, the ingest is
 * cache-disabled, `putDataset` and `touchRecent` are skipped, and the
 * repository list is fetched with `cache: null`. `tests/e2e/private.spec.ts`
 * proves it by watching a private history and then reading IndexedDB and
 * localStorage rather than by trusting the code.
 *
 * ## The details that are security, not decoration
 *
 * - `type="password"`, so it is not painted into the page, a screenshot, or
 *   the accessibility tree. The Settings field was `type="text"` seeded from
 *   the live token, which displayed an OAuth credential in cleartext to
 *   anyone who opened that panel.
 * - Never seeded from `store.token`. This box only ever writes.
 * - Cleared the moment it is applied, so the value does not sit in component
 *   state behind a collapsed disclosure for the rest of the session.
 * - **No `<form>` element.** A form with a text input submits on Enter, and a
 *   default submission is a GET to the current URL with the field's value in
 *   the query string — which would put the credential in the address bar, in
 *   history, and in any referrer. There is no form here and Enter is handled
 *   explicitly.
 * - A classic `ghp_` token is warned about rather than refused. Classic tokens
 *   are all-or-nothing across every repository the account can reach; the
 *   viewer may still have reasons, and refusing a credential someone has
 *   deliberately pasted is not this page's decision to make.
 */
function PrivateTokenGrant() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [appliedTo, setAppliedTo] = useState<string | null>(null);
  /**
   * "In use for this tab" has to stop being true when the token does.
   *
   * This was a plain `applied` boolean in component state. Nulling
   * `store.token` re-renders the page around this component and leaves that
   * boolean alone, so after Disconnect the heading read "Connect GitHub", the
   * Disconnect button was gone, and this line still said the token was in use
   * — a false statement about a live credential, and the reading that would
   * stop somebody going to delete a long-lived PAT at GitHub.
   *
   * Comparing against the token itself rather than tracking a flag: the note
   * is shown when the signal still holds what this box put there, so it goes
   * away when the token is cleared, replaced, or swapped for an OAuth one,
   * without anything needing to remember to reset it.
   */
  const applied = appliedTo !== null && store.token.value === appliedTo;
  const classic = value.trim().startsWith('ghp_') || value.trim().startsWith('gho_');

  const apply = () => {
    const token = value.trim();
    if (!token) return;
    store.token.value = token;
    // Out of the field as soon as it is in the signal. One copy is
    // unavoidable; two is a choice. `appliedTo` holds it only to compare
    // against, which is the same value the signal already has.
    setValue('');
    setAppliedTo(token);
  };

  return (
    <div class="grant-token">
      {/* A button, not a `linkish` span. It was the latter, sitting in a
          paragraph of prose under a bold "Not yet", and was missed by the
          person who asked for it — after it had shipped. A control that
          performs the thing the section is about should look like a control. */}
      <button
        type="button"
        class="btn primary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid="private-token-toggle"
      >
        {open ? 'Hide token setup' : 'Set up private access'}
      </button>

      {open && (
        <div class="grant-token-body" data-testid="private-token-panel">
          <p>
            The sign-in above cannot reach a private repository and is not meant to. A{' '}
            <b>fine-grained personal access token</b> can, today, and you choose which repositories it covers when
            you create it.
          </p>
          <ol>
            <li>
              Open{' '}
              <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
                github.com/settings/personal-access-tokens
              </a>{' '}
              and generate a fine-grained token.
            </li>
            <li>
              Under <b>Repository access</b> choose <b>Only select repositories</b> and pick the ones you want to
              watch.
            </li>
            <li>
              Under <b>Repository permissions</b> set <b>Contents</b> to <b>Read-only</b>. That is the whole grant:
              it reads commits and nothing else. Leave every other permission alone.
            </li>
          </ol>

          <div class="field">
            <label for="private-token">Paste it here</label>
            <input
              id="private-token"
              type="password"
              autoComplete="off"
              spellcheck={false}
              value={value}
              placeholder="github_pat_…"
              onInput={(e) => {
                setValue((e.target as HTMLInputElement).value);
                setAppliedTo(null);
              }}
              onKeyDown={(e) => {
                // Explicit, because there is deliberately no form to submit.
                if ((e as KeyboardEvent).key === 'Enter') {
                  e.preventDefault();
                  apply();
                }
              }}
              data-testid="private-token-input"
            />
          </div>

          {classic && (
            <p class="signin-note" data-testid="private-token-classic">
              That looks like a <b>classic</b> token. Classic tokens are all-or-nothing across every repository your
              account can reach. A fine-grained one covers only the repositories you pick. This will work either way.
            </p>
          )}

          <div class="signin-actions">
            <button type="button" class="btn primary" onClick={apply} data-testid="private-token-apply">
              Use this token
            </button>
            <button type="button" class="btn" onClick={() => (store.mode.value = 'repos')}>
              Your repositories
            </button>
          </div>

          {applied && (
            <p class="signin-note" data-testid="private-token-applied">
              In use for this tab. <b>Your repositories</b> now lists what it can see, private ones marked{' '}
              <code>private</code>.
            </p>
          )}

          <ul>
            <li>
              <b>It replaces the sign-in for this tab.</b> Both are the same one credential, so pasting this uses it
              instead of the OAuth token. Disconnect puts you back to neither.
            </li>
            <li>
              <b>Same handling as everything else.</b> Held in this tab's memory, sent only to{' '}
              <code>api.github.com</code>, never written to disk, never logged, never in a shared link. A private
              history is watched and never cached, Settings has the button that proves the cache is public-only.
            </li>
            <li>
              <b>Revoked in two places, either of which is enough.</b> Disconnect here clears the token and every
              history cached on this device; deleting the token at{' '}
              <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>{' '}
              ends it everywhere, including anywhere you forgot.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

export function SignIn() {
  const [showSetup, setShowSetup] = useState(false);
  const connected = !!store.token.value;
  const configured = !!AUTH_BASE;
  /**
   * Counted, not written down. This said "eight more" when the shelf held
   * twelve, and said the histories "ship with the site" when they are fetched
   * from object storage on demand, both true when the sentence was written
   * and both stale within a fortnight. A number in prose about a list that is
   * fetched at runtime is a number that will be wrong again.
   */
  const { entries: shelf } = useCatalogEntries();
  const others = shelf && shelf.length > 2 ? spell(shelf.length - 2) : null;

  return (
    <div class="page signin-page" data-testid="signin-page">
      <SiteBar page="signin" />
      <div class="page-inner narrow">
        <button type="button" class="page-back" onClick={showLanding} data-testid="signin-back">
          ← Back
        </button>

        <header class="page-head">
          <h1>{connected ? 'GitHub connected' : 'Connect GitHub'}</h1>
          <p class="page-lead">
            {connected
              ? 'Requests now run against your own allowance, about 5,000 an hour, enough for a large project’s whole history in one sitting.'
              : 'Read public histories against your own allowance instead of a shared one. Nothing you connect sends your code anywhere.'}
          </p>
        </header>

        {/* The numbers are the reason anyone is on this page: something did not
            finish loading and the app said this was why. */}
        <div class="rate-compare">
          <div class={`rate-card${connected ? '' : ' now'}`}>
            <b>~60</b>
            <span>requests an hour</span>
            <i>Anonymous, shared across everyone on your network. A few thousand commits.</i>
          </div>
          <div class={`rate-card${connected ? ' now' : ' better'}`}>
            <b>~5,000</b>
            <span>requests an hour</span>
            <i>Signed in. Enough for almost any repository on GitHub, whole.</i>
          </div>
        </div>


        {/* Where to go next, rather than the list itself: this page is a
            consent document and the demo performs behind it, so a list of
            repositories here was both buried and drawn over. */}
        {connected && (
          <div class="signin-next">
            <button type="button" class="btn primary" onClick={() => (store.mode.value = 'repos')} data-testid="signin-to-repos">
              Pick one of your repositories
            </button>
          </div>
        )}

        {connected ? (
          <div class="signin-actions">
            <button
              type="button"
              class="btn"
              onClick={() => {
                store.token.value = null;
                // Disconnecting means disconnecting. Anything fetched while
                // signed in was fetched with a credential that is now gone, and
                // leaving it on the device makes "revoke" a word about GitHub
                // rather than about this machine.
                void clearStoredHistories();
              }}
              data-testid="signout-github"
            >
              Disconnect
            </button>
            <button type="button" class="btn primary" onClick={showLanding}>
              Back to the app
            </button>
            {/* What Disconnect can and cannot do, said next to it.
                A viewer noticed they could disconnect and reconnect with one
                click and no prompt, and asked whether that was a concern. It
                is worth answering honestly rather than hiding: an OAuth
                authorization lives at GitHub, not here, so clearing this
                browser cannot clear GitHub's record of it, and GitHub gives an
                OAuth app no way to force the consent screen again. The token
                itself carries no scopes, so what survives is permission to
                read public data faster.
                The alternative would be revoking the grant through GitHub's
                API on Disconnect, which needs the client secret and therefore
                needs the token sent to our own service. That would cost the
                claim that it goes nowhere but api.github.com, which is the
                thing worth protecting. So: say what it does, and put the real
                revoke one click away. */}
            <p class="signin-note" data-testid="disconnect-scope">
              Disconnect clears the token and every history cached on this device. It cannot cancel the
              authorization you gave GitHub, so signing in again will not ask you to confirm. To end it properly,
              remove GitTimeline from{' '}
              <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer">
                your GitHub authorized apps
              </a>
              . A fine-grained token you pasted in yourself is different: GitHub never knew about this app, so
              disconnecting is the end of it here, and you can delete the token at GitHub too.
            </p>
          </div>
        ) : (
          <div class="signin-actions">
            {/* The button is always here, and that is deliberate.
                
                It used to render only when a token exchange service was
                configured, so on an unconfigured build the page explained at
                length what connecting GitHub would do and then offered no way
                to do it, which reads as broken rather than as unfinished. It
                briefly pointed at a Render service instead, which was worse: a
                twelve-second wake followed by a 503, because no OAuth
                application had ever been registered against it.
                
                So it is a real button that says what is true. Where the
                exchange exists it signs you in; where it does not, it says so
                and shows what is missing rather than failing silently. */}
            <button
              type="button"
              class="btn primary big"
              onClick={() => (configured ? signInWithGitHub() : setShowSetup(!showSetup))}
              aria-expanded={configured ? undefined : showSetup}
              data-testid="signin-github"
            >
              <Icons.github /> Sign in with GitHub
            </button>
            {!configured && (
              <p class="signin-note" data-testid="signin-unavailable">
                Not connected on this deployment yet, <button type="button" class="linkish" onClick={() => setShowSetup(!showSetup)}>what that means</button>
              </p>
            )}
          </div>
        )}

        {!configured && showSetup && (
          <section class="grant setup" aria-labelledby="setup-heading" data-testid="signin-setup">
            <h2 id="setup-heading">Why the button cannot sign you in yet</h2>
            <p class="grant-lead">
              GitHub finishes a sign-in by trading a one-time code for a token, and that trade cannot happen in a browser: the endpoint sends no <code>Access-Control-Allow-Origin</code> header, on the request or the preflight, so the response is blocked before this page could read it. GitHub offers no PKCE for public clients either. Exactly one call has to be made somewhere else.
            </p>
            <ul>
              <li>
                <b>That somewhere is a function, not a server.</b> <code>worker/</code> holds a Cloudflare Worker of about two kilobytes which does that single call and nothing else, no database, no idle process, nothing retained.
              </li>
              <li>
                <b>It is written and tested, not deployed.</b> Twenty-seven unit tests, run in CI on every change since they turned out not to be, and end-to-end checks in the real Workers runtime: a forged state, a truncated state, a missing cookie and a rewritten return address are each refused before a code ever reaches GitHub.
              </li>
              <li>
                <b>Two things need an account nobody but the owner has.</b> A GitHub OAuth application, which has no API, so it cannot be scripted, and a Cloudflare deploy. <code>worker/README.md</code> has the steps.
              </li>
            </ul>
            <p class="grant-revoke">Until then everything else works: public repositories at the anonymous rate, and the ready-made histories at no cost at all.</p>
          </section>
        )}

        {/* What is actually being granted. Every line is a fact about the
            request this page makes, not a reassurance about our intentions. */}
        <section class="grant" aria-labelledby="grant-heading">
          <h2 id="grant-heading">What signing in does</h2>
          <ul>
            <li>
              <b>Raises your rate limit.</b> That is the whole of it. The same public history, read faster.
            </li>
            <li>
              <b>Requests no permissions.</b> The authorization asks for zero scopes, so GitHub issues a token that reads what any logged-out visitor can read and nothing more.
            </li>
            <li>
              <b>Cannot write anything.</b> It cannot star, fork, comment, push, or change anything about your account.
            </li>
          </ul>
        </section>

        {/* Private repositories are a separate, opt-in grant, and the thing
            people rightly want to know is where their code goes. The answer is
            nowhere, not as policy, but as architecture. This site is static
            files on a CDN. There is no server, no database and no log to put a
            repository in, and the fetch runs from the browser straight to
            GitHub without passing through anything of ours. */}
        <section class="grant" aria-labelledby="private-heading">
          <h2 id="private-heading">Your private repositories</h2>
          {/* The working answer first.
              This section used to open with "Not yet, this is what it will
              be" in bold, describing the GitHub App that is not built, with
              the control that *does* work underneath it. A viewer who had
              already signed in read the heading, read "Not yet", and stopped:
              twice, and said so the second time. Leading with a refusal and
              burying the answer under it is worse than the original problem of
              having no answer at all, because it looks like a considered no.
              So: what works, then what is missing. */}
          <p class="grant-lead">
            <b>Yes, with a token you scope yourself.</b> The sign-in above deliberately asks for{' '}
            <b>no permissions at all</b>, which is why it cannot see a private repository: a token with no scopes
            reads exactly what a stranger reads. Reaching further is a separate, deliberate step, and you decide in
            GitHub's own interface which repositories it covers.
          </p>
          <PrivateTokenGrant />
          <p class="grant-lead grant-later">
            <b>A better version is coming.</b> A small GitHub App you install on exactly the repositories you
            choose, revocable per repository, with nothing to paste anywhere. It is not built yet, a GitHub App has
            to be created through GitHub's own interface, which has no API, and until it is, the token above is the
            honest route rather than the ideal one. <code>docs/private-repositories.md</code> explains the
            difference.
          </p>
          <ul>
            <li>
              <b>Your repository never leaves the browser.</b> Your browser talks to <code>api.github.com</code> directly. The commit history is read, drawn on your screen, and never sent anywhere else, not the commits, not the messages, not the names, not the shape of the graph.
            </li>
            <li>
              <b>One thing does leave, and it is not your repository.</b> This site counts visits with Google Analytics: a page view, and an event when a performance starts. For one of the ready-made histories that event carries the repository's name, because it is already public and on the shelf. For anything you open yourself it carries a bucket of the commit count and nothing identifying, and <b>for a private repository it carries the four words "a private repository" and nothing else</b>, no name, no size, no count, because a coarse number attached to a repository somebody chose not to publish is a fingerprint of it. Switch it off with Do Not Track or any blocker and the site works exactly the same.
            </li>
            <li>
              <b>We have nothing to save it on.</b> This is a static site, HTML, JavaScript and pre-built data files. There is no backend, no database, no analytics of your repository contents, and no log that could contain them. Not "we choose not to store it": there is nowhere to store it.
            </li>
            <li>
              <b>Only what you authorize.</b> Repositories you do not grant will be invisible to this app, exactly as they are to a stranger.
            </li>
            <li>
              <b>Read-only, and only the history.</b> Commit messages, authors, dates and the shape of the branches. Never file contents, the app has no use for them and does not ask.
            </li>
            <li>
              {/* This used to end "Nothing is written to disk, and reopening
                  the site starts from nothing." The first half is true of the
                  token and the sentence did not stop there: a cache of the
                  public GitHub responses already fetched is kept on the device
                  so the same history is not downloaded twice — measured at
                  115 KB after opening one repository — along with the list of
                  what has been watched. Saying otherwise on the page that
                  explains what is stored is the one place it matters most, and
                  it sat directly above a paragraph about private repositories.
                  Settings has the size and a button to clear it. */}
              <b>Gone when you close the tab.</b> The token lives in this tab's memory and is never written to disk. Responses already fetched from GitHub are
              cached on your device so the same history is not downloaded twice, public repositories only, never a private one, and Settings shows its size and clears it. Disconnecting clears it too.
            </li>
          </ul>
          <p class="grant-revoke">
            Revoke either grant at any time from{' '}
            <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer">
              your GitHub authorized apps
            </a>
            .
          </p>
        </section>

        {/* The alternative, stated plainly, because a sign-in page that does
            not admit you can skip it is a sign-in wall. */}
        <p class="signin-alt">
          You do not have to.{' '}
          <button type="button" class="linkish" onClick={() => (store.mode.value = 'catalog')}>
            The ready-made histories
          </button>{' '}
         , Linux, Chromium{others != null ? ` and ${others} more` : ' and the rest'}, whole, are prepared in advance
          and cost no GitHub requests at all.
        </p>
      </div>
      <SiteFoot />
    </div>
  );
}
