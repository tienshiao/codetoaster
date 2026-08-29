---
id: TASK-2
title: 'TaskStore: CRUD over the tasks table'
status: Done
assignee:
  - '@tma'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 02:31'
labels:
  - server
  - db
milestone: m-0
dependencies:
  - TASK-1
documentation:
  - docs/v2-architecture.md
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pure data-access layer over `tasks` (§5.2): create, get by id, list, update (partial), delete. Knows nothing about processes, worktrees, or naming. Lives in lib/tasks/store.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 create/get/list/update/delete work against bun:sqlite with typed rows
- [x] #2 list is ordered by last_active_at DESC and can filter by lifecycle (live|suspended|archived)
- [x] #3 update accepts a partial row and only touches the given columns
- [x] #4 No import of Pty, SessionManager, git, or fs — pure CRUD
- [x] #5 Unit tests cover every operation against an in-memory database
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New src/lib/tasks/store.ts: class TaskStore(db: Database) — constructor takes the handle so tests can drive an in-memory database and nothing pulls in the singleton.
2. create(NewTask): required id/project_id/title/initial_prompt/repo_root/cwd; title_source, worktree_state, agent_state, lifecycle, pinned, created_at, last_active_at default. Returns the inserted row.
3. get(id), list({ lifecycle }) ordered by last_active_at DESC (lifecycle takes one value or several), update(id, partial), delete(id).
4. update: skip undefined (leave the column alone), allow null (set NULL), and whitelist column names against the known set rather than interpolating whatever keys arrive.
5. No import of Pty, SessionManager, git or fs.
6. src/lib/tasks/store.test.ts over an in-memory database: every operation, ordering, the lifecycle filter, partial-update semantics, and the column whitelist.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/lib/tasks/store.ts holds TaskStore(db: Database) — the handle is a constructor argument, not the module singleton, so a test can drive an in-memory database and nothing here reaches for global state. Both its imports are type-only (bun:sqlite, ../db), so at runtime the module pulls in nothing at all; AC #4 holds by construction rather than by discipline.

create() takes the six fields a caller has to decide and defaults the rest: a task starts derived, live, starting, unpinned, with no worktree, and its last_active_at seeds from created_at so a brand-new task sorts to the top before anything has run in it. list() is last_active_at DESC and takes one lifecycle or several; an empty array matches nothing rather than silently meaning 'everything'. update() skips undefined (leave the column) but honours null (clear it), and checks every caller-supplied key against UPDATABLE_COLUMNS — a key reaches SQL as an identifier rather than a bound parameter, so the compile-time type is not what protects it at runtime when the object came off the wire. get() normalizes bun:sqlite's null-for-missing to undefined so its signature is honest.

20 tests in src/lib/tasks/store.test.ts cover every operation, the defaults, ordering, both filter shapes, partial-update semantics, and the column whitelist.

Still open for TASK-5: tasks.project_id declares REFERENCES projects(id) but nothing enables PRAGMA foreign_keys. Enforcement would make deleteProject fail once a project has tasks, so whoever makes deleteProject task-aware should decide it.

Code review (/code-review --fix) found no issue in the store itself, but flagged that db.ts's updateProject built its SET clause from caller-supplied keys with no allowlist — the exact hazard TaskStore.update guards against, and newly relevant now that ProjectRow has six more columns and v2 routes project settings over HTTP. Given the matching UPDATABLE_PROJECT_COLUMNS treatment.

It also caught that migration 001 was the one migration still using a bare CREATE TABLE, breaking the invariant 002/003/004 all hold: a database that lost its 001 record would throw 'table projects already exists' at every boot before the newer guards could matter. Now CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE, with a regression test.

Runtime verification: drove TaskStore against the daemon's own migrated database file — create defaults, recency ordering, both lifecycle filter shapes, partial update leaving neighbouring columns alone, the column whitelist refusing an injected key, delete reporting true then false — and confirmed the rows land where plain SQL can read them. Separately deleted the 001 record from that database and restarted the daemon: it came up clean, re-recorded 001, did not duplicate or clobber the General project, and the task rows survived.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added src/lib/tasks/store.ts: TaskStore, pure data access over the tasks table (§5.2). It takes its Database as a constructor argument rather than reaching for the module singleton, and both its imports are type-only — so at runtime the module pulls in nothing, and 'no Pty, SessionManager, git or fs' holds by construction rather than by discipline.

create() takes the six fields a caller has to decide and defaults the rest: a task starts derived, live, starting, unpinned, with no worktree, and seeds last_active_at from created_at so a new task sorts to the top before anything has run in it. list() is last_active_at DESC and filters on one lifecycle or several, with an empty array meaning nothing rather than everything. update() skips undefined but honours null, and checks each caller-supplied key against an allowlist — a key reaches SQL as an identifier, not a bound parameter, so the type is not what protects it once the object came off the wire. get() normalizes bun:sqlite's null-for-missing to undefined.

Review pulled two adjacent fixes into db.ts: updateProject got the same allowlist treatment, and migration 001 — the last one still using a bare CREATE TABLE — became IF NOT EXISTS + INSERT OR IGNORE, so a database that lost its 001 record no longer wedges the daemon at every boot.

Verified by 20 unit tests over an in-memory database, by driving the store against the daemon's own migrated file, and by deleting the 001 record from that file and restarting: the daemon came up clean, re-recorded the migration, and left both the General project and the task rows intact.
<!-- SECTION:FINAL_SUMMARY:END -->
