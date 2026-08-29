---
id: TASK-1
title: Add tasks table and project default columns (migration)
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 00:17'
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
- [ ] #1 A fresh database has the `tasks` table with every column in §5.1 and the `tasks_by_recency` index
- [ ] #2 An existing v1 database migrates forward without losing project rows, and the migration is a no-op when re-run
- [ ] #3 `projects` gains default_base_ref, default_model, default_permission_mode, worktree_default
- [ ] #4 Tests cover fresh-init and upgrade-from-v1 paths
- [ ] #5 `tasks` also has worktree_state, wip_ref, wip_at, setup_duration_ms, pinned (§5.6); `projects` also gains setup_command and worktree_copy
<!-- AC:END -->
