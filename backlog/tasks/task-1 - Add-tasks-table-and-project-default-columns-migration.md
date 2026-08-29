---
id: TASK-1
title: Add tasks table and project default columns (migration)
status: Done
assignee:
  - '@tma'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 01:55'
labels:
  - server
  - db
milestone: m-0
dependencies: []
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the v2 SQLite schema through lib/db.ts's append-only migration harness (§5.1): a new `tasks` table with the columns and `tasks_by_recency` index from the doc, and new `projects` columns `default_base_ref`, `default_model`, `default_permission_mode`, `worktree_default`. Scrollback snapshots are NOT stored in SQLite (they go to ~/.codetoaster/tasks/<id>/). This is the foundation every other Phase 1 task builds on.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A fresh database has the `tasks` table with every column in §5.1 and the `tasks_by_recency` index
- [x] #2 An existing v1 database migrates forward without losing project rows, and the migration is a no-op when re-run
- [x] #3 `projects` gains default_base_ref, default_model, default_permission_mode, worktree_default
- [x] #4 Tests cover fresh-init and upgrade-from-v1 paths
- [x] #5 `tasks` also has worktree_state, wip_ref, wip_at, setup_duration_ms, pinned (§5.6); `projects` also gains setup_command and worktree_copy
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add migration 003_v2_tasks: CREATE TABLE tasks with every §5.1 column (incl. §5.6 worktree_state, wip_ref, wip_at, setup_duration_ms, pinned) + tasks_by_recency index.
2. Add migration 004_project_v2_defaults: ALTER TABLE projects ADD default_base_ref, default_model, default_permission_mode, worktree_default, setup_command, worktree_copy — each idempotent via PRAGMA table_info guard so a partially-applied upgrade re-runs cleanly.
3. Export a TaskRow interface mirroring the schema (no CRUD — that is TASK-2).
4. Tests in src/lib/db.test.ts: fresh-init has table+index+columns; a hand-built v1 database (001+002 only, with project rows) migrates forward without loss; initDatabase is a no-op when re-run over the same file.
5. Scrollback stays out of SQLite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Two migrations: 003_v2_tasks (tasks table + tasks_by_recency) and 004_project_task_defaults (six ALTER TABLE ADD COLUMN on projects, each guarded by an addColumn() PRAGMA check so a lost applied_migrations row cannot wedge startup on 'duplicate column name').

Extracted applyMigrations(db) out of initDatabase so migrations can be driven against a database that is not the process-wide singleton — that is the only way to test the upgrade path from a hand-built v1 file. src/lib/db.test.ts covers fresh-init, upgrade from v1 both at 001 (color still present) and at 002, re-run no-op, the lost-record case, and initDatabase across two opens.

Types: TaskRow plus TitleSource/WorktreeState/AgentState/Lifecycle unions; ProjectRow gained the six new columns. createProject now takes NewProject (the four identity columns) since everything v2 added is a later-set default.

Caveat for TASK-2: tasks.project_id declares REFERENCES projects(id) as the doc specifies, but SQLite does not enforce foreign keys without PRAGMA foreign_keys = ON, which this database does not set. Turning it on would make deleteProject fail once tasks exist, so the decision belongs with TaskStore, not the migration.

Code review (/code-review --fix) found and fixed two low-severity items here: 003 now uses CREATE TABLE/INDEX IF NOT EXISTS so a lost applied_migrations row cannot wedge the daemon on 'table tasks already exists' (matching the resilience addColumn already gave 004), and initDatabase closes the prior handle before reopening rather than stranding it and its WAL.

Verified at runtime against a live daemon (bun src/index.ts foreground --port 4599 --db /tmp/verify.db): a fresh database came up with all four migrations applied, tasks at 28 columns, tasks_by_recency present, and projects carrying the six new columns. bun test: 203 pass. tsc --noEmit: clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the v2 SQLite schema through the existing append-only migration harness: 003_v2_tasks creates the tasks table with every §5.1/§5.6 column plus the tasks_by_recency index, and 004_project_task_defaults adds default_base_ref, default_model, default_permission_mode, worktree_default, setup_command and worktree_copy to projects. Both are written to survive a missing applied_migrations row (IF NOT EXISTS / a PRAGMA table_info guard) so a half-restored database cannot wedge startup. Scrollback stays out of SQLite by design.

initDatabase was split so applyMigrations(db) can run against a database that is not the process-wide singleton — the only way to test the upgrade path from a hand-built v1 file — and it now closes the previous handle on re-open. Added TaskRow with TitleSource/WorktreeState/AgentState/Lifecycle unions; ProjectRow gained the six columns and createProject narrowed to NewProject.

Verified by src/lib/db.test.ts (11 tests: fresh init, upgrade from v1 at 001 and at 002, re-run no-op, both lost-record cases, initDatabase across two opens) and against a live daemon on a fresh database file. 203 tests pass, tsc clean.
<!-- SECTION:FINAL_SUMMARY:END -->
