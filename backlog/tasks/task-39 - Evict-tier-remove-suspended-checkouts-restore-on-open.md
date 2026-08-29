---
id: TASK-39
title: 'Evict tier: remove suspended checkouts, restore on open'
status: To Do
assignee: []
created_date: '2026-08-29 00:17'
labels:
  - server
  - tasks
  - git
milestone: m-4
dependencies:
  - TASK-38
  - TASK-16
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§5.6: the second harvest tier. Over suspended tasks with worktree_state=present, when grace has elapsed: snapshot WIP (always, dirty or not), git worktree remove --force + prune, worktree_state=evicted, broadcast. Grace = base (default 7 days, configurable, 0 = never) scaled by the task's setup_duration_ms; pinned tasks are exempt; a manual per-task and per-project evict exists. Opening an evicted (or missing) task runs restore (worktree add + WIP + setup) before claude --resume, behind the two-phase 'restoring workspace…' banner from task-17. Eviction only runs on suspended tasks, so the harvester's process guards are already discharged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A suspended, unpinned task past its grace is evicted: WIP ref written, directory removed, worktree_state=evicted, task delta broadcast
- [ ] #2 Grace scales with setup_duration_ms; a pinned task is never evicted; base grace 0 disables the tier
- [ ] #3 Manual evict works on a single task and on every suspended task of a project
- [ ] #4 Opening an evicted or missing task restores the checkout, runs setup with visible output, then resumes the agent; the UI shows 'restoring workspace…' meanwhile
- [ ] #5 Restore failure (branch gone, WIP parent mismatch) lands on an actionable card, never a dead terminal
- [ ] #6 Tests cover eviction guards and the restore path
<!-- AC:END -->
