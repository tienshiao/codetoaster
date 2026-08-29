---
id: TASK-3
title: Extract Pty from Session
status: Done
assignee:
  - '@tma'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 01:55'
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
- [x] #1 Pty constructor takes command: string[] and env; no assumption that the command is $SHELL
- [x] #2 name/nameSource are gone from Pty; naming.ts no longer reads them from the PTY object
- [x] #3 OSC handlers, serialize-on-attach, activity debounce, getCwd/getForegroundPid, sanitizeSize behave as before (existing tests pass)
- [x] #4 Pty.clients is keyed by `${clientId}:${ptyId}`
- [x] #5 WebSocket messages use ptyId instead of sessionId, server and frontend
- [x] #6 src/lib/xtmux/multiplex.test.ts passes unchanged in intent (hidden-tab null size, two-clients-one-pty, zero-attachments-keeps-size, detach-recalculates, one-client-many-ptys, input isolation)
- [x] #7 The v1 UI still runs end-to-end after the rename
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. git mv session.ts -> pty.ts, session.test.ts -> pty.test.ts. Class Session -> Pty; constructor (id, command: string[], cols, rows, { cwd, env }) — no $SHELL assumption, env merged over { ...process.env, TERM }.
2. Drop name/nameSource from Pty. SessionManager holds them: sessions map becomes Map<string, SessionRecord { pty, name, nameSource }>; getSession(id) still returns the Pty so server.ts, api/utils.ts and the tests are untouched. naming.ts reads from the record, not the PTY.
3. Pty.clients re-keyed to `${clientId}:${ptyId}` via a private clientKey() — public addClient/removeClient/updateClientSize still take a clientId.
4. Wire rename sessionId -> ptyId across ClientMessage/ServerMessage, server.ts's ws switch, SessionContext.tsx message construction/handling, Terminal.tsx (prop included), App.tsx. Scope is the WebSocket only: /api/sessions/:id route params and the hooks that call them stay sessionId until TASK-6. ProjectInfo.sessionIds and the reorder message stay too — those are session/task-level, and TASK-20 re-splits them into taskId.
5. bun test + tsc, then run the app end-to-end (AC 7).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
session.ts -> pty.ts (git mv, class Session -> Pty), session.test.ts -> pty.test.ts. Constructor is now (id, command: string[], cols, rows, { cwd, env }); env merges over { ...process.env, TERM }, and a key set to undefined removes an inherited variable (verified against Bun 1.4). Empty command throws.

name/nameSource moved out to a SessionRecord { pty, name, nameSource } in SessionManager. getSession() still returns the Pty, so server.ts, api/utils.ts and multiplex.test.ts needed no change there.

Pty.clients is keyed by connectionKey(clientId) = `${clientId}:${id}`; addClient/removeClient/updateClientSize still take a bare clientId.

Wire rename covers the WebSocket only — ClientMessage/ServerMessage, server.ts's switch, SessionContext, Terminal (prop included), App. The /api/sessions/:id route params, ProjectInfo.sessionIds, create's afterSessionId, and getConnections() keep 'session' wording; those are session/task-level and belong to TASK-6/TASK-20.

Typed the wire while renaming it: useWebSocket's send/onMessage, TerminalHandle.handleMessage/send and handleSendMessage now take ClientMessage/ServerMessage instead of object/any. That immediately caught a live v1 bug — routes/sessions.$slug.diff.tsx sent { type: 'input', data } with no session address, so submitting a review comment from the diff view has been silently dropped by the server since the multiplex change (bd9d324) made attachment the authorization. Fixed by addressing it with the route's id.

All 202 tests pass; tsc clean.

Code review (/code-review --fix) found two real races around asynchronous session creation, both fixed:
- SessionContext adopted a late 'attached' for a PTY the user had already switched away from. 'restore' was filtered by ptyId but 'attached' never was, so currentSessionId flipped, the terminal marked itself attached and stole focus, and keystrokes went to a PTY whose screen was not on display. It now hands the attachment back with 'detach' instead.
- server.ts re-attached a socket that closed while createSession was still resolving; its 'close' had already run detachClient, so the dead ClientInfo stayed in the PTY's broadcast list forever, pinning smallest-wins negotiation and reporting a phantom viewer. Added SessionManager.isClientConnected and gated the post-create attach on it.

The review also flagged that connectionKey adds nothing today (the ':<ptyId>' half is constant inside a map the PTY owns privately). Left as-is deliberately: §5.3 names that address for v2 and AC #4 asks for it.

Runtime verification against a live daemon:
- Two PTYs on one socket, each addressed by ptyId: both saw their own marker and neither saw the other's; zero legacy sessionId fields on the wire; input naming an unattached PTY still rejected.
- Ghost-client regression: closing the socket mid-create leaves clientCount 0 and lets the next live client negotiate freely (140x45).
- Late-attached regression: the abandoned PTY ends at clientCount 0 and the client keeps only the session it switched to.
- Whole session-scoped HTTP surface 200 (diff, files, git/log, git/refs, git/commit, git/tree, file, preview), symbolic sha still 400.
- Frontend in Chrome: sessions list, restore, typing into one session, switching between two with no bleed, diff view rendering 17 files. Submitting a review comment from the diff view now reaches the PTY — the bug the wire typing caught.
- Dev bundle serves at 200/14.1MB with 13 ptyId message sites and no sessionId ones.

Updated .claude/skills/verify to document protocol v2, since its sample client still spoke sessionId.

bun test: 203 pass. tsc --noEmit: clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extracted Pty from Session and renamed the WebSocket protocol's session address to ptyId.

src/lib/xtmux/session.ts became pty.ts (class Session -> Pty). The constructor now takes a command vector and an options bag — new Pty(id, command, cols, rows, { cwd, env }) — so it can spawn 'claude …' as readily as $SHELL; env merges over { ...process.env, TERM }, and a key set to undefined removes an inherited variable. Everything hard-won carries over untouched: the OSC 9/777/99 handlers, serialize-on-attach, the 300ms activity debounce, getCwd/getForegroundPid, sanitizeSize. name/nameSource left the PTY for a SessionRecord in SessionManager, the precursor of the task row; getSession() still returns the Pty, so server.ts, api/utils.ts and multiplex.test.ts were unaffected by that split. Pty.clients is keyed by connectionKey(clientId) = '<clientId>:<ptyId>'.

The wire rename is scoped to the WebSocket: ClientMessage/ServerMessage, server.ts's switch, SessionContext, Terminal (its prop included) and App. The /api/sessions/:id route params, ProjectInfo.sessionIds, create's afterSessionId and getConnections() keep their session wording — those are session/task-level and belong to TASK-6 and TASK-20.

While renaming, the wire was typed: useWebSocket's send/onMessage, TerminalHandle.handleMessage/send and handleSendMessage take ClientMessage/ServerMessage instead of object/any. That is what makes the rename verifiable, and it immediately caught a live v1 bug — routes/sessions.$slug.diff.tsx sent { type: 'input', data } with no session address, so submitting a review comment from the diff view had been silently dropped since bd9d324 made attachment the authorization.

Verified by 203 passing tests (multiplex.test.ts unchanged in intent), a clean tsc, and an end-to-end run in Chrome against a live daemon covering session switching, per-PTY input isolation, the diff view, comment submission, and both race fixes.
<!-- SECTION:FINAL_SUMMARY:END -->
