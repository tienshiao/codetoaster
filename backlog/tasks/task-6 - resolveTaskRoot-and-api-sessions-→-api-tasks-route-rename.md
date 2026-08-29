---
id: TASK-6
title: resolveTaskRoot and /api/sessions → /api/tasks route rename
status: Done
assignee:
  - '@tma'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 03:36'
labels:
  - server
  - api
milestone: m-0
dependencies:
  - TASK-2
documentation:
  - docs/v2-architecture.md
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every data route today funnels through resolveSessionGitRoot(sessionId), which needs a running PTY (§5.4). Replace with `resolveTaskRoot(taskId) -> { repoRoot, cwd }` read from the task row, so a suspended task can still be browsed. Rename `/api/sessions/:id/*` → `/api/tasks/:id/*` across api/{diff,files,git,highlight,symbols}.ts and the matching frontend hooks. Route bodies are untouched. Live getCwd() is kept only to opportunistically notice the agent has cd'd elsewhere. Land this early: it is mechanical and low-conflict (Risk 7).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 resolveTaskRoot reads repo_root/cwd from the task row and never touches a process
- [x] #2 diff, files, git, highlight, and symbol routes work for a task with no live PTY
- [x] #3 All routes are served under /api/tasks/:id/*; no /api/sessions/* remains
- [x] #4 Frontend hooks call the new paths; existing route tests pass
- [x] #5 repo_root is computed once at task creation and stored on the row
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. api/utils.ts: resolveSessionGitRoot becomes resolveTaskRoot(taskId) -> { repoRoot, cwd } | { error }, reading the row only — no getCwd, no git per request (today every data route shells out to rev-parse --show-toplevel on every call).
2. Non-repo tasks: derive.resolveRepoRoot returns '' rather than falling back to cwd, and resolveTaskRoot turns that into the existing 400 'Not a git repository'. A documented sentinel on a NOT NULL column, which beats a table rebuild to make it nullable.
3. Callers in api/{diff,files,git,highlight,symbols}.ts take repoRoot where they took dir. Bodies untouched.
4. Rename every route to /api/tasks/:id/*, including server.ts's list, DELETE, preview and upload; frontend hooks, components and the CLI follow. No /api/sessions/* left.
5. Opportunistic cwd refresh (§5.4): TaskManager.refreshCwd(taskId) asks the live PTY and, only when it differs from the row, writes cwd and re-resolves repo_root. Called from the task list route, which already awaited getCwd.
6. Drop the ptyId = taskId default in createTask now that nothing routes through it. This is what the coupling was for, so TASK-6 is where it goes; clients already read TaskInfo.ptyId.
7. Tests: resolveTaskRoot over an in-memory store (live task, suspended task with no PTY, unknown task, non-repo task), and refreshCwd's no-write-when-unchanged.

Judgement calls to flag: (2) the '' sentinel and (6) removing the id coupling both go slightly beyond the ACs; both are the natural completion of 'routes stop depending on a live process'.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
resolveSessionGitRoot became resolveTaskRoot(taskId) -> { repoRoot, cwd } | { error }: synchronous, reads the row, touches no process. It also drops a per-request 'git rev-parse --show-toplevel' that every data route was paying on every call.

Non-repo tasks: resolveRepoRoot now returns '' instead of falling back to the cwd, and resolveTaskRoot turns that back into the existing 400. repo_root is NOT NULL, so '' is the row's way of saying there is no repo here; the old fallback read as a repository right up until every git command inside it failed.

Nineteen routes moved to /api/tasks/*, including the list, DELETE, preview and upload in server.ts; frontend hooks, components and the CLI followed. No /api/sessions anywhere. Route bodies are untouched — each handler binds the resolver's repoRoot to the dir local it already had.

§5.4's opportunistic getCwd lives in TaskManager.refreshCwd, called from the task list route (the one place that already had the processes to hand). It writes only when the directory actually moved, and re-resolves repo_root then, since that is a git call.

Also dropped the ptyId = taskId default in createTask: routing was the only thing it was propping up, so this is where it goes. Terminals now get minted ids in production, which is what makes the association load-bearing rather than incidentally true.

src/api/task-root.test.ts covers a row with no process (the AC #2 case), unknown → 404, non-repo → 400, a live task resolving to its stored root, terminals having ids of their own, and refreshCwd's no-write-when-unchanged. It drives the process-wide taskManager against a temp database, so its teardown waits for killed PTYs' onExit writes to land — otherwise they fire against a database the file has already removed and the fallout surfaces in whatever test file runs next.

252 tests pass across three consecutive runs; tsc clean.

Reverted the '' sentinel for repo_root: migration 005_tasks_repo_root_nullable rebuilds the tasks table with repo_root nullable, folding any '' written in the meantime to NULL and recreating tasks_by_recency. NULL is what 'this task is not inside a repository' actually means, and an empty string standing in for it is the same kind of lie the cwd fallback was. SQLite cannot drop a NOT NULL in place, but the rebuild is cheap — the only rows that can exist are a developer's — and it is guarded on PRAGMA table_info so a lost migration record does not re-run it. resolveRepoRoot returns string | null, TaskRow.repo_root and NewTask.repo_root are nullable, and resolveTaskRoot checks === null.

db.test.ts covers the rebuild: nullability, every column surviving, the index recreated, an upgrade from the old NOT NULL shape preserving rows with '' folded to NULL, and a re-run over an already-nullable column doing nothing. 256 tests pass.

Code review (/code-review --fix) found seven issues; five fixed by the review, one deferred to TASK-25, one I closed afterwards.

The sharpest was resolveRepoRoot conflating two different answers. It returned null both for 'not a repository' and for 'the lookup never ran' — git missing from PATH (Bun.spawn throws) or killed at the 2s timeout on a contended index.lock. refreshCwd wrote that straight onto the row, so one slow git call while a task's shell moved directory would blank repo_root and 400 every data route for that task permanently, since nothing re-resolves once cwd stops moving. Now three answers: a root, null on git's exit 128, undefined otherwise — and refreshCwd writes cwd but keeps the root it had when the answer is undefined.

Also fixed by the review: the slug route latched lastSlugRef before an attach that can now fail (server-minted pty ids mean a listed row can briefly have no ptyId), leaving the terminal dark; Terminal.tsx addressed input with a stale ptyIdRef in the window after 'attached', losing the keystroke to a 'Not attached' error; createTask inherited afterTaskId's cwd only from a live PTY rather than falling back to the row; and server.ts's 'list' handler hand-rolled the snapshot payload broadcastTasks already built (now TaskManager.tasksSnapshot()).

Left open by the review and closed after: repo_root was frozen at creation with no refresh point the browser reaches — GET /api/tasks is CLI-only. attachClient now fires refreshCwd for the task being opened, which is the moment before its Changes/Files/History tabs get used and the only browser-reachable one; it broadcasts a delta if anything moved. Residual gap, and it matches §5.4's word 'opportunistic': an agent that cd's while you are already watching is not noticed until the next attach. Per-request refresh is what TASK-6 exists to remove.

260 tests pass across consecutive runs; tsc clean.

Runtime verification against a live daemon:
- A fresh database applies all five migrations with repo_root nullable and tasks_by_recency present.
- Task and PTY ids are genuinely different now, so every route below was called with an id no PTY holds.
- All fourteen renamed routes 200 (diff, context, files, files/search, file, git/log, git/refs, git/commit, git/tree, git/file, symbols, symbols/search, preview, diff-tokens), 400 for a symbolic sha, 404 for an unknown task.
- AC #2 proven by restarting the daemon: the task became suspended with no PTY at all, and diff, files, file, git/log, git/refs, git/commit, git/tree and symbols still answered 200. preview correctly 404s — it is one of the two routes that genuinely needs a terminal. Under the old resolver every one of those would have 404'd.
- A task created in a bare temp directory recorded repo_root NULL and answered 400 'Not a git repository' on diff, files and git/log.
- The review's scenario, end to end: that same task's shell cd'd into this repo (diff still 400, the row being stale is what 'opportunistic' means), then a detach/attach cycle updated the row and diff went 200.
- Chrome: the recovered task rendered a 37-file diff, the git view with graph and commit detail, and the file browser over 281 files, with no console errors. ct list shows its CWD following the agent, which is the list route's refresh firing.
- /api/sessions/* is not a stale route: an unmatched /api path is served the SPA's HTML with a 200, confirmed by content type.

Updated .claude/skills/verify for the task-based API — it still documented /api/sessions and a create message carrying ptyId and name.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every data route read its directory from a running PTY. resolveSessionGitRoot called getCwd() (lsof/readlink against a live process) and then shelled out to 'git rev-parse --show-toplevel' — on every single request — so a task with no process 404'd its diff, file, git and symbol views. Since browsing a task you are not currently running is the point of v2, that had to go.

resolveTaskRoot(taskId) -> { repoRoot, cwd } | { error } reads the row instead: synchronous, no process, no git. Nineteen routes moved to /api/tasks/*, including the list, DELETE, preview and upload; the frontend hooks, components and the CLI followed, and route bodies are untouched — each handler binds repoRoot to the dir local it already had.

repo_root became nullable (migration 005 rebuilds the table, folding to NULL the empty string the NOT NULL column had briefly forced). NULL is what 'this task is not inside a repository' means, and resolveTaskRoot turns it into the 400 the routes owe the client; the old fallback to cwd read as a repository right up until every git command inside it failed.

resolveRepoRoot now gives three answers, not two: a root, NULL on git's exit 128, and undefined when the lookup could not run at all — git missing from PATH, or killed at the timeout. Only the first two are ever written to a row. Without that distinction one slow git call while a task changed directory would blank repo_root and 400 that task's data routes permanently, since nothing re-resolves once the directory settles.

§5.4's opportunistic getCwd lives in TaskManager.refreshCwd, and fires from two places: the task list route, and attaching to a task's terminal. The second matters because the first is CLI-only — attach is the moment before a task's Changes, Files and History tabs get used, and the only such moment the browser reaches. It writes only when the directory actually moved.

Also dropped the ptyId = taskId default from createTask: routing was the only thing propping it up. Terminals get minted ids in production now, so the association is load-bearing rather than incidentally true.

Verified by 260 tests, a clean tsc, and a live daemon: all fourteen renamed routes, a restarted daemon serving eight of them for a suspended task with no PTY at all, a non-repo task answering 400 and then recovering after its shell cd'd into a checkout and a client re-attached, and the diff, git and file views driven in Chrome. The verify skill was updated — it still documented /api/sessions.
<!-- SECTION:FINAL_SUMMARY:END -->
