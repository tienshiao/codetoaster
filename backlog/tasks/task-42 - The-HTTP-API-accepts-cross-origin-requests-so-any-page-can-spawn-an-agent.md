---
id: TASK-42
title: 'The HTTP API accepts cross-origin requests, so any page can spawn an agent'
status: To Do
assignee: []
created_date: '2026-08-29 06:33'
labels:
  - server
  - security
milestone: m-5
dependencies: []
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/server.ts sets no Origin check and no token on any route. A cross-origin POST with a simple content type is not preflighted by the browser, and POST /api/tasks calls req.json() without looking at the content type — so any page a user visits while the daemon is running can create a task in their working directory, choosing both the prompt and the permission mode. permissionMode is passed straight through to the agent's argv, and bypassPermissions is a valid value.

The exposure class is pre-existing: v1's WebSocket already accepted create and input with no authentication. What changed is the payload. v1 could spawn the user's shell with no arguments; v2 spawns an agent with an attacker-chosen prompt and an attacker-chosen permission mode, over plain HTTP, in a repository the user cares about. The daemon also binds 0.0.0.0, so the same requests reach it from the LAN without a browser involved.

This needs a decision rather than a patch, which is why it is its own task:
- an Origin/Host allowlist on every mutating route, which is the cheapest thing that stops the browser-driven case;
- a token minted at daemon start, written to ~/.codetoaster/ alongside the pid file, required by the API and handed to the frontend by the SPA shell — this is what also covers the LAN case;
- binding 127.0.0.1 by default, with 0.0.0.0 opt-in, which should probably happen regardless of the above.

Worth doing before v2 ships, and before the harvester (TASK-15) and worktrees (m-4) give a spawned task more to touch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A cross-origin POST to any mutating route is refused, and a test asserts it for /api/tasks
- [ ] #2 The WebSocket accepts a connection only from an allowed origin, so the socket is not a way around the HTTP check
- [ ] #3 The daemon binds 127.0.0.1 by default; exposing it on 0.0.0.0 is an explicit flag
- [ ] #4 The frontend and the CLI both still work against the protected daemon, with no manual step for the user
- [ ] #5 GET routes that only read are covered too, or there is a written reason why they are not
<!-- AC:END -->
