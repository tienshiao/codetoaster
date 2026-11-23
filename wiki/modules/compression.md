---
type: Module
title: Response and socket compression
description: API responses and the SPA's HTML above 1 KiB are compressed with br, zstd or gzip as Accept-Encoding allows, the terminal WebSocket negotiates permessage-deflate with a per-socket window and compresses every frame, and the bundled JS and CSS stay uncompressed because Bun's HTML import serves them itself.
tags: [api, websocket, perf, remote, bun]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-23T02:10:00Z }
sources:
  - id: compress
    resource: ../../src/api/compress.ts
    title: src/api/compress.ts
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

The `/*` catch-all fetches the HTML from Bun's hidden route with `Accept-Encoding: identity` and hands it to `serveSpa`. That drops the upstream `Content-Encoding` and `Content-Length`, sets `Cache-Control: no-cache`, `X-Frame-Options` and the `frame-ancestors` CSP, and runs the page through `compressResponse` under the same rule. The production page is 440 bytes, below the threshold, so in practice it goes out plain.[^spa]

# The terminal WebSocket

`perMessageDeflate` alone only negotiates the extension. Bun then sends every frame raw (RSV1 clear) unless that frame's `send` passes `compress: true`. So every server-side send goes through `sendFrame`, which always asks. On a socket that did not negotiate the extension, Bun ignores the request and the client gets plain text.[^socket]

The compressor is `"dedicated"`, not `"shared"`. A shared compressor resets its window on every message (`server_no_context_takeover`), and terminal output is many small frames that repeat each other. Fifty `ls` lines measured 5680 → 4880 bytes shared and 5680 → 586 dedicated. The cost is one deflate state per socket, and the daemon has a handful of browsers attached.[^socket]

# Costs accepted

- **Synchronous frame deflate.** Bun deflates a WebSocket frame on the event loop, once per attached socket, since each socket has its own window. A `restore` of a long scrollback is deflated inline on attach. It is native zlib on frames of tens of KB, and nothing measured it as a stall. If it ever shows up, the fix is a size cap on what `sendFrame` asks to compress.
- **Loopback clients compress too.** Compression is not skipped for a loopback peer, because `ssh -L` makes a remote browser's traffic arrive from loopback, and that is exactly the link compression is for. On the measuring server a local 1.25 MB file read took 7 to 15 ms compressed with any of the three codings. That is a rough reading, not a benchmark, but it is not a cost a local user would notice.
- **Memory per socket.** Every open socket, a hidden tab's included, holds a dedicated deflate state of a few hundred KB.

Two things are not fixed here and predate this change. The SPA catch-all never answers 304, because the browser's `If-None-Match` is not forwarded to the hidden route. And `serveSpa` copies every upstream header, `Date` included, minus the two it drops.[^spa]

# Bundled JS and CSS stay uncompressed

The hashed bundles (`/chunk-*.js`, `/chunk-*.css`) are served by Bun's HTML import from its own static routes. Those routes take precedence over `/*` and never reach a handler of ours, and Bun does not compress them. In production on Bun 1.4.4, with `Accept-Encoding: gzip, deflate, br, zstd`, the JS came back at 5,030,224 bytes (1,408,191 gzipped) and the CSS at 167,548 bytes, neither with a `Content-Encoding`.[^task-147]

They are left that way for now. Each bundle is content-hashed and sent with `Cache-Control: public, max-age=31536000, immutable`, so a browser fetches it once per release, not once per page load. Compressing them would mean either building the frontend ahead of time and serving precompressed files from our own routes, which replaces the HTML import, or rewriting the HTML to point at a proxy route. A remote user who wants them compressed today can front the daemon with a reverse proxy that compresses by default, such as Caddy, or tunnel it with `ssh -C`.[^task-147]

# Measured

On an isolated production server, as bytes on the wire:[^task-147]

| Payload | Before | After |
| --- | --- | --- |
| Large diff (`git/commit` of a 67-file commit) | 177,068 | gzip 42,735 · br 39,596 · zstd 44,712 |
| File read (`file?file=src/lib/tasks/manager.ts`) | 1,248,901 | gzip 187,319 · br 123,562 · zstd 153,832 |
| Terminal `restore` frame | 54,519 | 17,378 (permessage-deflate) |

[^compress]: src/api/compress.ts
[^spa]: src/api/spa.ts
[^socket]: src/lib/xtmux/socket.ts
[^server]: src/server.ts
[^task-147]: TASK-147 Compress HTTP responses and WebSocket traffic for remote use
