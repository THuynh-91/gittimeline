Idea

A frontend-first website where a user pastes a GitHub repository and watches its development history play out visually over time.

The visualization should show the real parallel work and chaos of a repository:

commits appearing over time

branches splitting and merging

multiple contributors working at once

activity speeding up during busy periods

dramatic zoom-ins and zoom-outs

a timeline along the bottom

major releases or milestones appearing during playback

The goal is for the animation to feel cinematic without inventing activity that did not actually happen.

Public Repositories

Public repositories should work by pasting a GitHub URL.

Example:

github.com/torvalds/linux

The frontend fetches the repository history from GitHub and builds the visualization in the browser.

No traditional backend should be required for normal public-repo visualization.

GitHub Sign-In

Users should be able to connect GitHub so the app can use their authenticated GitHub API allowance instead of relying only on unauthenticated requests.

This also enables private repository support.

For private repositories, use a GitHub App with read-only permissions and allow users to authorize only the repositories they want the visualizer to access.

Private Repositories

Private repo data should stay between the user's browser and GitHub.

The actual repository data should:

be fetched directly from GitHub

be processed locally in the browser

never be uploaded to our servers

never be stored by us

A tiny serverless auth function may be needed for the GitHub authentication/token exchange.

This is not a traditional backend and does not need something like a full Render server.

Suggested privacy copy:

Private by design.
Repository data is fetched directly from GitHub and processed locally in your browser. We do not upload, process, or retain your source code on our servers. For private repositories, you choose which repositories to authorize and access is read-only.

Short version:

We only read what you authorize. Your repository data stays in your browser.

Hosting

Frontend

Host the frontend on GitHub Pages.

It contains:

the website

the visualization engine

repo processing

animation logic

local caching

Google Analytics

preloaded repository datasets

Private Repo Authentication

Use a tiny serverless function only for GitHub authentication.

Possible options:

Cloudflare Worker

Vercel Function

Netlify Function

It should only handle authentication/token exchange.

It should not receive or process repository contents.

Render

A traditional Render backend should not be necessary for the initial version.

Only introduce a larger backend later if the project eventually needs something that genuinely cannot stay client-side.

Preloaded Large Repositories

Some famous repositories should be pre-mapped ahead of time so users can load them instantly without burning through thousands of GitHub API requests.

These datasets can be generated periodically with GitHub Actions and shipped as static files with the frontend.

Good showcase repos:

torvalds/linux

chromium/chromium

llvm/llvm-project

kubernetes/kubernetes

python/cpython

rust-lang/rust

microsoft/vscode

tensorflow/tensorflow

facebook/react

nodejs/node

Linux should probably be one of the flagship demos.

Flow:

GitHub Action
    ↓
clone / update repo
    ↓
extract commit history
    ↓
build optimized dataset
    ↓
ship with GitHub Pages

Then:

User opens Linux
    ↓
load precomputed dataset
    ↓
animation starts

No GitHub API requests are needed for that playback.

Visualization Feel

The visualization should accurately show parallel development.

Important visual ideas we discussed:

timeline at the bottom

activity-driven animation speed

quiet periods feel slower

busy periods feel intense

strong zoom-outs when the repo becomes chaotic

zoom-ins on major areas or events

branches and merges should be visually obvious

major releases can appear as dramatic timeline events

the animation should scale with how active the repository actually was

The main objective is to make someone look at a large repo and think:

"That's what building this actually looked like."

Analytics

Add Google Analytics to the frontend.

Use it to monitor things like:

visitors

page views

which showcase repos are opened

how often visualizations are started

Do not send private repository names, source code, commit contents, or other private repository information into analytics.

Support Button

Add a small, unobtrusive support button.

Possible text:

❤️ Support this project

or:

☕ Like the project? Help keep it running.

GitHub Sponsors would fit well because the project is open source.

Core functionality should stay free.