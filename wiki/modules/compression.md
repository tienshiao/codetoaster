---
type: Module
title: Response and socket compression
description: API responses and the SPA's HTML above 1 KiB are compressed with br, zstd or gzip as Accept-Encoding allows, the bundled JS and CSS are served compressed from a route the rewritten page points at, encoded once per coding and cached, and the terminal WebSocket negotiates permessage-deflate with a per-socket window and compresses every frame.
tags: [api, websocket, perf, remote, bun]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-23T04:10:00Z }
sources:
  - id: compress
    resource: ../../src/api/compress.ts
    title: src/api/compress.ts
  - id: bundles
    resource: ../../src/api/bundles.ts
    title: src/api/bundles.ts
  - id: spa
    resource: ../../src/api/spa.ts
    title: src/api/spa.ts
  - id: socket
    resource: ../../src/lib/xtmux/socket.ts
    title: src/lib/xtmux/socket.ts
  - id: server
    resource: ../../src/server.ts
    title: src/server.ts
  - id: task-147
    resource: "../../backlog/tasks/task-147 - Compress-HTTP-responses-and-WebSocket-traffic-for-remote-use.md"
    title: "TASK-147 — Compress HTTP responses and WebSocket traffic for remote use"
  - id: task-150
    resource: "../../backlog/tasks/task-150 - Serve-the-frontend-JS-and-CSS-bundles-compressed.md"
    title: "TASK-150 — Serve the frontend JS and CSS bundles compressed"
---

# Why

`Bun.serve` compresses nothing on its own. On localhost that is free, but a daemon used over a remote link sent every diff, file read, git log page and terminal frame raw, and those are repetitive text that shrinks several times over.[^task-147]

# HTTP responses

`compressResponse(req, res)` decides for one response; `compressRoutes` applies it to a route table the way `guardApiRoutes` applies the origin check, so a route added to the table is compressed by construction. It wraps the guarded table from outside, so the guard runs first and a 403 passes through as the small response it is. The standalone `/api/tasks/:id/preview` and `/api/connections` routes are wrapped with `compressRoute`.[^server]

The rules:[^compress]

- **Negotiation.** An absent header, `identity`, or `*;q=0` means uncompressed. `q=0` refuses a coding, `*` stands for any coding not named, and at equal weight a named coding beats a wildcarded one. Ties then go br, zstd, gzip, smallest first. A browser offers br and zstd only over HTTPS, so a daemon reached over plain http answers with gzip.
- **Threshold.** Bodies under 1 KiB go out as they are, with no `Vary`. Above it the answer carries `Vary: Accept-Encoding`, appended to any existing `Vary`, whether or not it is compressed.
- **Types.** An allowlist of text: `text/*` except `text/event-stream`, JSON, `+json`, JavaScript, XML and `+xml`. NDJSON is left off because it is the other format a route would stream in. Every `image/*` is left alone, SVG included, so the image routes' bytes are never recompressed.
- **Left alone.** HEAD, 1xx/204/304, 206 or a `Content-Range`, a null body, a body that already has `Content-Encoding`, and `Cache-Control: no-transform`.
- **Headers.** The stale `Content-Length` is dropped and Bun writes the encoded one. A strong `ETag` is weakened to `W/`, since the encoded bytes differ from the identity bytes.
- **Encoders.** All asynchronous, off the event loop that pumps terminal output: `Bun.zstdCompress` level 3, `node:zlib` brotli quality 5 and gzip level 6. If an encoder fails, or its output is no smaller, the identity body goes out.

## Streams must opt out

A response that qualifies is read whole before it is compressed. Bun gives every `Response` a `ReadableStream` body and no `Content-Length`, so a buffered JSON answer and a live stream look the same to the wrapper. No API route streams today. One that does must send `text/event-stream` or `Cache-Control: no-transform`, or the wrapper will hold its first byte until the stream ends.[^compress]

# The SPA's HTML

