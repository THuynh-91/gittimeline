# GitDance catalog hosting

## Provisioned 2026-09-06

- Existing Cloudflare account, existing `cruxpack.io` zone.
- New, separate R2 bucket: `gitdance-catalog`, Standard storage, ENAM.
- Public custom domain: `https://gitdance-data.cruxpack.io`, minimum TLS 1.2.
- No Worker, new domain purchase, or changes to the existing backup bucket.
- Read-only CORS methods: GET and HEAD. Range headers are allowed.
- Allowed origins: `https://thuynh-91.github.io`, and localhost/127.0.0.1 on
  ports 5173 and 4173. CORS is a browser policy, not access control: objects
  in this bucket are public. Never upload private repository data or credentials.
- Connectivity fixtures: `health/setup-v1.json` and gzip-encoded
  `health/transport-v1.bin`. Both are immutable test objects, not catalog indexes.

## Verification

Run without credentials:

```sh
node scripts/check-catalog-host.mjs
```

This checks public HTTPS, response content, GET/HEAD CORS, a Range preflight,
and absence of a CORS grant to an unlisted origin. It reports cache status,
but passing this test does not certify playback or CDN caching.

## CDN caching: configured and verified

After the user updated the setup token's permissions, cache-rule access succeeded.
A new rule was created in the previously empty cache phase. JSON and compressed
binary fixtures return `CF-Cache-Status: HIT`, with correct CORS. No existing
Cruxpack cache rules were replaced.

The rule is restricted to:

```text
http.host eq "gitdance-data.cruxpack.io"
```

Matching files are eligible for caching; their origin cache-control headers are
respected. Uploaded release objects use `public, max-age=31536000, immutable`.
Never replace objects at an existing immutable URL. Recheck JSON and binary
playback resources for cache HIT and correct CORS after changing this rule.

Reference: https://developers.cloudflare.com/cache/how-to/cache-rules/create-api/

## Outstanding: catalog publication and app integration

The app now supports `VITE_CATALOG_BASE`, a public HTTPS URL to an immutable
catalog directory. Without it, local-catalog behavior is preserved. With it, the
production build excludes `public/catalog` entirely and explicitly permits the
catalog origin in CSP. Compiled pages are mandatory for the external catalog:
missing packages never trigger giant browser compilations.

A project-base-path production build measured **32,520,302 bytes** (about 32.5 MB),
including local music, with no `dist/catalog`. This is a local build measurement,
not a claim about the currently deployed GitHub Pages site.

A real mdBook preview was uploaded under `previews/` and tested with the production
app assets routed under the actual Pages origin. R2 requests were not mocked.
Observed on this machine/network: 1,904 ms to playback, 155,023 response-content
bytes by startup, and seeks in 250-1,267 ms. No GitHub API calls or monolithic
history downloads occurred. These are not throttled-network or Linux benchmarks.

All 12 histories have been rebuilt and round-trip verified in `.catalog-build`.
Packaging uses `.catalog-release`, keeping existing local catalog files intact.
Live GitHub Pages has NOT been promoted to R2 yet.

Kubernetes also passed the real-network browser test: 1,945 ms to playback,
409,178 response-content bytes by startup, and three seeks in 1,131–1,874 ms.
The test checks actual drawn geometry, advancing playback, stable plan identity,
and absence of console errors, GitHub API requests, and monolithic downloads.

Next implementation steps:

1. Confirm all 12 packages are present and validate the complete shelf.
2. Stage only validated, manifest-reachable playback resources under immutable
   release paths. Check engine compatibility, hashes, and complete dependencies.
3. Upload the release, test real playback and seeking from the Pages origin,
   then publish the listing pointing at the completed release.
4. Set the repository's `VITE_CATALOG_BASE` variable to the tested full release
   and deploy the updated code. The workflow skips catalog artifact downloads in
   remote mode, checks engine compatibility, and guards the decimal 1 GB limit.
5. Keep an explicit retention policy and monitor account-wide R2 usage, including
   the existing project. The free allowance is not a spending cap.

## Publishing commands

