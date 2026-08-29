---
id: TASK-3
title: Extract Pty from Session
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - server
  - xtmux
milestone: m-0
dependencies: []
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rename and slim lib/xtmux/session.ts into `Pty` (§5.2, §5.3). The constructor takes `command: string[]` so it can spawn either `claude …` or a plain shell; `name`/`nameSource` leave (they become task properties). Everything hard-won stays: OSC 9/777/99 handlers, serialize-on-attach, activity debounce, getCwd()/getForegroundPid(), sanitizeSize(). Clients re-key from clientId to `${clientId}:${ptyId}`. This is also where the deferred wire rename lands: `sessionId` → `ptyId` on the WebSocket protocol and across the frontend. Risk 1 in §9: re-run the multiplex rules when this lands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pty constructor takes command: string[] and env; no assumption that the command is $SHELL
- [ ] #2 name/nameSource are gone from Pty; naming.ts no longer reads them from the PTY object
- [ ] #3 OSC handlers, serialize-on-attach, activity debounce, getCwd/getForegroundPid, sanitizeSize behave as before (existing tests pass)
- [ ] #4 Pty.clients is keyed by `${clientId}:${ptyId}`
- [ ] #5 WebSocket messages use ptyId instead of sessionId, server and frontend
- [ ] #6 src/lib/xtmux/multiplex.test.ts passes unchanged in intent (hidden-tab null size, two-clients-one-pty, zero-attachments-keeps-size, detach-recalculates, one-client-many-ptys, input isolation)
- [ ] #7 The v1 UI still runs end-to-end after the rename
<!-- AC:END -->