The `/*` catch-all fetches the HTML from Bun's hidden route with `Accept-Encoding: identity` and hands it to `serveSpa`. That drops the upstream `Content-Encoding` and `Content-Length`, sets `Cache-Control: no-cache`, `X-Frame-Options` and the `frame-ancestors` CSP, in production rewrites the bundle references (see Bundled JS and CSS below), and runs the page through `compressResponse` under the same rule. The production page is 440 bytes, below the threshold, so in practice it goes out plain.[^spa]

# The terminal WebSocket

`perMessageDeflate` alone only negotiates the extension. Bun then sends every frame raw (RSV1 clear) unless that frame's `send` passes `compress: true`. So every server-side send goes through `sendFrame`, which always asks. On a socket that did not negotiate the extension, Bun ignores the request and the client gets plain text.[^socket]

The compressor is `"dedicated"`, not `"shared"`. A shared compressor resets its window on every message (`server_no_context_takeover`), and terminal output is many small frames that repeat each other. Fifty `ls` lines measured 5680 → 4880 bytes shared and 5680 → 586 dedicated. The cost is one deflate state per socket, and the daemon has a handful of browsers attached.[^socket]

# Costs accepted

- **Synchronous frame deflate.** Bun deflates a WebSocket frame on the event loop, once per attached socket, since each socket has its own window. A `restore` of a long scrollback is deflated inline on attach. It is native zlib on frames of tens of KB, and nothing measured it as a stall. If it ever shows up, the fix is a size cap on what `sendFrame` asks to compress.
- **Loopback clients compress too.** Compression is not skipped for a loopback peer, because `ssh -L` makes a remote browser's traffic arrive from loopback, and that is exactly the link compression is for. On the measuring server a local 1.25 MB file read took 7 to 15 ms compressed with any of the three codings. That is a rough reading, not a benchmark, but it is not a cost a local user would notice.
- **Memory per socket.** Every open socket, a hidden tab's included, holds a dedicated deflate state of a few hundred KB.

Two things are not fixed here and predate this change. The SPA catch-all never answers 304, because the browser's `If-None-Match` is not forwarded to the hidden route. And `serveSpa` copies every upstream header, `Date` included, minus the two it drops.[^spa]

# Bundled JS and CSS

Bun's HTML import serves the hashed bundles (`/chunk-<hash>.js`, `/chunk-<hash>.css`) from static routes of its own and does not compress them. A route of ours cannot take those paths over. On Bun 1.4.4, one declared at `serve()` loses to the bundle's. One added with `server.reload` wins only until the next request to the HTML route registers the bundle's routes again, and every navigation makes that request. Bun exposes no asset list either: the HTML import object is empty when run from source, and only a `--compile` build carries `files`.[^task-150]

So in production `serveSpa` rewrites the page instead. It points each `src` or `href` of the form `/chunk-<hash>.(js|css)` at `/_bundle/<same name>` and tells `BundleCache` which names the page named. The `/_bundle/:name` route serves only those names.[^bundles] For each name:

- **Fetch once.** Bun's own route is fetched once, through the listener with `Accept-Encoding: identity`, and kept only if it is a 200 with a JS or CSS type. A 404, an error or an HTML fallback is answered as 404 and dropped, so the next request asks again.
- **Encode once per coding.** Each coding is encoded once, on the first request that asks for it. One shared promise per name and per coding means concurrent first loads fetch and encode once.
- **Negotiation and encoders.** These are `compress.ts`'s: the same q-value rules and levels, the same 1 KiB threshold, `Vary: Accept-Encoding`, and identity when the encoder fails or the result is no smaller.
- **Headers.** `Content-Type` and `ETag` are Bun's. The ETag is quoted when Bun sends a bare token, as the compiled binary does, and weakened when encoded. `Cache-Control: public, max-age=31536000, immutable` is always sent, because the name pattern is content-hashed by construction. The compiled binary's own route sends no `Cache-Control` at all. An `If-None-Match` that matches the tag by weak comparison gets a 304, as it did from Bun's route. The rewritten page itself no longer carries Bun's tag, which describes the unrewritten bytes: a quoted tag gains a `-bundled` suffix and a bare one is dropped.
- **GET and HEAD only.** It sits outside `guardApiRoutes` like the page itself, since a `<script>` load carries no Origin. Anything that is not a single `chunk-<hash>.(js|css)` segment the page named is a 404 that never reaches the self-fetch. Bun's original paths keep answering, uncompressed, and an unknown hash under either path is a 404, so a stale page still fails fast.

