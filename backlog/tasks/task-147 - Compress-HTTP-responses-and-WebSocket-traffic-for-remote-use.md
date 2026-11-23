---
id: TASK-147
title: Compress HTTP responses and WebSocket traffic for remote use
status: To Do
assignee: []
created_date: '2026-11-23T01:41:00Z'
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
