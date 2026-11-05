---
id: TASK-143
title: Poll the worktree list only while something shows it
status: To Do
assignee: []
created_date: '2026-11-05T09:20:00Z'
labels:
  - frontend
dependencies: []
ordinal: 147000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The worktree list added by TASK-138.2 is polled every 15s by a hook the task shell always mounts, so every open window on a task or a composer project makes the daemon list the repository's worktrees every 15 seconds (after a 3s server cache), even with the Explorer closed and only one worktree to show. The poll exists because nothing watches worktrees, but it only needs to run while the picker, the rail or an open worktree tab can show its answer. Raised by the TASK-138.2 code review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With the Explorer closed and no worktree tab open, no worktrees request is made after the first
- [ ] #2 With the Explorer open, or a worktree tab open, the list still refreshes and a removed worktree still drops out
- [ ] #3 Returning focus to the window refreshes the list once
- [ ] #4 A rendering test covers the closed panel making no requests and reopening it resuming them
<!-- AC:END -->
