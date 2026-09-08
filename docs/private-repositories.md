# Watching a private repository

Status: **works today, by the second route below.** Written 2026-09-07.

> "I connect my repo, but I don't know how to elevate and look for private
> now... so is there no way to elevate the perms, there isn't 2 different sign
> in buttons to elevate?"

There wasn't. There is now. This document is what the app should have been
saying all along.

---

## 1. Why signing in cannot do it

`signInWithGitHub` is called from exactly one place in the entire codebase —
`SignIn.tsx`, the button on the sign-in page — and the OAuth application it
starts requests **no scopes at all** (`worker/src/index.mjs`, `scope` set to
the empty string, asserted in `worker/test/auth.test.mjs`).

A token with no scopes reads precisely what an anonymous visitor reads. It
raises the request allowance from about 60 an hour to about 5,000 and does
nothing else. Asked for a private repository it gets a **404** —
indistinguishable from a repository that does not exist, which is
[what GitHub does deliberately](https://docs.github.com/en/rest) so that a
credential cannot be used to enumerate private names.

So there is nothing to elevate. That is the point: "asks for **no permissions
at all**" is printed on the sign-in page, and it stays true.

## 2. The route that works

A **fine-grained personal access token**, entered in the app.

1. Open <https://github.com/settings/personal-access-tokens> and generate a
   fine-grained token.
2. **Repository access** → **Only select repositories** → choose the ones you
   want to watch.
3. **Repository permissions** → **Contents: Read-only**. That is the whole
   grant. GitHub adds **Metadata: Read** automatically, which is what lets the
   repository appear in a listing at all. Leave everything else alone.
4. In GitTimeline, go to **Connect GitHub** → *Your private repositories* →
   **Use a fine-grained token instead**, and paste it.
5. **Your repositories** now lists what that token can see, private ones
   marked `private`.

The same box exists in **Settings ▸ Large repositories ▸ GitHub token**, which
is where it used to live *only* — filed under a heading about rate limits, with
no mention of private access anywhere near it. That is why it could not be
found.

### Why "Contents", and nothing more

The app reads commits: messages, authors, dates, and the shape of the branches.
`Contents: Read-only` is the permission that covers the commit list. It does
**not** grant file contents to this app in any useful sense, because the app
never asks for a blob — there is no code path that fetches file bodies. Nothing
needs Issues, Pull requests, Actions, Secrets, or Administration, and granting
them widens what a leaked token would be worth for no benefit.

## 3. What happens to the credential

One signal, `store.token`, in this tab's memory. Every claim below is
enforced by code rather than by policy, and most of them are covered by a test
that inspects the browser rather than the source.

| | |
|---|---|
| **Persisted?** | No. The only thing written to `localStorage` is `gittimeline.settings.v1`, whose type has no token field. No `sessionStorage`, no service worker. |
| **Sent where?** | `api.github.com` only, as an `Authorization: Bearer` header. `parseRepoUrl` pins the host; the CSP `connect-src` allows that origin and this one. |
| **In a shared link?** | No. `buildShareHash` has no token key, and a share link is built from origin + pathname + hash. |
| **Logged?** | There is one `console.warn` in all of `src/`, and it carries a compile error. The sign-in Worker has `[observability] enabled = false` so that the OAuth code is not retained either. |
| **Rendered?** | No. `type="password"`, never seeded from the store, and cleared from component state the moment it is applied. |
| **In the URL?** | No. The control has no `<form>`, deliberately: a form containing a text input submits on Enter, and a default submission is a GET with the field's value in the query string. Enter is handled explicitly. |

### A private history is never written to disk

This is the part worth trusting least on assertion, so it is tested by reading
the browser's own storage after the fact (`tests/e2e/private.spec.ts`):

- `probeRepository` asks GitHub whether the repository is private on an
  explicitly **uncached** client, before anything else runs, and only hands a
  cache-enabled client to the commit calls once the answer is in.
- The ingest for a private repository runs with the cache disabled.
- `putDataset` and `touchRecent` are skipped, so it does not enter the dataset
  store or the recents list.
- The repository listing is fetched with `cache: null` — a list of somebody's
  private repository names is not something to leave in IndexedDB.
- If a repository you watched while it was public becomes private,
  `confirmStillPublic` notices on the next open and evicts it from the device.

The cache that *does* exist holds public GitHub responses so the same history
is not downloaded twice. Settings shows its size and clears it.

## 4. Revoking

Either of these is enough on its own, and they do different things:

- **Disconnect**, in the app — on the sign-in page, in Your repositories, or by
  clearing the Settings field. It drops the token *and* clears every history
  cached on this device, so "revoke" is a statement about this machine and not
  only about GitHub.
- **Delete the token at GitHub** —
  <https://github.com/settings/personal-access-tokens> for a fine-grained one,
  or <https://github.com/settings/applications> to revoke the OAuth
  authorization. This ends it everywhere, including on any machine you forgot
  about.

A fine-grained token also expires on its own, which the OAuth authorization
does not. Setting a short expiry is free and is the better default.

## 5. What is still not built

**The good version.** A small GitHub App, installed on exactly the
repositories you choose, granted read-only, revocable per repository from
GitHub's own interface, with no long-lived credential pasted anywhere. That is
what the "Not yet" on the sign-in page refers to, and it remains accurate.

The difference matters and is worth being straight about: a fine-grained token
is a secret you hold and paste, and pasting a secret into a web page is a thing
people are rightly taught not to do. This app can argue that it is safe here —
static site, no backend, memory only, and every claim above testable — but the
argument is still an argument. A GitHub App installation needs no such
argument, because there is nothing to paste.

Two things block it, neither of them code: a GitHub App has to be created by
the account owner through GitHub's interface, which has no API, and the
installation callback needs the same Worker the sign-in uses. `worker/README.md`
has the setup.

## 6. Where this lives in the code

| | |
|---|---|
| The control | `src/app/SignIn.tsx`, `PrivateTokenGrant` |
| Its tests | `tests/e2e/private-grant.spec.ts` — masking, no DOM leak, Enter does not navigate, nothing persisted, classic-token warning |
| The other box | `src/app/Panels.tsx`, `TokenField` |
| Where it is sent | `src/github/adapter.ts` |
| The listing | `src/github/repos.ts` |
| The write guards | `src/github/ingest.ts` (`probeRepository`), `src/app/controller.ts` (`confirmStillPublic`) |
| Not-on-disk test | `tests/e2e/private.spec.ts` |
| The sign-in Worker | `worker/src/index.mjs`, `worker/README.md` |
| What leaves the browser | `src/app/analytics.ts` — for a private history, the four words "a private repository" and nothing else |
