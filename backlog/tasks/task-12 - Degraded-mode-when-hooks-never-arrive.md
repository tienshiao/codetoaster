---
id: TASK-12
title: Degraded mode when hooks never arrive
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - server
  - tasks
milestone: m-1
dependencies:
  - TASK-11
documentation:
  - docs/v2-architecture.md
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Risk 4 (§9): a user running --bare, with hooks disabled, or a future Claude Code with changed payloads leaves tasks with no hook signal. Tasks must still work: fall back to the v1 output-activity heuristic (Pty's 300 ms debounce) for busy/idle when no hook has been seen for the task, and mark agent_state as `unknown` rather than leaving it stuck at `starting`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A task whose agent never sends SessionStart moves to agent_state=unknown after a bounded time
- [ ] #2 Busy/idle for hook-less tasks is inferred from PTY output activity
- [ ] #3 Once any hook arrives for a task, hook state takes precedence over the heuristic
- [ ] #4 Tests cover the no-hook path
<!-- AC:END -->
