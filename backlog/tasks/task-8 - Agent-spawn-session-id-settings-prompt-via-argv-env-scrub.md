---
id: TASK-8
title: 'Agent spawn: --session-id, --settings, prompt via argv, env scrub'
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - server
  - agent
milestone: m-1
dependencies:
  - TASK-5
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
lib/agent/spawn.ts builds the `claude` argv from a task row (§4.1): `--session-id <uuid we allocate>`, `--settings <per-task settings.json>`, optional `--model` / `--permission-mode`, and the initial prompt as a positional argument (never written into the PTY after startup). Scrub inherited CLAUDECODE, CLAUDE_CODE_*, CLAUDE_PID, CLAUDE_EFFORT from the child env — a daemon started from inside an agent session otherwise spawns children with transcript saving off and nothing to resume. Add CODETOASTER_TASK_ID and CODETOASTER_PORT to the child env.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 argv is an array; prompts containing newlines and quotes reach the agent verbatim
- [ ] #2 agent_session_id is allocated before spawn and stored on the task row
- [ ] #3 Child env contains no CLAUDECODE / CLAUDE_CODE_* / CLAUDE_PID / CLAUDE_EFFORT keys even when the daemon's env does
- [ ] #4 Child env carries CODETOASTER_TASK_ID and CODETOASTER_PORT
- [ ] #5 Unit tests cover argv construction and env scrubbing
<!-- AC:END -->
