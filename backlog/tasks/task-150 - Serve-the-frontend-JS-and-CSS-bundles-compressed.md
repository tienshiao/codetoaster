---
id: TASK-150
title: Serve the frontend JS and CSS bundles compressed
status: To Do
assignee: []
created_date: '2026-11-23T03:30:00Z'
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
