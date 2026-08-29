---
id: TASK-24
title: Composer pane
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-20
  - TASK-21
documentation:
  - docs/v2-architecture.md
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
frontend/Composer.tsx (§7.5): rendered at / inside the app shell (task list left, Explorer right stay mounted). Prompt textarea (⌘⏎ submits), project selector over existing projects with initialPath, options row (model, permission mode; worktree toggle + base ref arrive in Phase 5). Submit → POST /api/tasks → navigate to /t/<slug> with the agent tab focused. No recent-tasks list — the sidebar is the history.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ⌘⏎ submits; an empty prompt cannot be submitted
- [ ] #2 Project selector lists projects and honours project defaults for model/permission mode
- [ ] #3 Successful submit navigates to the new task with the agent tab active
- [ ] #4 Server errors from POST /api/tasks are shown inline, and the prompt is not lost
<!-- AC:END -->
