---
id: TASK-101
title: Task list order stops tracking recency between full snapshots
status: Done
assignee:
  - '@claude'
created_date: '2026-09-10 07:44'
updated_date: '2026-09-10 08:06'
labels:
  - frontend
  - bug
dependencies: []
ordinal: 105000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The sidebar is meant to list tasks most-recently-active first: src/lib/tasks/store.ts orders rows last_active_at DESC, and the client (TaskSidebar.tsx, task-list.ts) deliberately preserves server order. But the reorder only reaches the client on a full 'tasks' snapshot, which the server sends on connect, create, close/suspend, archive/delete, project changes and the boot sweep. Recency writes in between are lost positionally: PTY activity bumps last_active_at with no broadcast at all (manager.ts pty.onActivityChange), and hook transitions (busy/idle/stop) bump it but send a single-row 'task' delta that TaskContext.tsx upserts in place at the row's old index. A new task lands on top on creation and everything else stays put, so in practice the list reads as creation order and a long-running task sinks under shorter ones started later, then jumps to the top only when some unrelated create or close happens to trigger a snapshot. Reloading shows the true order. Fix either by re-sorting on the client by lastActiveAt when a delta is applied (and on activity messages, since those carry no row), or by having the server send a snapshot / include a rank-changing recency in the delta. Whichever way, avoid reordering rows under the pointer while the user is mid-click; a small debounce or only-reorder-when-the-rank-actually-changes rule is fine.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A task that becomes active (PTY output or a busy hook) moves to the top of the live list without a reload, and without waiting for a create or close
- [x] #2 Order after any sequence of deltas matches what a fresh 'tasks' snapshot would produce
- [x] #3 Archived rows keep their separate, appended placement under the archived toggle
- [x] #4 Unit test in task-list or TaskContext covers a delta that changes rank
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server: the 'activity' message gains at?: number, the same Date.now() the manager writes to last_active_at when active is true (manager.ts pty.onActivityChange). No new broadcast. 2. Client task-list.ts: byRecency(tasks), a stable sort by lastActiveAt desc that returns the input array unchanged when already ordered. Header comment updated: order is still the server's; this re-applies it between snapshots. 3. TaskContext.tsx: after upserting a 'task' delta apply byRecency; on an 'activity' message carrying at, set that row's lastActiveAt to max(current, at) and apply byRecency. Archived rows untouched. 4. Tests: task-list.test.ts for byRecency (rank change, ties keep arrival order, identity when unchanged); TaskContext.render.tsx for a delta that changes rank and an activity message that does.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Recency now travels between snapshots. Server: the activity message gained an optional 'at' (src/lib/xtmux/types.ts), and the agent-PTY onActivityChange in src/lib/tasks/manager.ts computes the stamp once, writes it to last_active_at as before, and rides it along on the rising edge of the broadcast. The shell-PTY handler (adoptShell) still writes the stamp and deliberately broadcasts no activity message at all — that is its documented design, so it was left alone; a shell tab's recency therefore still waits for the next snapshot. Client: task-list.ts exports byRecency, a stable last_active_at DESC sort that returns the same array instance when nothing is out of order, so a delta that does not change rank re-renders nothing and no row moves under a mid-click pointer; selectTasks and groupByProject stay order-preserving, and archived rows keep their appended placement because the sidebar concatenates them after the sorted live list. TaskContext.tsx runs both upsert branches of the task delta through byRecency, and on an activity message with active && at !== undefined bumps that row's lastActiveAt and re-sorts (no-op if the row is missing or the stamp is not newer); an older daemon's stamp-less message changes nothing. Covered by three byRecency cases in task-list.test.ts (rank change, stable ties, same-instance return) and three in TaskContext.render.tsx (rank-changing delta, activity stamp, stamp-less activity). bun test 284 pass / 0 fail, vitest 327 pass across 29 files, bunx tsc --noEmit clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The sidebar now keeps recency order between snapshots. The 'activity' message carries the stamp the server wrote to last_active_at on a rising edge, and the client re-applies last_active_at DESC after every task delta and stamped activity message via byRecency in task-list.ts, which is a no-op down to array identity when no rank changed. Shell-tab activity still reaches the client only on the next snapshot, because the shell PTY deliberately sends no activity message (its falling edge would clear the agent's dot). Verified with bun test (task-list, tasks) and vitest (TaskContext.render).
<!-- SECTION:FINAL_SUMMARY:END -->