```sh
node --max-old-space-size=12288 scripts/build-performance.mjs --all --out .catalog-build
node --max-old-space-size=4096 scripts/package-catalog.mjs owner/repo --catalog .catalog-build --out .catalog-release
node scripts/publish-catalog.mjs --packages .catalog-release
node scripts/publish-catalog.mjs --packages .catalog-release --upload
```

Create the build directory first. Package every catalog entry, not just the example.
The publisher validates all listed entries before uploading anything and prints
the immutable release URL. Raw datasets, monolithic plans, and stale/unreferenced
pages are excluded. The index is uploaded last. The `--smoke-repo owner/repo`
option creates a separate `previews/` shelf which the deployment gate rejects.

For repeat publication, `.github/workflows/catalog-publish.yml` accepts a completed
datasets workflow run and uses bucket-scoped `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY` repository secrets plus `CLOUDFLARE_ACCOUNT_ID` as a variable.
It deliberately does not promote a release automatically.

The datasets workflow now packages small entries too: a remote release cannot
depend on monolithic fallback files. Publication is retryable; conditional object
creation refuses to overwrite immutable content and verifies matching existing
objects before skipping them.

For rollback, restore `VITE_CATALOG_BASE` to the previous compatible release and
redeploy its matching app revision. Retain the active and previous releases;
review older releases and test previews manually before removing any objects.
Do not add an age-based bucket expiration rule that could delete an active release.

Public verification: `node scripts/check-catalog-host.mjs`.
Browser verification: serve the external-catalog production build on port 4175,
then run `node scripts/check-catalog-playback.mjs owner/repo`. Only the app assets
are locally substituted under the Pages origin; the catalog is fetched from R2.

## Credentials

The temporary setup token was not saved in project files or CI. Revoke the
chat-exposed token after setup verification. A separate account token named
`GitDance catalog publisher (GitHub Actions)` was created with object-write
permission restricted to `gitdance-catalog`. Its derived S3 credentials are
installed as the two repository secrets above, and the account ID is installed
as a repository variable. These CI credentials have not yet run in Actions.
Visitors never receive an upload credential.
Do not place tokens in any `VITE_*` variable, which is public build configuration.

Revoking the setup token does not disable the public bucket or custom domain.

## Resume checkpoint — user requested a usage-saving stop

- All 12 `.catalog-build/*.perf.json` sidecars exist: compilation and round-trip
  verification finished. Do **not** rebuild them unless the engine changes.
- Linux verified 129,358,610 geometry values; Chromium verified 136,710.
- The final packaging command is Linux then Chromium, using the existing plans:
  `node --max-old-space-size=4096 scripts/package-catalog.mjs torvalds/linux chromium/chromium --catalog .catalog-build --out .catalog-release`.
- Only mdBook and Kubernetes previews are uploaded; a complete release is not.
- Preview URLs:
  - mdBook: `https://gitdance-data.cruxpack.io/previews/ec518f044beb88b35260b7246b011b327f4be555d9019fbcffd61d427f8789ba/`
  - Kubernetes: `https://gitdance-data.cruxpack.io/previews/e3263918d9db1480a91c86675e90973e4c5f60a05c1dbdee73d483ef88de5017/`
- Latest cached Kubernetes test: 827 ms startup, 409,178 bytes by startup,
  seeks 343–476 ms, all 77 catalog responses cache HIT. Unthrottled local network.
- `dist-r2-test` is a production build against the Kubernetes preview:
  32,520,159 bytes, no catalog directory. It is **not** the live Pages deployment.
- Unit tests: 174 passed, 1 skipped. Publisher tests: 7 passed. Typecheck/lint passed.
- Changes are uncommitted. Preserve unrelated user files and existing local commits.
  Publishing the current branch also publishes existing unpushed UI/layout work;
  deployment approval was asked for but has not been received.
- Next: dry-run `node scripts/publish-catalog.mjs --packages .catalog-release`,
  upload the full release, build with its printed `VITE_CATALOG_BASE`, then browser
  test Linux/Chromium plus other entries and run the remote deployment gate.
- Do not set the GitHub `VITE_CATALOG_BASE` variable to a preview. It is currently
  unset. The broad setup token is not stored here; CI already has independent,
  bucket-scoped upload credentials. Rotate the chat-exposed setup token.
