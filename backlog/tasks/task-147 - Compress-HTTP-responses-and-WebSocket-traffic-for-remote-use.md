---
id: TASK-147
title: Compress HTTP responses and WebSocket traffic for remote use
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-23T01:41:00Z'
updated_date: '2026-11-23T02:17:00Z'
labels:
  - backend
  - perf
dependencies: []
ordinal: 150000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Nothing the daemon sends is compressed. Bun.serve does not compress responses by itself, no route sets Content-Encoding, and the websocket block in src/server.ts does not enable perMessageDeflate, which Bun leaves off unless asked. On localhost that costs nothing, but over a remote link (the daemon used away from the machine it runs on) every terminal frame, restore snapshot, diff, file read, syntax-highlight response and git log page goes over the wire raw. Terminal output and those JSON payloads are highly repetitive text, so they would shrink several times over. The bundled JS and CSS are served by Bun's HTML import directly, not through our handlers, so they need a different approach from the API (precompressed build output or a fronting proxy). Deciding which, or recording that they stay uncompressed, is part of this task. Workaround until then: ssh -C, or a reverse proxy such as Caddy that compresses by default.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The terminal WebSocket negotiates permessage-deflate with a browser that offers it, and still works with a client that does not
- [ ] #2 API responses above a size threshold are compressed with an encoding the request's Accept-Encoding allows, carry Content-Encoding and Vary: Accept-Encoding, and go out uncompressed when the client accepts none
- [ ] #3 Small responses, already-compressed bodies (images from the image routes, uploads) and error responses below the threshold are sent as-is
- [ ] #4 The SPA HTML served by the catch-all route is compressed under the same rule without losing its Cache-Control, X-Frame-Options and CSP headers
- [ ] #5 The bundled JS and CSS assets are either served compressed in production or the reason they are not is recorded in the task notes and the wiki
- [ ] #6 Route-level tests through a real Bun.serve on port 0 cover a compressed response decoding to the same body, Accept-Encoding absent or identity giving an uncompressed one, and a small response passing through untouched
- [ ] #7 Measured on an isolated server: bytes on the wire before and after for a large diff, a file read and a terminal restore, recorded in the task notes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. WebSocket: perMessageDeflate with a dedicated (context-takeover) compressor, exported from a shared module server.ts and the test both use; every ws.send site passes compress=true through one helper (Bun negotiates but sends RSV1=0 otherwise - probed). 2. HTTP: new src/api/compress.ts - negotiate Accept-Encoding (zstd/br/gzip, q-values, absent/identity/*;q=0 -> none), compress async (Bun.zstdCompress, node:zlib br/gzip) above 1 KiB for an allowlist of text types; skip HEAD/204/304/206/null body/existing Content-Encoding/event-stream/no-transform; drop Content-Length, append Vary, weaken a strong ETag. compressRoutes() walks a route table like guardApiRoutes and is applied outside the guard (origin.ts untouched), plus the standalone guardRoute routes. 3. SPA catch-all: buffer its own HTML and run it through the same function, keeping Cache-Control/X-Frame-Options/CSP. 4. Bundles: probe once; otherwise record why they stay raw (Bun's HTML-import static routes win over ours) in notes and wiki. 5. Tests: route-level through Bun.serve port 0 + raw-socket WS RSV1 test. 6. Measure before/after on an isolated server; wiki + notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented. WebSocket: src/lib/xtmux/socket.ts exports terminalSocketCompression ({compress: dedicated, decompress: true}, mounted in server.ts) and sendFrame(ws, data) which every server send uses (pty.ts send/broadcast, manager.ts broadcastToAll/attached, client-messages.ts sendError/list). Probed first: perMessageDeflate alone negotiates the extension but Bun sends RSV1=0 frames unless send(data, true); shared compressor resets its window per message (50 ls lines 5680->4880 shared vs 5680->586 dedicated). HTTP: src/api/compress.ts - negotiateEncoding (absent/identity/*;q=0 -> none, q-values, named beats wildcard, ties br>zstd>gzip), 1 KiB threshold, text-type allowlist (no image/*, no text/event-stream), skips HEAD/1xx/204/304/206/Content-Range/null body/existing Content-Encoding/Cache-Control no-transform, drops Content-Length, appends Vary, weakens strong ETag, async encoders (Bun.zstdCompress 3, zlib brotli q5, gzip 6). compressRoutes wraps guardApiRoutes from outside (origin.ts untouched); preview and connections wrapped with compressRoute. Bodies that qualify are read whole because Bun gives every Response a stream body and no Content-Length; no API route streams today, a future one must use text/event-stream or no-transform. SPA: catch-all now fetches with Accept-Encoding identity and hands to src/api/spa.ts serveSpa, which drops upstream Content-Encoding/Content-Length, keeps Cache-Control/X-Frame-Options/CSP and compresses under the same rule (production index.html is 440 B so goes out plain). Bundles: left uncompressed. Bun's HTML-import static routes serve /chunk-*.js and .css ahead of /* and never reach our handlers; Bun does not compress them (production, Accept-Encoding gzip/br/zstd: JS 5,030,224 B raw, 1,408,191 gzipped; CSS 167,548 B, no Content-Encoding). They are content-hashed and immutable-cached so the cost is once per release per browser; compressing them means building the frontend ahead of time and serving precompressed files from our own routes (replacing the HTML import) or rewriting the HTML to a proxy route - follow-up candidate. Workaround: Caddy or ssh -C. Recorded in wiki modules/compression.md. Measured on isolated production server port 4602, bytes on the wire: large diff (git/commit?sha=3e9b0e0, 67 files) 177,068 -> gzip 42,735 / br 39,596 / zstd 44,712; file read (file?file=src/lib/tasks/manager.ts) 1,248,424 before, 1,248,901 identity after (file edited) -> gzip 187,319 / br 123,562 / zstd 153,832; terminal restore frame 54,519 -> 17,378 with permessage-deflate (decoded 54,337 chars). Tests: src/api/compress.test.ts (route-level, real Bun.serve port 0: each encoding decodes to the same body, absent via raw socket and identity/refused uncompressed, small/small-error/image/pre-encoded/HEAD/403 untouched, gated event-stream and no-transform still stream, SPA headers survive) and src/lib/xtmux/socket.test.ts (raw-socket RSV1 set and inflates with offer, RSV1 clear and plain JSON without, Bun WebSocket client reads both helper paths).

Review (/code-review high v2): no blocking findings. Fixed: dropped application/x-ndjson from the compression allowlist (a streaming format that would otherwise be silently buffered). Accepted and recorded in wiki modules/compression.md: synchronous per-socket frame deflate (incl. restore on attach), compressing for loopback peers too (ssh -L makes remote traffic loopback), per-socket dedicated deflate memory. Pre-existing, not fixed: SPA catch-all never answers 304 (If-None-Match not forwarded to the hidden route); serveSpa copies upstream headers such as Date. Tests: bun run typecheck clean; bun test 2225 pass / 1 fail - the failure (manager.test.ts 'an exiting terminal marks the task exited and sends the row', 4s waitFor timeout) also fails on an untouched v2 checkout in a full run (2197 pass / 1 fail) and passes in isolation, so it predates this change; test:render 600/600 pass.
<!-- SECTION:NOTES:END -->
