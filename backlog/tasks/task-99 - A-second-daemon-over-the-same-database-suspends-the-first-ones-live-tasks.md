---
id: TASK-99
title: A second daemon over the same database suspends the first one's live tasks
status: To Do
assignee: []
created_date: '2026-09-08 00:30'
updated_date: '2026-09-08 00:31'
labels: []
dependencies: []
ordinal: 103000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Starting a server against a store another daemon is already using (a worktree's 'bun run dev --port 4599' without --db, while the main instance runs on 4001) runs reconcileOnBoot, which rewrites every live row to suspended / agent_state unknown on the assumption that this is the only daemon and a restart killed everything. The first daemon never restarted: its PTYs and agents are still running, but its task list reads lifecycle from the row, so every task shows Suspended, close is refused for a task that is not live, and a reopen would try to resume a task whose process is alive. Seen 2026-09-07; the rows were repaired by hand with sqlite. The pid file guards only the daemon command on one port, not the store, and 'foreground' does not consult it at all.

The store needs an owner. A daemon that finds the store held by a live daemon must refuse to boot with a message naming the holder (port, pid) and suggesting --db, rather than reconcile rows it does not own. Holding has to be robust to the holder dying (a stale claim must not lock the store forever) and to two daemons legitimately sharing nothing (different --db paths).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Starting a second server (foreground or daemon) against a database a live daemon is using exits non-zero before touching any row, with a message naming the holder's port and pid and suggesting --db
- [ ] #2 A claim left by a daemon that died (pid gone) does not block the next start; that start reconciles as today
- [ ] #3 Two servers on different --db paths run side by side unaffected
- [ ] #4 The main daemon's tasks stay live (row and list) throughout an attempt to start a second server over its store
- [ ] #5 Tests cover the refused start, the stale claim, and the distinct-store case
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The task that showed Suspended was the one hosting the Claude Code session doing TASK-98, the row named "worktree-terminal-clip-hover" in the main instance on port 4001. Its agent and PTY were alive the whole time; only the row had been rewritten by the worktree server's boot pass. Repaired with: update tasks set lifecycle='live' where lifecycle='suspended' and agent_state='unknown'.
<!-- SECTION:NOTES:END -->
