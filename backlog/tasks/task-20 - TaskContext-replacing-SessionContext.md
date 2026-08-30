---
id: TASK-20
title: TaskContext replacing SessionContext
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
updated_date: '2026-08-30 00:34'
labels:
  - frontend
  - tasks
milestone: m-3
dependencies:
  - TASK-7
  - TASK-5
documentation:
  - docs/v2-architecture.md
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Task list, projects, per-task agent state, notifications, fed by the socket's tasks/task/activity/notification messages and mutated via HTTP (§7.4). SessionContext.tsx is deleted.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Task list reflects tasks snapshot on connect and task deltas thereafter
- [ ] #2 create/rename/close/resume go through the HTTP routes and surface errors to the UI
- [ ] #3 agent_state, last_message, lifecycle are available per task for the sidebar
- [ ] #4 SessionContext.tsx and its consumers are gone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.
<!-- SECTION:NOTES:END -->
