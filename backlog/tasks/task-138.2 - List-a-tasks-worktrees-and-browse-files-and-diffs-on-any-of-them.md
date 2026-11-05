---
id: TASK-138.2
title: List a task's worktrees and browse files and diffs on any of them
status: To Do
assignee: []
created_date: '2026-11-05T07:00:00Z'
labels:
  - frontend
  - backend
dependencies: []
parent_task_id: TASK-138
ordinal: 142000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Subagents often work in their own git worktrees of the task's repository. Their changes are invisible in CodeToaster, because the Explorer's Changes, Files and History sections and every file and diff tab are rooted at the task's own checkout, so viewing a file or a diff on one of those worktrees means leaving for another tool.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A task shows the worktrees of its repository with each one's path and branch, the task's own checkout marked
- [ ] #2 Choosing a worktree points the Explorer's Changes, Files and History at that worktree, and switching back returns to the task's checkout
- [ ] #3 File and diff tabs opened from a worktree show that worktree's contents and say which worktree they belong to
- [ ] #4 A worktree removed from disk drops out of the list, and a tab rooted at it reports that it is gone rather than erroring
- [ ] #5 Paths outside the repository's worktrees are refused by the serving routes, with route-level tests covering it
<!-- AC:END -->
