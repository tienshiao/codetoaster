---
id: TASK-138.1
title: Show a task's process tree and the ports it is listening on
status: To Do
assignee: []
created_date: '2026-11-05T07:00:00Z'
labels:
  - frontend
  - backend
dependencies: []
parent_task_id: TASK-138
ordinal: 141000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a task's agent runs subagents, dev servers and test runners, there is no way to see from CodeToaster what is running under the task or which ports those processes hold, so finding a stray server or a port clash means leaving for a separate terminal.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A task view lists the process tree rooted at the task's PTY, with each process's pid, command and parent
- [ ] #2 Each process holding a listening TCP port shows that port
- [ ] #3 The view refreshes while open and drops processes that have exited
- [ ] #4 A task with no live PTY (suspended or evicted) shows that state instead of an empty tree
- [ ] #5 The route that serves it has route-level tests for the happy path and the unknown-task 404
<!-- AC:END -->
