---
id: TASK-5
title: 'TaskManager: policy layer and push channel'
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - server
  - tasks
milestone: m-0
dependencies:
  - TASK-2
  - TASK-4
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The only place that knows a task can exist without a process (§5.2). Owns create/resume/harvest/archive orchestration (resume/harvest/archive bodies arrive in later phases; the seams exist now), and broadcasts `tasks` (snapshot) and `task` (delta) messages over the WebSocket (§5.3). SessionManager is deleted; the v1 UI is kept working by mapping its session list onto tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Creating a task writes the row via TaskStore, then spawns the agent PTY via PtyManager, and records the ptyId → taskId association
- [ ] #2 Clients receive a `tasks` snapshot on connect and a `task` delta on any row change
- [ ] #3 activity/notification push messages carry taskId
- [ ] #4 SessionManager no longer exists; nothing imports it
- [ ] #5 The v1 sidebar still lists and attaches to tasks (bolted on top; not the final UI)
<!-- AC:END -->
