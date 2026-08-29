---
id: TASK-7
title: 'Task CRUD over HTTP: POST /api/tasks and PATCH /api/tasks/:id'
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - server
  - api
milestone: m-0
dependencies:
  - TASK-5
documentation:
  - docs/v2-architecture.md
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Task CRUD moves off the WebSocket to HTTP (§5.3) because creating a task can run git and fail in interesting ways. This task covers create and patch; resume lands in Phase 2 and archive in Phase 5. Body for POST: projectId, prompt, optional model/permissionMode (worktree options come in Phase 5). PATCH covers rename (title, title_source='manual').
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 POST /api/tasks creates a row, spawns the agent PTY, and returns the TaskInfo with a 201
- [ ] #2 Validation and spawn failures return a 4xx/5xx with a JSON error body, not a socket error string
- [ ] #3 PATCH /api/tasks/:id renames a task and sets title_source to manual
- [ ] #4 Route tests cover success and failure paths
<!-- AC:END -->
