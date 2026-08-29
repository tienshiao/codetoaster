---
id: TASK-4
title: 'PtyManager: own live Pty objects'
status: Done
assignee:
  - '@tma'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 02:31'
labels:
  - server
  - xtmux
milestone: m-0
dependencies:
  - TASK-3
documentation:
  - docs/v2-architecture.md
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The process layer of the three-way split (§5.2): spawn, write, resize, serialize, kill, attach/detach per client. Knows nothing about tasks, worktrees, or naming. Replaces the process-owning half of SessionManager.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 spawn(command, opts) returns a Pty id; write/resize/serialize/kill address by ptyId
- [x] #2 Attach/detach and smallest-wins negotiation live here, keyed by `${clientId}:${ptyId}`
- [x] #3 No reference to tasks, TaskStore, git, or naming
- [x] #4 Existing multiplex tests run against PtyManager
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New src/lib/xtmux/pty-manager.ts: PtyManager owns ptys: Map<ptyId, Pty> and clientPtys: Map<clientId, Set<ptyId>> — the attachment map moves off SessionManager.
2. API: spawn(command, opts) -> Pty (opts carries an optional id so the v1 client-supplied uuid still works, generated otherwise); get, write, resize, kill, attach, detach, forClient (attachment is authorization), clientPtyIds, has.
3. No import of naming, gitSpawn, db, or anything task-shaped.
4. SessionManager delegates: keeps projects, names/nameSource and broadcast policy, holds a PtyManager, and wires the Pty callbacks after spawn. connectedClients/isClientConnected stay on SessionManager — that is the socket registry, not the process layer.
5. multiplex.test.ts re-pointed at PtyManager, same twelve rules (hidden-tab null size, two-clients-one-pty, zero-attachments-keeps-size, detach-recalculates, one-client-many-ptys, input isolation). It gets faster too: no git branch lookup on spawn.
6. Keep session-manager.test.ts passing to prove the delegation did not change behaviour.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/lib/xtmux/pty-manager.ts owns ptys: Map<ptyId, Pty> and clientPtys: Map<clientId, Set<ptyId>> — the attachment map moved off SessionManager wholesale. Imports are Pty, sanitizeSize/PtyOptions, and the ClientInfo/WebSocketData types: no naming, no gitSpawn, no db, nothing task-shaped (AC #3).

spawn(command, options) returns the Pty rather than a bare id string — options.id lets the v1 client-supplied uuid through (the same id is the session's slug and route) and one is minted otherwise. Returning the object is what lets SessionManager wire onExit/onTitleChange/onActivityChange/onNotification without an immediate get(); the id is pty.id, and every other method addresses by ptyId as AC #1 asks.

write() and resize() are built on forClient(), so attachment-is-authorization is enforced inside the manager instead of at each call site, and they return false rather than dropping the keystroke silently. That let getClientSession disappear from SessionManager: server.ts now calls writeToSession/resizeSession.

The 80x24 size fallback moved into spawn(), which is the one place that needs a concrete initial grid; server.ts had been duplicating it before calling createSession, and no longer does.

SessionManager keeps projects, names/nameSource and broadcast policy, and holds a PtyManager. connectedClients and isClientConnected stayed with it — that is the socket registry, not the process layer. SessionRecord collapsed to a names map since the Pty now lives elsewhere.

multiplex.test.ts drives PtyManager directly (AC #4), same rules, plus three new spawn cases and explicit coverage of the write/resize refusals. It also got faster and hermetic: spawning no longer runs a git branch lookup. session-manager.test.ts passes unchanged, which is the evidence the delegation did not change behaviour.

226 tests pass; tsc clean.

Code review (/code-review --fix) had one finding here: resizeSession dropped the boolean PtyManager.resize computes, while writeToSession propagated it. Widened to return it — server.ts still ignores it (a stale resize is not worth an error reply), but the policy layer should not swallow an answer the process layer already worked out.

Runtime verification against a live daemon: two PTYs on one socket, each seeing only its own output; an unattached write refused by id; a stale resize dropped while a real one negotiated to 90x25; detaching one PTY leaving the other attached; a PTY with no viewers keeping its last size; killing one leaving the other alone. Whole session-scoped HTTP surface still 200 (and 404 for an unknown session), which is the check that getSession delegating to PtyManager.get did not disturb the route helpers. In Chrome: created two sessions, each showing only its own output, with derived names and uniqueName's ' 2' suffix intact — the naming policy SessionManager kept still works over the new names map.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added src/lib/xtmux/pty-manager.ts and moved the process-owning half of SessionManager into it. PtyManager owns live PTYs and the attachments clients hold on them, and nothing else: its imports are Pty, sanitizeSize and two types, with no naming, no git, no db, nothing task-shaped.

spawn(command, options) returns the Pty — options.id lets the v1 client-supplied uuid through, since that id is also the session's slug and route, and one is minted otherwise. Returning the object is what lets SessionManager wire its four callbacks without an immediate lookup; the id is pty.id and every other method addresses by ptyId. attach/detach/forClient/clientPtyIds/kill carry the multiplexing, and write()/resize() are built on forClient so attachment-is-authorization is enforced inside the manager rather than at each call site.

That last point paid for itself twice: getClientSession disappeared from SessionManager entirely (server.ts calls writeToSession/resizeSession), and the 80x24 size fallback moved into spawn — the one place that needs a concrete initial grid — where server.ts had been duplicating it before every create.

SessionManager keeps projects, names and broadcast policy, and holds a PtyManager. connectedClients and isClientConnected stayed with it: that is the socket registry, not the process layer.

multiplex.test.ts drives PtyManager directly now, same twelve rules plus spawn cases and explicit coverage of the write/resize refusals; it is also hermetic and faster, since spawning no longer runs a git branch lookup. session-manager.test.ts passing unchanged is the evidence the delegation did not change behaviour.

Verified by 227 passing tests, a clean tsc, and a live daemon: per-PTY output isolation, refused writes to an unattached PTY, negotiation and the no-viewers size floor, kill isolation, the whole session-scoped HTTP surface, and two sessions driven in Chrome with derived names intact.
<!-- SECTION:FINAL_SUMMARY:END -->
