---
id: TASK-4
title: 'PtyManager: own live Pty objects'
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - server
  - xtmux
milestone: m-0
dependencies:
  - TASK-3
documentation:
  - docs/v2-architecture.md
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The process layer of the three-way split (§5.2): spawn, write, resize, serialize, kill, attach/detach per client. Knows nothing about tasks, worktrees, or naming. Replaces the process-owning half of SessionManager.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 spawn(command, opts) returns a Pty id; write/resize/serialize/kill address by ptyId
- [ ] #2 Attach/detach and smallest-wins negotiation live here, keyed by `${clientId}:${ptyId}`
- [ ] #3 No reference to tasks, TaskStore, git, or naming
- [ ] #4 Existing multiplex tests run against PtyManager
<!-- AC:END -->
