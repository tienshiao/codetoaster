---
id: TASK-32
title: Two-way boot reconciliation and worktree-aware task cards
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
updated_date: '2026-08-31 06:56'
labels:
  - server
  - frontend
  - git
milestone: m-4
dependencies:
  - TASK-39
  - TASK-25
documentation:
  - docs/v2-architecture.md
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Risk 5 (§9) / §5.6. On boot, per project, compare `git worktree list --porcelain` against task rows in both directions: (a) directory on disk with no row → remove if clean; if dirty, leave it and surface an 'unclaimed worktree' card with a manual delete — never auto-delete dirty, even orphans; (b) row says present but the directory is gone → worktree_state=missing, restored on open; branch also gone → broken-but-actionable card. Then git worktree prune and expire WIP refs past retention. Cards show worktree_state, branch, dirty file count, unpushed commit count, and merged-into-base (git status --porcelain, rev-list @{u}.., branch --merged), computed lazily on render or cached per harvester tick; merged tasks get an 'archive?' nudge.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Boot removes clean worktrees with no matching non-archived row and logs what it removed
- [ ] #2 Dirty orphan worktrees are never deleted automatically; they appear as unclaimed cards with a manual delete
- [ ] #3 A row whose directory is missing is flipped to worktree_state=missing and restores on open; a missing branch yields an actionable card
- [ ] #4 The sweep never touches directories outside ~/.codetoaster/worktrees
- [ ] #5 Task cards show worktree state, branch, dirty count, unpushed count, and merged status without blocking render
- [ ] #6 Tests cover both reconciliation directions against a temporary directory and repository
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-31 06:56
---
From TASK-38's code review: `TaskManager.restoreTaskWorktree` returns early when the task was deleted while git was working, which leaves a checkout on disk for a row that no longer exists — `deleteTask` removes no worktrees. Cleaning up in place was rejected there because the obvious call (`removeWorktree`) also deletes the branch, which is more destructive than the delete path itself. It is the 'directory on disk, no row' case this task already owns: remove if clean, surface an unclaimed-worktree card if dirty.
---
<!-- COMMENTS:END -->
