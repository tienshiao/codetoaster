---
id: TASK-16
title: Manual close and boot-time suspension
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 05:04'
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
- [ ] #5 Closing keeps ~/.codetoaster/tasks/<id>/ intact — its settings.json and scrollback are what reopening the suspended task reads back
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Boot-time suspension landed early, with TASK-5: TaskManager.reconcileOnBoot() marks every live row suspended at startup, and server.ts calls it after loadProjects. Without it TASK-5 shipped a manager that listed tasks whose processes had died with the previous daemon. What remains here is the manual-close half — §6's 'closing a task suspends it' — which replaces the v1 kill semantics TASK-5 kept (closeTask still kills the terminals and deletes the row).

Until the manual-close half lands, closeTask still deletes the row while leaving ~/.codetoaster/tasks/<id>/ on disk, which orphans that directory for good: the id can never be reissued, so nothing will ever read it again. Deleting it in closeTask would be the wrong fix, since close becomes a suspend here and a suspended task's directory is exactly what reopening it needs. The removal belongs to archive (TASK-31, which now has an acceptance criterion for it). Documented on closeTask itself.
<!-- SECTION:NOTES:END -->
