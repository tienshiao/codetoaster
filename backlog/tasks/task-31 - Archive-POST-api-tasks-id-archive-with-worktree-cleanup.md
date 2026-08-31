---
id: TASK-31
title: >-
  Archive: always snapshot, then remove worktree; branch delete only if
  merged/pushed; hard delete
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
updated_date: '2026-08-31 09:02'
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
- [ ] #8 Archive removes the whole of ~/.codetoaster/tasks/<id>/, not only the files it knows to name — closeTask deliberately leaves that directory behind (see its comment), so archive is where it finally goes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From TASK-61 (project rename/move): archive resolves the repository from the *project's* path, and a project can now be pointed at a different repository. Its existing worktrees stay checkouts of the old one, registered in the old repo's `.git/worktrees` — their tasks keep working, since a task's cwd is its own worktree — but `removeWorktree(projectPath, …)` would then run `git -C <new repo> worktree remove <old path>` and fail, leaving the checkout and its branch behind.

Resolve the repository from the worktree instead: `git -C <worktree> rev-parse --git-common-dir` names the repository that actually owns it, whatever the project now points at. The row already carries `worktree_path`, so nothing new has to be stored.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-31 09:02
---
From TASK-64's code review: `deleteTask` removes the row, the PTYs and the scrollback, and leaves the worktree entirely. `DELETE /api/tasks/:id` — the CLI's `kill` — on a task with a checkout strands the directory under `~/.codetoaster/worktrees/<project>/<task>`, its `codetoaster/<slug>` branch, and its `refs/codetoaster/wip/<id>`, none of which anything will ever reference again. This task already owns the destructive path, so the cleanup belongs with it; note that it needs `evictWorktree` (or the branch-aware removal this task is about) rather than `removeWorktree`, which deletes the branch because it exists to undo a failed create.
---
<!-- COMMENTS:END -->
