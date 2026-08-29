---
id: TASK-6
title: resolveTaskRoot and /api/sessions → /api/tasks route rename
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - server
  - api
milestone: m-0
dependencies:
  - TASK-2
documentation:
  - docs/v2-architecture.md
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every data route today funnels through resolveSessionGitRoot(sessionId), which needs a running PTY (§5.4). Replace with `resolveTaskRoot(taskId) -> { repoRoot, cwd }` read from the task row, so a suspended task can still be browsed. Rename `/api/sessions/:id/*` → `/api/tasks/:id/*` across api/{diff,files,git,highlight,symbols}.ts and the matching frontend hooks. Route bodies are untouched. Live getCwd() is kept only to opportunistically notice the agent has cd'd elsewhere. Land this early: it is mechanical and low-conflict (Risk 7).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 resolveTaskRoot reads repo_root/cwd from the task row and never touches a process
- [ ] #2 diff, files, git, highlight, and symbol routes work for a task with no live PTY
- [ ] #3 All routes are served under /api/tasks/:id/*; no /api/sessions/* remains
- [ ] #4 Frontend hooks call the new paths; existing route tests pass
- [ ] #5 repo_root is computed once at task creation and stored on the row
<!-- AC:END -->
