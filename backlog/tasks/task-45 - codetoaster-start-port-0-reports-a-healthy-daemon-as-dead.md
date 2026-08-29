---
id: TASK-45
title: codetoaster start --port 0 reports a healthy daemon as dead
status: To Do
assignee: []
created_date: '2026-08-29 09:05'
labels:
  - cli
  - bug
dependencies: []
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by code review during TASK-14 (not introduced by it).

src/cli/commands.ts:46 — under --port 0 the kernel picks the port, but cmdStart polls daemonBaseUrl(port) with the *requested* port (0) and looks for a pid file that is written at the bound one. It never finds the daemon, reports it as dead after 15 attempts, and exits — orphaning a server that is actually running and listening.

Fixing this needs the child to report its bound port back to the parent (a handshake on stdout, or the pid file path being discovered rather than derived).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 codetoaster start --port 0 reports the daemon as started and names the bound port
- [ ] #2 No orphaned daemon is left behind when the poll fails for any other reason
<!-- AC:END -->