The names are learned from the page, so the cache is bounded by it. Each read of the HTML replaces the set and evicts what it no longer names. In production the set is fixed for the life of the process: one JS and one CSS file, as identity bytes plus each coding asked for. A browser that kept the page across a daemon restart asks for a bundle before this process has served any HTML. The first such request reads the HTML once, shared, before deciding. An error page never teaches the set.[^bundles]

Encoding is lazy, not done at startup. Bun builds the bundle on the first request to the HTML route, so encoding at boot would force that build before anyone opens the page, and it would encode three codings when a browser only ever asks for one. On the 5 MB JS, the first request for a coding pays br 85 ms, gzip 56 ms or zstd 16 ms once. That is small next to the 3.8 MB it saves on a first load. Brotli 11 would save another 13% but takes 7.4 s, too long for the first load to wait on.[^task-150]

Nothing inside the bundles needs rewriting. The production build is one JS and one CSS file, with no source maps and no wasm or worker URLs. There is no code splitting: the frontend's one dynamic import, `import("mermaid")` in `MermaidDiagram.tsx`, is inlined into the main bundle by Bun's HTML import. The CSS names its fonts by absolute path (`url(/Name-hash.woff2)`), so they still resolve to Bun's routes from a stylesheet served under `/_bundle/`. They stay there: woff2 is already brotli inside.[^bundles]

Two ways a future Bun could break this differ in how they fail. If the page's own references take another shape, the regex does not match, the page goes out unrewritten, and the bundles fall back to Bun's routes, uncompressed. If Bun began splitting a dynamic import into a chunk the main bundle loads by relative path, that path would resolve under `/_bundle/`, which serves only the names the page lists, and the lazy chunk would 404. `bundles.test.ts` guards the second case: its fixture has a dynamic import, and the test fails if the build stops inlining it.[^bundles]

Development is untouched. The rewrite is gated on the same `NODE_ENV === "production"` condition that turns HMR off, and Bun's dev server names its assets under `/_bun/` and rehashes them on every edit, which a cache keyed by name would hoard. There `/_bundle/:name` answers 404.[^spa]

# Measured

On an isolated production server, as bytes on the wire:[^task-147]

| Payload | Before | After |
| --- | --- | --- |
| Large diff (`git/commit` of a 67-file commit) | 177,068 | gzip 42,735 · br 39,596 · zstd 44,712 |
| File read (`file?file=src/lib/tasks/manager.ts`) | 1,248,901 | gzip 187,319 · br 123,562 · zstd 153,832 |
| Terminal `restore` frame | 54,519 | 17,378 (permessage-deflate) |
| JS bundle (TASK-150) | 5,033,255 | gzip 1,431,890 · br 1,238,107 · zstd 1,386,991 |
| CSS bundle (TASK-150) | 168,188 | gzip 65,115 · br 62,002 · zstd 64,958 |

[^compress]: src/api/compress.ts
[^bundles]: src/api/bundles.ts
[^spa]: src/api/spa.ts
[^socket]: src/lib/xtmux/socket.ts
[^server]: src/server.ts
[^task-147]: TASK-147 Compress HTTP responses and WebSocket traffic for remote use
[^task-150]: TASK-150 Serve the frontend JS and CSS bundles compressed
