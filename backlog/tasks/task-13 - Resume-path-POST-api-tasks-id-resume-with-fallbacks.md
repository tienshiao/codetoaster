---
id: TASK-13
title: 'Resume path: POST /api/tasks/:id/resume with fallbacks'
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - server
  - agent
  - api
milestone: m-1
dependencies:
  - TASK-11
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reopen a suspended task (§4.3): run `claude --resume <agent_session_id>` in the task cwd via the normal spawn path (settings, env scrub, env vars). If that fails, fall back in order: (1) `claude --continue` in the cwd; (2) scan ~/.claude/projects/<escaped-cwd>/*.jsonl for the newest transcript with a known sessionId or an mtime inside the task's lifetime; (3) surface a `could not resume` state on the task so the user can choose 'start fresh in this directory'. A fresh start MUST allocate a new uuid — a used --session-id fails with 'already in use'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 POST /api/tasks/:id/resume on a suspended task spawns claude --resume with the stored id and returns 200 with the TaskInfo
- [ ] #2 Resume on a task that is already live is a no-op 200 (idempotent)
- [ ] #3 When --resume fails, --continue is tried, then the transcript scan, in that order
- [ ] #4 When every fallback fails, the task lands in an actionable could-not-resume state, never a dead terminal
- [ ] #5 'Start fresh' allocates a new agent_session_id and writes it to the row before spawning
- [ ] #6 Tests cover each fallback rung and the fresh-start id rotation
<!-- AC:END -->
