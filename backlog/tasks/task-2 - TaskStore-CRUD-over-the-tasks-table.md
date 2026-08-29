---
id: TASK-2
title: 'TaskStore: CRUD over the tasks table'
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
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
- [ ] #1 create/get/list/update/delete work against bun:sqlite with typed rows
- [ ] #2 list is ordered by last_active_at DESC and can filter by lifecycle (live|suspended|archived)
- [ ] #3 update accepts a partial row and only touches the given columns
- [ ] #4 No import of Pty, SessionManager, git, or fs — pure CRUD
- [ ] #5 Unit tests cover every operation against an in-memory database
<!-- AC:END -->
