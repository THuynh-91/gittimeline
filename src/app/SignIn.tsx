import { SiteBar } from './SiteBar';
import { SiteFoot } from './SiteFoot';
import { useState } from 'preact/hooks';
import { store } from './store';
import { AUTH_BASE, signInWithGitHub } from './auth';
import { showLanding } from './controller';
import { Icons } from './icons';

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
export function SignIn() {
  const [showSetup, setShowSetup] = useState(false);
  const connected = !!store.token.value;
  const configured = !!AUTH_BASE;

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
              ? 'Requests now run against your own allowance — about 5,000 an hour, enough for a large project’s whole history in one sitting.'
              : 'Read public histories faster, and watch your own private ones. Neither sends your code anywhere.'}
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

        {connected ? (
          <div class="signin-actions">
            <button
              type="button"
              class="btn"
              onClick={() => {
                store.token.value = null;
              }}
              data-testid="signout-github"
            >
              Disconnect
            </button>
            <button type="button" class="btn primary" onClick={showLanding}>
              Back to the app
            </button>
          </div>
        ) : (
          <div class="signin-actions">
            {/* The button is always here, and that is deliberate.
                
                It used to render only when a token exchange service was
                configured, so on an unconfigured build the page explained at
                length what connecting GitHub would do and then offered no way
                to do it — which reads as broken rather than as unfinished. It
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
                Not connected on this deployment yet — <button type="button" class="linkish" onClick={() => setShowSetup(!showSetup)}>what that means</button>
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
                <b>That somewhere is a function, not a server.</b> <code>worker/</code> holds a Cloudflare Worker of about two kilobytes which does that single call and nothing else — no database, no idle process, nothing retained.
              </li>
              <li>
                <b>It is written and tested, not deployed.</b> Twenty-four unit tests, and twenty-one end-to-end checks in the real Workers runtime: a forged state, a truncated state, a missing cookie and a rewritten return address are each refused before a code ever reaches GitHub.
              </li>
              <li>
                <b>Two things need an account nobody but the owner has.</b> A GitHub OAuth application — which has no API, so it cannot be scripted — and a Cloudflare deploy. <code>worker/README.md</code> has the steps.
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
            nowhere — not as policy, but as architecture. This site is static
            files on a CDN. There is no server, no database and no log to put a
            repository in, and the fetch runs from the browser straight to
            GitHub without passing through anything of ours. */}
        <section class="grant" aria-labelledby="private-heading">
          <h2 id="private-heading">Your private repositories</h2>
          <p class="grant-lead">
            You can watch your own private repositories too. That is a second, separate authorization — you pick <b>exactly which repositories</b> to grant, read-only, and you can change or revoke it whenever you like.
          </p>
          <ul>
            <li>
              <b>Nothing is uploaded. Ever.</b> Your browser talks to <code>api.github.com</code> directly. The commit history is read, drawn on your screen, and never sent anywhere else.
            </li>
            <li>
              <b>We have nothing to save it on.</b> This is a static site — HTML, JavaScript and pre-built data files. There is no backend, no database, no analytics of your repository contents, and no log that could contain them. Not "we choose not to store it": there is nowhere to store it.
            </li>
            <li>
              <b>Only what you authorize.</b> Repositories you do not grant are invisible to this app, exactly as they are to a stranger.
            </li>
            <li>
              <b>Read-only, and only the history.</b> Commit messages, authors, dates and the shape of the branches. Never file contents — the app has no use for them and does not ask.
            </li>
            <li>
              <b>Gone when you close the tab.</b> The token lives in this tab's memory. Nothing is written to disk, and reopening the site starts from nothing.
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
          — Linux, Chromium, and eight more, whole — ship with the site and cost no requests at all.
        </p>
      </div>
      <SiteFoot />
    </div>
  );
}
