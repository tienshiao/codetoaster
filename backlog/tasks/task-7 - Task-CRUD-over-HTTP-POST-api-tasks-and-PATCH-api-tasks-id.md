---
id: TASK-7
title: 'Task CRUD over HTTP: POST /api/tasks and PATCH /api/tasks/:id'
status: Done
assignee:
  - '@tma'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 03:59'
labels:
  - server
  - api
milestone: m-0
dependencies:
  - TASK-5
documentation:
  - docs/v2-architecture.md
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Task CRUD moves off the WebSocket to HTTP (§5.3) because creating a task can run git and fail in interesting ways. This task covers create and patch; resume lands in Phase 2 and archive in Phase 5. Body for POST: projectId, prompt, optional model/permissionMode (worktree options come in Phase 5). PATCH covers rename (title, title_source='manual').
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /api/tasks creates a row, spawns the agent PTY, and returns the TaskInfo with a 201
- [x] #2 Validation and spawn failures return a 4xx/5xx with a JSON error body, not a socket error string
- [x] #3 PATCH /api/tasks/:id renames a task and sets title_source to manual
- [x] #4 Route tests cover success and failure paths
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New src/api/tasks.ts carrying all four methods on the two task paths — Bun.serve keys routes by path, so POST cannot live in a different module from the existing GET /api/tasks without one clobbering the other. GET and DELETE move over from server.ts; preview and upload stay there (different paths, and they are terminal-scoped).
2. POST /api/tasks: body { projectId?, prompt?, title?, model?, permissionMode?, cols?, rows?, afterTaskId? }. The server mints the id. 201 + TaskInfo. prompt is optional and defaults to '' — the v1 New Session button has no composer until TASK-24, and initial_prompt is NOT NULL.
3. PATCH /api/tasks/:id: { title } -> 200 + TaskInfo, title_source manual. 404 for an unknown task.
4. Errors as JSON bodies: 400 for a malformed body or an unknown projectId, 404, 500 for a spawn failure. Never a socket error string.
5. CreateTaskOptions gains model/permissionMode so the row records them.
6. Drop the socket create and rename messages — that is what 'task CRUD moves off the WebSocket' means, and leaving both is two paths that drift. kill/acknowledge/reorder stay: kill becomes archive in TASK-31.
7. isClientConnected goes with them. It existed only to guard the post-create attach race, and HTTP create removes that race entirely — the client attaches itself once it has the response.
8. Frontend: createSession/renameSession in SessionContext call fetch. createSession becomes async, so App.handleNewTab and CommandPalette await it before navigating.
9. src/api/tasks.test.ts over a real Bun.serve instance: create success, rename, and the failure paths.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/api/tasks.ts carries GET/POST on /api/tasks and PATCH/DELETE on /api/tasks/:id. GET and DELETE moved out of server.ts because Bun.serve keys routes by path — POST in a separate module would have clobbered the existing GET rather than joining it.

POST mints the id, validates each optional field by type before touching anything, rejects an unknown projectId (rather than quietly falling back to General, which resolveProjectId does) and 404s an unknown afterTaskId, then answers 201 with the TaskInfo. A spawn failure is a 500 with a JSON body: createTask already deletes the row it wrote, so nothing is left holding the id. prompt is optional and defaults to '' — the v1 New Session button has nothing to say until the composer lands in TASK-24.

PATCH takes { title }, rejects missing/wrong-typed/blank, 404s an unknown task, and answers the updated TaskInfo. CreateTaskOptions gained model and permissionMode so the row records them.

The socket lost create and rename, which is what §5.3 means by task CRUD moving to HTTP; kill, acknowledge and reorder stay (kill becomes archive in TASK-31). isClientConnected went with them: it existed only to guard the post-create attach race, and HTTP create removes that race outright — the client attaches itself once it has the response, so a socket that closed in between simply never sends one.

Frontend: createSession POSTs and is now async, returning null when the server refuses so callers do not navigate to a task that does not exist; App.handleNewTab awaits it and CommandPalette chains off it. The optimistic row and optimistic project splicing are gone — the server broadcasts the new list before it answers, so there is nothing left to guess. renameSession PATCHes and keeps its optimistic label update.

