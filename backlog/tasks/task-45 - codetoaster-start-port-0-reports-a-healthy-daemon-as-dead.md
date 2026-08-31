---
id: TASK-45
title: codetoaster start --port 0 reports a healthy daemon as dead
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 09:05'
updated_date: '2026-08-31 01:05'
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
- [x] #1 codetoaster start --port 0 reports the daemon as started and names the bound port
- [x] #2 No orphaned daemon is left behind when the poll fails for any other reason
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
spawnDaemon now returns the child's pid, and daemon.ts gained findPidFileByPid/originOf. cmdStart polls for the pid file *that pid* wrote rather than deriving a path from the port it asked for, so --port 0 finds the daemon at whatever the kernel gave it and reports that port and origin. It also breaks out early when the child has already exited (bad bind, bad --db) instead of spending all fifteen attempts, and on any failure kills the process it spawned and removes its pid file — the orphan was the worse half of the bug, since no later command could find a daemon whose port nobody knew.

Note the CLI has no 'start' subcommand: starting the daemon is the bare invocation (case "" in index.ts). New src/cli/start.test.ts drives the real process with a HOME of its own so the pid files land somewhere disposable; verified the port-0 test fails without the fix.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
cmdStart finds the daemon by the pid it spawned instead of by a path derived from the requested port, so --port 0 reports the port the kernel actually assigned. It also gives up early when the child has already exited, and kills what it started rather than leaving an unfindable daemon listening. Verified with a new src/cli/start.test.ts that drives the real process under a disposable HOME; confirmed the port-0 case fails without the fix.
<!-- SECTION:FINAL_SUMMARY:END -->
