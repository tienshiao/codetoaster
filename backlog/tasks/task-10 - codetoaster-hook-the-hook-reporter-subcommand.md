---
id: TASK-10
title: 'codetoaster hook: the hook reporter subcommand'
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - cli
  - agent
milestone: m-1
dependencies: []
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
New cli/hook.ts (§4.2). Reads the hook payload from stdin, reads CODETOASTER_TASK_ID / CODETOASTER_PORT from env, and POSTs it to the daemon. Hard requirements: it must print NOTHING to stdout (SessionStart stdout is injected into the conversation as context), must always exit 0, and must be fast — ~1 s fetch timeout, every error swallowed. A daemon that is down must never wedge an agent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Writes zero bytes to stdout on every path, including errors
- [ ] #2 Exits 0 whether the daemon is up, down, slow, or returns an error
- [ ] #3 Gives up within ~1 s when the daemon does not answer
- [ ] #4 Posts the raw payload plus task id to the daemon's hook endpoint
- [ ] #5 Tests cover: daemon up, daemon down, missing env vars, malformed stdin
<!-- AC:END -->
