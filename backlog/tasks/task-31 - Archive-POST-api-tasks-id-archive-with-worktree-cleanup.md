---
id: TASK-31
title: >-
  Archive: always snapshot, then remove worktree; branch delete only if
  merged/pushed; hard delete
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
updated_date: '2026-08-29 00:17'
labels:
  - server
  - api
  - tasks
milestone: m-4
dependencies:
  - TASK-38
  - TASK-14
documentation:
  - docs/v2-architecture.md
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The only way a task leaves (§5.6, §6), made recoverable. POST /api/tasks/:id/archive: close if live; write the WIP snapshot unconditionally; git worktree remove --force + prune; delete scrollback.ans and settings.json; lifecycle=archived (row kept, hidden behind the sidebar toggle). Branch: `git branch -d` semantics — delete only when merged into base_ref or pushed, otherwise keep and say so; the remote is never touched. The WIP ref is retained N days (default 30) and expired by the boot sweep. A separate POST /api/tasks/:id/delete drops the WIP ref, the row, and (if still present and merged/pushed) the branch — the only irreversible operation, with its own confirmation. The dialog states exactly what will be lost using the card's dirty/unpushed/merged counts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Archive of a live task closes it first, then snapshots WIP even when the tree is clean
- [ ] #2 Archive removes the worktree and snapshot files, sets lifecycle=archived, and keeps the row
- [ ] #3 The local branch is deleted only when merged into base_ref or pushed; otherwise it is kept and the response says why
- [ ] #4 The remote branch is never modified
- [ ] #5 The archive response/confirmation reports dirty files, unpushed commits, and merged status
- [ ] #6 Hard delete drops the WIP ref and the row and requires its own confirmation; WIP refs older than the retention window are expired on boot
- [ ] #7 Tests cover clean, dirty, unpushed, merged, no-worktree, and hard-delete cases
<!-- AC:END -->
