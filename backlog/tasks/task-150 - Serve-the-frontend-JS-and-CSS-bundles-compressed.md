---
id: TASK-150
title: Serve the frontend JS and CSS bundles compressed
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-23T03:30:00Z'
updated_date: '2026-11-23T04:06:00Z'
labels:
  - backend
  - perf
dependencies: []
references:
  - wiki/modules/compression.md
  - src/server.ts
ordinal: 153000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-147 compressed API responses, the SPA HTML and terminal frames, but not the bundled assets. Bun HTML import serves /chunk-*.js and /chunk-*.css from its own routes, matched ahead of our /* catch-all, and does not compress them, so they never pass through compressRoutes. They are the largest download on a remote link: the production JS bundle is 5,030,224 bytes (1,408,191 gzipped) and the CSS 167,548, sent raw even when the browser offers gzip, br and zstd. They are content-hashed and cached immutable for a year, so the cost is paid once per release per browser, but a first load or a load after an upgrade over a slow remote link is still slow. Options recorded in wiki/modules/compression.md: build the frontend ahead of time and serve precompressed files from our own routes, or rewrite the HTML to point at a route we control. Workaround until then: a fronting proxy such as Caddy, or ssh -C.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 In production, the JS and CSS bundles are sent with a Content-Encoding the request accepts (at least gzip; br or zstd when offered) and Vary: Accept-Encoding, and decode to the same bytes
- [ ] #2 A request that accepts no encoding gets the bundles uncompressed
- [ ] #3 Bundles keep their content-hashed URLs and long-lived immutable caching
- [ ] #4 Compression of the bundles happens once per build or per process start, not per request
- [ ] #5 Development mode with HMR still works
- [ ] #6 The standalone binary built by bun run build:server serves the bundles compressed too
- [ ] #7 Route-level tests through a real Bun.serve cover a compressed bundle decoding to the same body and the uncompressed fallback; the wiki compression page is updated; bytes on the wire before and after are recorded in the task notes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Probes (Bun 1.4.4): (1) HTMLBundle has no manifest when run from source (Object.keys(index) is empty); a --compile build does expose index.files with /$bunfs paths, so one code path that reads the HTML covers both. (2) Shadowing Bun's /chunk-* static route does not stick: a route declared at serve() loses to the bundle's, and one added by server.reload wins only until the next request to the HTML route re-registers the bundle's routes; every / navigation fetches that route, so no. (3) Production bundle is one JS + one CSS, no code splitting (0 dynamic import()), no source maps, no wasm/worker URLs; the CSS refers to its fonts absolutely (url(/Name-hash.woff2)), so rewriting only the HTML catches everything and fonts stay on Bun's routes (woff2 is already brotli inside). Binary: same chunk-<hash> names, but Bun sends no Cache-Control there and an unquoted ETag. Plan: new src/api/bundles.ts with BundleCache: serveSpa (prod only, explicit flag from server.ts) rewrites src/href="/chunk-<hash>.(js|css)" to /_bundle/chunk-<hash>.ext and teaches the cache that exact set (replacing it and evicting dropped entries). GET/HEAD /_bundle/:name serves only names in that set, fetched from Bun's own route via the listener (Accept-Encoding identity), accepting only a 200 JS/CSS; per name one shared identity promise and per encoding one shared encode promise, deleted on failure. Negotiation, encoders and Vary from compress.ts. Lazy per encoding (measured 5 MB JS: br5 85ms, gzip6 56ms, zstd3 16ms) rather than eager at startup, which would force Bun's lazy bundle build at boot and encode codings nobody asks for. Unknown set after restart: one shared HTML refetch before deciding. Route composition moves to spaRoutes() in spa.ts so tests mount it with a fixture HTML import. Tests, wiki, verify on 4604 and the binary on 4605.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Approach: rewrite, not shadow (probe 2 fails) and not ahead-of-time build. src/api/bundles.ts BundleCache + spaRoutes() in spa.ts (route composition moved out of server.ts so tests mount it over a fixture HTML import). serveSpa in production rewrites src/href="/chunk-<hash>.(js|css)" to /_bundle/<name> and teaches the cache that exact set; /_bundle/:name (GET/HEAD) serves only those names, fetched once from Bun's own route through the listener, encoded lazily once per coding with one shared promise per name and per coding; failures (non-200, non-JS/CSS type, thrown fetch, encoder error) are not kept. Cache-Control immutable is always sent (name pattern is content-hashed); the binary's Bun route sends none, so this adds it there. Bare ETag from the binary is quoted, weakened when encoded. Dev: rewrite gated on NODE_ENV=production (same as HMR); /_bundle/* answers 404 there; dev HTML still references /_bun/client and /_bun/asset (checked on an isolated dev server on 4606, client script 200).

Measured, isolated production server (NODE_ENV=production bun src/index.ts, port 4604), bytes on the wire. JS chunk-8tyy23w4.js: before 5,033,255 raw from Bun's route even with Accept-Encoding gzip, br; after br 1,238,107 (first request 88ms), gzip 1,431,890 (115ms), zstd 1,386,991 (26ms), repeat br 2ms from cache; none/identity 5,033,255. CSS chunk-1wjx46qn.css: before 168,188; after br 62,002, gzip 65,115, zstd 64,958. Every encoded body decoded byte-identical to the identity response and to Bun's original; headers Content-Encoding, Vary: Accept-Encoding, Content-Type kept, Cache-Control public, max-age=31536000, immutable, ETag W/ when encoded, Content-Length the encoded one; HEAD gives headers only. /chunk-deadbeef.js, /_bundle/chunk-deadbeef.js and /_bundle/..%2Fapi%2Fping all 404. Binary (bun run build:server, foreground --port 4605): JS 5,062,139 -> br 1,245,976 / gzip 1,438,233 / zstd 1,391,666, CSS 166,784 -> br 61,887; all decode equal; Cache-Control immutable now present (Bun's binary route sends none). Encoder timings on the 5 MB JS (standalone): br5 85ms 1,238,107; br9 278ms 1,195,482; br11 7.4s 1,079,542; gzip6 56ms; zstd3 16ms; zstd19 995ms. Kept compress.ts levels: lazy first-load cost stays under ~120ms.

Probe findings recorded in the plan. Not covered: no 304 for If-None-Match on /_bundle (immutable caching makes revalidation rare; the HTML catch-all never answered 304 either). Bun's original /chunk-* paths still answer uncompressed for anything that asks for them directly. If Bun ever emits code-split chunks referenced relatively from inside a bundle, or relative CSS url()s, those would resolve under /_bundle/ and 404; today there are none.

Review (/code-review high v2 on 54b7487): no blocking bugs; four nits, all fixed. (1) /_bundle answered 200 to a revalidation where Bun's route gave 304: now weak If-None-Match comparison returns 304 with ETag, Cache-Control, Vary. (2) knownNames could wedge if fetchHtml threw synchronously (finally ran before ??= assigned): now started a tick late and cleared from the stored promise; test added. (3) Wiki wrongly said no dynamic import(: the frontend's import("mermaid") exists and Bun inlines it; wiki corrected, and the fixture now has a dynamic import with a test that fails if Bun starts splitting it (a relatively loaded split chunk would 404 under /_bundle/). (4) The rewritten page kept Bun's strong ETag for the unrewritten bytes: now suffixed -bundled. Reviewer also confirmed the compiled binary defines NODE_ENV=production and HEAD keeps the set Content-Length. Tests: typecheck clean; test:unit 2258 pass, 1 fail = the known TASK-151 flake (manager.test.ts 'an exiting terminal marks the task exited and sends the row'); test:render 629/629.
<!-- SECTION:NOTES:END -->
