---
id: TASK-14
title: Scrollback snapshots and last_size persistence
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - server
  - tasks
milestone: m-2
dependencies:
  - TASK-5
documentation:
  - docs/v2-architecture.md
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Serialize a task's agent terminal to ~/.codetoaster/tasks/<id>/scrollback.ans and persist last_size_cols/rows on the row (§5.1, §5.5). Not in SQLite — these are multi-hundred-KB ANSI blobs. Used by every harvest path and by two-phase restore.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 snapshot(taskId) writes scrollback.ans next to settings.json and updates last_size on the row
- [ ] #2 Snapshot files are removed when a task is archived
- [ ] #3 A respawned task uses last_size as its initial grid (zero-attachments-keeps-size rule)
- [ ] #4 Tests cover write, overwrite, and cleanup
<!-- AC:END -->