src/api/tasks.test.ts drives a real Bun.serve: 13 tests over create (including a prompt with newlines surviving verbatim, and SHELL pointed at a nonexistent binary to exercise the 500), rename, delete and list, plus every validation branch.

273 tests pass across consecutive runs; tsc clean.

Code review (/code-review --fix) found four, all fixed:
- createSession detached the current terminal before issuing the POST. That was harmless while create was a fire-and-forget socket message, but a create that can now genuinely fail left the user on a dead unattached grid with nothing to re-attach it — the route's slug latch has fired and attachSession short-circuits on the task it thinks is current. The detach moved to after a successful response.
- The verify skill still told the reader to create tasks over the socket, which this task removed. I had updated it for TASK-6 and then broke it again here. Rewritten around curl, with the WebSocket snippet reduced to an attach that takes ptyId from the create response.
- renameSession only caught network failures; a 4xx resolved normally and was ignored, so a refused rename read as applied — and drove the URL slug — until the next full snapshot, which only arrives on reconnect or when the set of tasks changes. It now rolls back, guarded on the row still holding the name it wrote.
- POST accepted a blank title while PATCH rejected one, and createTask used ?? for the title but truthiness for title_source — so an empty title was stored verbatim and recorded as 'derived', giving a label-less row and a slug of just -<uuid>. Both sides now agree.

Runtime verification against a live daemon: POST 201 with the TaskInfo (task id and pty id distinct); PATCH 200 flipping title_source to manual; every validation branch answering the right status and JSON body (non-object body, wrong-typed title, blank title, non-numeric cols, unknown project 400, unknown afterTaskId 404, unknown task on PATCH 404); a prompt carrying newlines, single and double quotes stored byte-for-byte along with model and permission_mode; the socket answering 'Unknown message type' to create and rename; HTTP create followed by attach pairing the right pty to the right task. In Chrome: New Session created through the async POST, landed in the right position, attached and ran a command; the sidebar rename went through PATCH and the row shows manual. ct list and ct kill still work over the moved GET and DELETE.

273 tests pass; tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Task CRUD moved off the WebSocket to HTTP (§5.3). Creating a task resolves a directory, runs git and spawns a process, and a fire-and-forget message answered by an 'error' frame cannot say which create failed or why — POST /api/tasks answers 201 with the TaskInfo, 400 for a malformed body or an unknown project, 404 for an unknown afterTaskId, and 500 with a body when the spawn throws. PATCH /api/tasks/:id renames and sets title_source to manual.

All four methods live in src/api/tasks.ts because Bun.serve keys routes by path: a POST in a separate module would have clobbered the existing GET /api/tasks rather than joining it, so GET and DELETE came along.

Two things fell out. isClientConnected is gone — it existed only to guard the post-create attach race, and HTTP create removes that race outright, since the client attaches itself once it has the response and a socket that closed in between simply never sends one. And createSession's optimistic row and optimistic project splicing are gone: the server broadcasts the new list before it answers, so there is nothing left to guess.

createSession is async now and returns null when the server refuses, so callers do not navigate to a task that is not there; it also holds on to the terminal it was showing until the response is good, or a refused create would strand the user on a dead grid. renameSession PATCHes and rolls its optimistic label back on a refusal.

The socket lost create and rename accordingly; kill, acknowledge and reorder stay, kill becoming archive in TASK-31.

Verified by 13 route tests over a real Bun.serve, 273 tests overall, a clean tsc, and a live daemon: every status and error body, a prompt with newlines and quotes stored verbatim, the socket rejecting the two removed messages, and New Session plus the sidebar rename driven in Chrome. The verify skill was rewritten around curl — it still documented socket create.

Left thin on purpose: a refused create only reaches console.error, since the v1 UI has no toast surface. Worth a real affordance when TASK-24 builds the composer.
<!-- SECTION:FINAL_SUMMARY:END -->
