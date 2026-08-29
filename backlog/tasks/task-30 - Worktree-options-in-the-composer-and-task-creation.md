---
id: TASK-30
title: Worktree options in the composer and task creation
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
updated_date: '2026-08-29 00:17'
labels:
  - frontend
  - server
  - api
milestone: m-4
dependencies:
  - TASK-29
  - TASK-24
documentation:
  - docs/v2-architecture.md
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Composer options row gains the new-worktree toggle and base-ref picker (§7.5), defaulting from the project's worktree_default / default_base_ref. POST /api/tasks accepts { worktree: boolean, baseRef } and, when set, creates the worktree before spawning; the task row stores cwd == worktree_path, branch, base_ref. Worktrees are what make --continue unambiguous for resume (§4.3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Composer shows a worktree toggle and base ref input, pre-filled from project defaults
- [ ] #2 POST /api/tasks with worktree=true creates the worktree first and spawns the agent inside it
- [ ] #3 cwd, worktree_path, branch, base_ref are stored on the task row
- [ ] #4 Worktree creation failure returns an error and leaves no task row or partial worktree behind
- [ ] #5 Project settings expose setup_command and worktree_copy alongside worktree_default and default_base_ref
<!-- AC:END -->
