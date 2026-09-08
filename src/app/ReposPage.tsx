import { SiteBar } from './SiteBar';
import { SiteFoot } from './SiteFoot';
import { MyRepos } from './MyRepos';
import { store } from './store';
import { showLanding } from './controller';

/**
 * Your own repositories, on their own page.
 *
 * This started as a section at the foot of the sign-in page, which was the
 * wrong home twice over. That page is a consent document — several hundred
 * words about what a token can and cannot do — so the list landed 406 pixels
 * down a 1,400 pixel page, under everything a person reads once and never
 * again. And the sign-in page carries the demo performing behind it, so the
 * main line and its commit captions were legible *through* the rows.
 *
 * A list you choose from is a destination, not a footnote to a policy. So it
 * is a page, reached from the bar like Selection, and it is opaque.
 */
export function ReposPage() {
  const connected = !!store.token.value;
  return (
    <div class="page repos-page" data-testid="repos-page">
      <SiteBar page="repos" />
      {/* A `<main>`, so the page can be skipped into. There was none, on any
          of these pages, which leaves a screen-reader user walking the site
          bar every time. */}
      <main class="page-inner">
        <button type="button" class="page-back" onClick={showLanding} data-testid="repos-back">
          ← Back
        </button>
        <header class="page-head">
          <h1>Your repositories</h1>
          <p class="page-lead">
            {connected ? (
              <>
                Read straight from GitHub with your own connection, so these cost your allowance rather than the
                shared one, about 5,000 requests an hour instead of 60. Nothing here is uploaded: your browser talks
                to <code>api.github.com</code> and draws the result on your screen.
              </>
            ) : (
              <>
                Connect GitHub and this becomes a list of your own repositories to pick from, instead of a box to
                type a name into. The connection asks for <b>no permissions at all</b>, it raises your request
                allowance and nothing else.
              </>
            )}
          </p>
        </header>

        {connected ? (
          <MyRepos />
        ) : (
          <section class="repos-empty">
            <p>You are not connected yet.</p>
            <button type="button" class="btn primary" onClick={() => (store.mode.value = 'signin')} data-testid="repos-connect">
              Connect GitHub
            </button>
          </section>
        )}

        {/* Said here as well as on the sign-in page, because this is where
            somebody will be looking for a private repository and not finding
            one. An absence with no explanation reads as a bug. */}
        {/* Named, so it is exposed as a region and can be jumped to. A
            `<section>` with no accessible name is not one. */}
        <section class="repos-note" aria-labelledby="repos-note-heading">
          <h2 id="repos-note-heading">Why a private repository is not in this list</h2>
          {/* Present tense, for something that does not exist.
              This read "making one visible is a separate, deliberate act: a
              read-only grant on the specific repositories you choose,
              revocable one at a time" — which describes a capability nobody
              has built. There is no grant to make and no field to paste a
              token into. The sign-in page had already got this right, opening
              with "Not yet — this is what it will be"; this page had not, and
              a page that promises a thing it cannot do is the one failure this
              project treats as unacceptable. */}
          {/* This used to end "Watching a private repository is not possible
              yet. There is no second authorization to grant and nowhere to
              paste a token." Both halves became false when the fine-grained
              token control shipped, and the sentence was rendered verbatim to
              somebody who had already connected such a token and was looking
              at a row tagged `private` directly above it. `SignIn.tsx` had the
              same sentence and was corrected; this page was missed. */}
          <p>
            The connection above asks GitHub for <b>no permissions</b>, so a private repository is invisible to it.
            GitHub answers as though it does not exist, which is the same answer a stranger gets. To watch one, submit
            a fine-grained token of your own from <b>Connect GitHub</b>: you choose which repositories it covers, and
            it is held in this tab only.
          </p>
          <p class="dim">
            When it exists it will be a read-only grant on <b>the specific repositories you choose</b>, revocable one
            at a time, with nothing else becoming visible alongside it, the terms the sign-in page sets out. Until
            then this list holds your public repositories.
          </p>
          <p>
            Whatever is granted, a private history is never written to this device, not its commits, not its name,
            not in the list of what you have watched. Everything else you open is cached so it need not be downloaded
            twice; a private repository is the exception, and Disconnect clears the rest. If a repository you have
            already watched stops being readable with this connection, the copy kept here is deleted.
          </p>
        </section>
      </main>
      <SiteFoot />
    </div>
  );
}
