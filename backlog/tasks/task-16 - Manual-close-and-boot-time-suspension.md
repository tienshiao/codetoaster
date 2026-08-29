---
id: TASK-16
title: Manual close and boot-time suspension
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - server
  - api
  - tasks
milestone: m-2
dependencies:
  - TASK-14
documentation:
  - docs/v2-architecture.md
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two more harvest triggers (§5.5, §6). Manual: the task list's close action calls the same harvest path minus the idle guards (the UI confirms when the agent is busy). Restart: on daemon boot, every `live` row becomes `suspended` because its PTY died with the parent — verified in Phase 0 that closing the PTY masters takes the agent and its children down, so nothing needs reaping. Chat has no close: closing a task suspends it; archive is the only way out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 POST /api/tasks/:id/close harvests immediately regardless of idle state
- [ ] #2 On boot, all lifecycle=live rows are set to suspended before any client can connect
- [ ] #3 bun --hot restarts leave tasks resumable rather than gone
- [ ] #4 Tests cover both triggers
<!-- AC:END -->
