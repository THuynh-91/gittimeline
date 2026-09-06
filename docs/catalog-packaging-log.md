# Catalog packaging — run log

A record of package builds run by hand, so the next person knows what is in
`.catalog-release` and does not rebuild it for nothing. Packaging is expensive
and its output is content-addressed, so knowing it already exists is worth
writing down.

---

## 2026-09-06 — Linux and Chromium

Run at the user's request, against the plans Codex had already compiled and
round-trip verified. The other ten entries were packaged in the same session
that produced those plans; these two were the outstanding work named in the
resume checkpoint in `TASKS.md`.

```
node --max-old-space-size=4096 scripts/package-catalog.mjs \
  torvalds/linux chromium/chromium \
  --catalog .catalog-build --out .catalog-release
```

**Inputs, verified present before the run:**
`.catalog-build/torvalds-linux.gtperf.gz`, `.catalog-build/chromium-chromium.gtperf.gz`.

**Sizes going in, for context:**

| | Pages artifact | R2 release staging |
| --- | ---: | ---: |
| before the move | 401 MB | — |
| after the move, without these two | 32 MB | 855 MB |

The Pages artifact is 97% soundtrack: `music/` is 31 MB of the 32, `assets/`
is 384 KB, `index.html` is 4 KB. Against the 1 GB Pages ceiling that is about
3%, so the ceiling has stopped being a design constraint — the binding limits
are now R2 storage (10 GB free tier, ~6x headroom) and R2 class-B reads, which
scale with *page count* rather than bytes.

Log at `x/pack-linux-chromium.log`. These two are the largest entries by a wide
margin — 662 MB and 311 MB as raw artifacts — so expect the staged release to
land somewhere in the 1.3–1.7 GB range.

**Nothing was published.** This writes local files only. Uploading is
`scripts/publish-catalog.mjs`, and deployment approval had not been given.

---

## What packaging buys, measured

Click to first frame, on the Pages build, before any of this:

| entry | | |
| --- | ---: | --- |
| mdBook | 205 ms | packaged |
| React | 227 ms | packaged |
| CPython | 1,461 ms | not packaged |
| Kubernetes | 6,308 ms | not packaged |
| Linux | 22,105 ms | not packaged |

The packaged entries open in about a fifth of a second because the worker
fetches one window and starts; the rest arrives underneath. Codex measured
Kubernetes on the R2 preview at **827 ms** with all 77 catalog responses a
cache hit, which is the same property surviving the move to a different origin.

That is why Linux and Chromium were worth packaging: they are the two entries
where the monolithic path is worst, and they were the two still missing it.
