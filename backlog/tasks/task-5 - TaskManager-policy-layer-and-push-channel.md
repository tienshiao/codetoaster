---
id: TASK-5
title: 'TaskManager: policy layer and push channel'
status: Done
assignee:
  - '@tma'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 02:59'
labels:
  - server
  - tasks
milestone: m-0
dependencies:
  - TASK-2
  - TASK-4
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The only place that knows a task can exist without a process (§5.2). Owns create/resume/harvest/archive orchestration (resume/harvest/archive bodies arrive in later phases; the seams exist now), and broadcasts `tasks` (snapshot) and `task` (delta) messages over the WebSocket (§5.3). SessionManager is deleted; the v1 UI is kept working by mapping its session list onto tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Creating a task writes the row via TaskStore, then spawns the agent PTY via PtyManager, and records the ptyId → taskId association
- [x] #2 Clients receive a `tasks` snapshot on connect and a `task` delta on any row change
- [x] #3 activity/notification push messages carry taskId
- [x] #4 SessionManager no longer exists; nothing imports it
- [x] #5 The v1 sidebar still lists and attaches to tasks (bolted on top; not the final UI)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/lib/tasks/derive.ts: dirLabel + branchLabel move off session-manager, joined by deriveTitle (the '<dir> · <branch>' label) and resolveRepoRoot (git rev-parse --show-toplevel once at create, per §5.4). Test moves with them.
2. src/lib/tasks/manager.ts: TaskManager over TaskStore + PtyManager. Owns projects, the ptyId<->taskId association (Map both ways, since a task gets shell tabs in TASK-27), the connected-client registry, and broadcast. createTask writes the row, then spawns, then records the association.
3. Wire (§5.3): server sends 'tasks' (snapshot) and 'task' (delta) instead of 'sessions'; activity/notification carry taskId. TaskInfo carries both id and ptyId so the client attaches to the PTY and routes by the task.
4. The task's primary PTY spawns with id = taskId. A temporary, documented coupling: it keeps /api/sessions/:id resolving through a live PTY until TASK-6 moves route resolution onto the row. The frontend still reads task.ptyId, so decoupling later is a server-only change.
5. Boot reconciliation: live rows whose PTY died with the daemon become suspended (§5.5). Needed for TASK-5 to be honest — without it the manager lists tasks that cannot exist. Overlaps the second half of TASK-16, which keeps manual close.
6. The v1 sidebar lists live tasks only: it has no way to render a suspended one, and TASK-25 widens it.
7. SessionContext becomes the adapter — it consumes tasks/task and maps them onto the shape App/AppSidebar/CommandPalette/TabSwitcher/TopBar/routes already consume, so no other frontend file changes. TASK-20 deletes the adapter.
8. Delete session-manager.ts and its test; api/utils and server.ts move to taskManager.
9. Tests: manager.test.ts over an in-memory store, including a task whose ptyId differs from its taskId so the association is genuinely exercised.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/lib/tasks/manager.ts holds TaskManager over TaskStore + PtyManager, with the association in both directions (ptyToTask so everything a terminal reports — output, a title, a notification — is readdressed to its task; taskPtys so a task's terminals all die with it). createTask resolves the cwd, derives the title, resolves and stores repo_root once (§5.4), writes the row, then spawns and adopts the terminal.

Wire: 'sessions' became 'tasks' (snapshot) + 'task' (delta); activity and notification carry taskId; kill/rename/acknowledge/reorder are task-addressed while attach/detach/input/resize stay terminal-addressed. TaskInfo carries id and ptyId separately.

Two changes fell out of writing it:
- 'attached' now carries taskId and is sent by TaskManager rather than Pty, before the PTY's restore. A Pty has no notion of a task, and the client filters terminal traffic against the PTY it is showing — so learning the pairing after the restore would mean dropping its own restore. This is what lets the frontend judge a late 'attached' on taskId instead of relying on the ids coinciding.
- db.ts's project helpers take the database to act on, defaulting to the singleton. TaskManager reads tasks through an injected store and projects through those helpers; without this it could read one out of one database and the other out of another, which is exactly what the first manager test hit.

createTask takes an optional ptyId, defaulting to the task id. The default keeps /api/sessions/:id resolving through a live PTY until TASK-6 moves route resolution onto the row; the option is the seam a resumed task (TASK-13) and a second shell tab (TASK-27) both need, and it is what makes the association testable rather than accidentally true — the association tests drive a task whose terminal is called 'pty-9'.

SessionContext is now an adapter: fromTask/fromWireProject map the wire onto the v1 shape, so App, AppSidebar, CommandPalette, TabSwitcher, TopBar and the routes needed no change beyond App passing currentPtyId (not currentSessionId) to the terminal. TASK-20 deletes the adapter.

session-manager.ts is gone; dirLabel/branchLabel moved to lib/tasks/derive.ts with deriveTitle and resolveRepoRoot, and its test moved with them. 244 tests pass; tsc clean.

Code review (/code-review --fix) found six issues, three of them regressions I had not thought to look at:
- src/cli/commands.ts read s.name and c.sessionIds off /api/sessions and /api/connections, both of which now serve the v2 shape. 'ct list' and 'ct connections' threw a TypeError as soon as anything existed, and 'ct kill <name>' could never match. Retyped to title/terminalTitle/ptyIds.
- routes/sessions.$slug.diff.tsx sent the review prompt with ptyId set to the *task* id from the slug — working only because createTask defaults the terminal id to the task id, and exactly the assumption TaskInfo.ptyId exists to prevent. Now reads the session's ptyId.
- createTask inserted the row before spawning, so a Bun.spawn throw (a stale $SHELL not on PATH) left an orphan row that was in no project, absent from listTasks, and permanently blocking its own id. Now deletes the row and rethrows.
- The lazy store pinned the first Database it saw, which initDatabase now closes and replaces; rebuilt when the handle changes.
- closeSession left attachedPtyRef/currentPtyId pointing at the killed terminal, so its exit still passed the message filter.

Runtime verification against a live daemon:
- Protocol: 'attached' arrives before 'restore' and carries the task; snapshot on create, one 'task' delta on rename (no snapshot); activity carries taskId with no ptyId leaking; two tasks on one socket each saw only their own output.
- CLI: ct list renders NAME from title and TITLE from terminalTitle, ct connections prints the terminal a live client holds, ct kill 'Renamed By Hand' matched by title and reported it.
- Boot reconciliation: restarted the daemon with a live row; it logged 'Suspended 1 task left live by the previous run', the row moved to suspended/unknown and was retained, and the v1 list showed nothing.
- Whole session-scoped HTTP surface 200 (diff, files, git/log, git/refs, git/commit, git/tree, file, preview, symbols), 400 for a symbolic sha, 404 for an unknown task.
- Chrome: created two tasks, derived titles with uniqueName's suffix, switching with no output bleed, diff view over 17 files, and a review comment submitted from the diff reaching the right terminal.

244 tests pass; tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TaskManager replaces SessionManager as the policy layer (§5.2) — the only place that knows a task can exist without a process. It holds rows through TaskStore, processes through PtyManager, and the association between them in both directions: ptyToTask, because everything a terminal reports (output, a title, a notification) has to be readdressed to its task before it goes out, and taskPtys, because a task's terminals all die with it.

createTask resolves the cwd, derives a '<dir> · <branch>' title, resolves and stores repo_root once (§5.4), writes the row, then spawns and adopts the terminal — deleting the row again if the spawn throws, so a stale $SHELL cannot leave an orphan blocking its own id.

Protocol: 'sessions' became 'tasks' (snapshot) plus 'task' (delta), so a transitioning agent no longer re-sends every row; activity and notification carry taskId; kill/rename/acknowledge/reorder are task-addressed while attach/detach/input/resize stay terminal-addressed. TaskInfo carries id and ptyId separately.

Two things fell out of writing it. 'attached' now carries taskId and is sent by TaskManager rather than Pty, *before* the PTY's restore: a Pty has no notion of a task, and since a client filters terminal traffic against the PTY it is showing, learning the pairing after the restore would mean dropping its own restore. And db.ts's project helpers now take the database to act on — TaskManager reads tasks through its store and projects through those helpers, and without this could read one out of one database and the other out of another.

createTask takes an optional ptyId defaulting to the task id. The default keeps /api/sessions/:id resolving through a live PTY until TASK-6 moves route resolution onto the row; the option is the seam TASK-13 and TASK-27 both need, and it is what makes the association testable rather than accidentally true.

Boot reconciliation went in here because without it the manager lists tasks that cannot exist: rows persist across restarts now, and every live one at boot describes a process that died with the previous daemon. TASK-16 keeps the manual-close half.

SessionContext became the adapter (fromTask/fromWireProject onto the v1 shape), so the sidebar, palette, tab switcher, top bar and routes needed no change beyond App passing currentPtyId rather than currentSessionId to the terminal — a live bug the split exposed. TASK-20 deletes the adapter.

Verified by 244 passing tests, a clean tsc, and a live daemon: message ordering and addressing, the three CLI commands the review found broken, a restart moving a live row to suspended and retaining it, the whole session-scoped HTTP surface, and two tasks driven in Chrome through switching, the diff view and comment submission.
<!-- SECTION:FINAL_SUMMARY:END -->
