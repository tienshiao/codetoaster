---
id: TASK-139
title: 'Unarchive a task: restore its worktree from the archive snapshot and resume'
status: To Do
assignee: []
created_date: '2026-11-05T07:32:00Z'
labels:
  - frontend
  - backend
dependencies: []
ordinal: 143000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Archive is the only way to put a task away, and it cannot be undone from the UI, so it is hard to commit to when you are not sure the work is finished. Archive already keeps what a restore needs: it snapshots the worktree, uncommitted changes included, to a refs/codetoaster/wip ref retained for 30 days, and keeps the branch unless it was merged or pushed (TASK-31, TASK-38). What is missing is the way back. Evicted tasks already get their checkout rebuilt on open (TASK-39), which is the closest existing path. Chosen over adding a separate Done or Settle state: with a reliable unarchive, archive itself becomes safe to use when you think you are done.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An archived task in the sidebar's archived list and in the command palette offers Unarchive
- [ ] #2 Unarchive recreates the task's worktree on its branch with the snapshot's uncommitted changes applied, then resumes the agent, and the task returns to the live list
- [ ] #3 A task that ran in the project directory rather than its own worktree unarchives by resuming only
- [ ] #4 When the snapshot has expired or the branch is gone, Unarchive says what can and cannot be restored before doing anything, and restores what it can
- [ ] #5 The archive confirmation says the task can be unarchived and until when
- [ ] #6 The unarchive route has route-level tests: happy path, unknown task 404, task not archived 409, and the expired-snapshot case
<!-- AC:END -->
