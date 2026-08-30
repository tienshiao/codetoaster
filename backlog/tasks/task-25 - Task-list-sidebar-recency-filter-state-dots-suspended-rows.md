---
id: TASK-25
title: 'Task list sidebar: recency, filter, state dots, suspended rows'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-08-30 06:10'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-20
documentation:
  - docs/v2-architecture.md
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rework AppSidebar.tsx into the chat-history / resume list (§7.5). Recency ordering across projects with project grouping as a toggle; a filter box; agent-state dots (busy / idle / needs_attention) and the last_message preview; suspended tasks as ordinary clickable rows (they are the normal resting state, not an error); archived tasks behind a toggle; close action (confirm when busy); the OSC terminal title shown as a subtitle via naming.ts's meaningfulTitle/stripDecoration projection. hooks/use-sidebar-drag.ts (manual reordering) is removed — you don't hand-sort cattle.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Default ordering is by last_active_at; a toggle groups by project
- [ ] #2 Filter box narrows the list by title, project, and last_message
- [ ] #3 Each row shows a state dot for busy/idle/needs_attention and the last_message preview
- [ ] #4 Suspended tasks look like normal rows; clicking one navigates to it and triggers resume
- [ ] #5 Archived tasks are hidden unless the show-archived toggle is on
- [ ] #6 use-sidebar-drag.ts is deleted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Carried over from TASK-6's review: TaskManager.loadProjects() rebuilds ProjectInfo from the projects table but never repopulates project.taskIds, and listTasks() reads only those arrays — placeInProject runs on create alone. Today nothing shows, because reconcileOnBoot suspends every row at startup and listTasks filters to live. The moment TASK-13 resumes a task, taskInfo()/broadcastTask() will answer for it while listTasks() still will not. Whichever of TASK-13 or this task lands first owns fixing it — most likely by dropping the in-memory grouping for the recency list §7.5 describes.

Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.
<!-- SECTION:NOTES:END -->
